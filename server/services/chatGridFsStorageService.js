import crypto from "node:crypto";
import { Readable } from "node:stream";
import { GridFSBucket, ObjectId } from "mongodb";
import { HttpError } from "../utils/httpError.js";

/**
 * Per-tenant GridFS storage for chat attachments.
 * Bucket: chat_attachments (separate from offer_docs — do not mix with offer lifecycle).
 *
 * Pattern mirrors offerGridFsStorageService (put / get / delete + test adapter)
 * without offer-specific purpose/refcount/immutability rules.
 */

export const CHAT_ATTACHMENTS_BUCKET = "chat_attachments";
export const PURPOSE_CHAT_ATTACHMENT = "chat_attachment";

let testAdapter = null;

/** Available whenever a tenant Mongo connection exists (Atlas / memory server). */
export function isChatStorageConfigured(connection) {
  if (testAdapter) return true;
  return Boolean(connection?.db);
}

/**
 * Test hook: { putFile, getFileBuffer, deleteFile }.
 * Pass null to restore GridFS.
 */
export function setChatStorageAdapter(adapter) {
  testAdapter = adapter || null;
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function requireConnection(connection) {
  if (testAdapter) return null;
  if (!connection?.db) {
    throw new HttpError(503, "Document storage is not configured", {
      code: "STORAGE_NOT_CONFIGURED",
    });
  }
  return connection;
}

function getBucket(connection) {
  requireConnection(connection);
  return new GridFSBucket(connection.db, { bucketName: CHAT_ATTACHMENTS_BUCKET });
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && ObjectId.isValid(id)) return new ObjectId(id);
  if (id?._id) return toObjectId(id._id);
  return null;
}

export function chatStorageKeyFromFileId(fileId) {
  return String(fileId);
}

/**
 * Only 24-char hex ObjectIds are treated as GridFS ids.
 * Legacy R2 keys (e.g. tenants/.../chat/...) return null — never passed to GridFS delete.
 */
export function chatFileIdFromStorageKey(storageKey) {
  const raw = String(storageKey || "").trim();
  if (!/^[a-fA-F0-9]{24}$/.test(raw)) return null;
  return toObjectId(raw);
}

/**
 * Upload attachment bytes into tenant GridFS.
 * metadata may include conversationId, uploadedBy, originalMimeType, originalFileName.
 */
export async function putChatFile({
  connection,
  body,
  contentType,
  filename,
  metadata = {},
}) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(400, "A non-empty file buffer is required.");
  }

  const checksumSha256 = sha256Hex(body);
  const safeName = String(filename || "attachment.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

  if (testAdapter) {
    return testAdapter.putFile({
      body,
      contentType,
      filename: safeName,
      metadata: { ...metadata, purpose: PURPOSE_CHAT_ATTACHMENT, checksumSha256 },
      checksumSha256,
    });
  }

  requireConnection(connection);
  const bucket = getBucket(connection);
  const meta = {
    ...metadata,
    purpose: PURPOSE_CHAT_ATTACHMENT,
    checksumSha256,
  };

  let fileId;
  try {
    fileId = await new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStream(safeName, {
        contentType: contentType || "application/octet-stream",
        metadata: meta,
      });
      const id = uploadStream.id;
      uploadStream.on("error", reject);
      uploadStream.on("finish", () => resolve(id));
      Readable.from(body).pipe(uploadStream);
    });
  } catch (error) {
    throw new HttpError(500, `Failed to store chat attachment: ${error.message}`, {
      code: "STORAGE_WRITE_FAILED",
    });
  }

  return {
    fileId,
    filename: safeName,
    contentType: contentType || "application/octet-stream",
    byteSize: body.length,
    checksumSha256,
    uploadedAt: new Date(),
    storageKey: chatStorageKeyFromFileId(fileId),
  };
}

export async function getChatFileBuffer({ connection, fileId }) {
  const id = toObjectId(fileId);
  if (!id) throw new HttpError(404, "File not found");

  if (testAdapter) {
    const buffer = await testAdapter.getFileBuffer(id);
    if (!buffer) throw new HttpError(404, "File not found");
    return buffer;
  }

  requireConnection(connection);
  const bucket = getBucket(connection);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = bucket.openDownloadStream(id);
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", (err) => {
      if (err?.code === "ENOENT" || /FileNotFound/i.test(err.message || "")) {
        reject(new HttpError(404, "File not found"));
      } else {
        reject(err);
      }
    });
    stream.on("end", resolve);
  });
  return Buffer.concat(chunks);
}

export async function deleteChatFile({ connection, fileId }) {
  const id = toObjectId(fileId);
  if (!id) return false;

  if (testAdapter) {
    return testAdapter.deleteFile(id);
  }

  requireConnection(connection);
  try {
    await getBucket(connection).delete(id);
    return true;
  } catch {
    return false;
  }
}

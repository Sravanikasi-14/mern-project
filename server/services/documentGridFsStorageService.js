import crypto from "node:crypto";
import { Readable } from "node:stream";
import { GridFSBucket, ObjectId } from "mongodb";
import { HttpError } from "../utils/httpError.js";

/**
 * F57 — Per-tenant GridFS storage for HR employee / onboarding / task documents.
 * Bucket: hr_documents (separate from chat_attachments and offer_docs).
 *
 * storageKey for GridFS objects is the 24-char hex file id (same pattern as chat).
 * Legacy disk keys (timestamp_hex_filename) never match that shape.
 */

export const HR_DOCUMENTS_BUCKET = "hr_documents";
export const PURPOSE_HR_DOCUMENT = "hr_document";

let testAdapter = null;

export function isDocumentGridFsConfigured(connection) {
  if (testAdapter) return true;
  return Boolean(connection?.db);
}

/** Test hook: { putFile, getFileBuffer, deleteFile }. Pass null to restore GridFS. */
export function setDocumentStorageAdapter(adapter) {
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
  return new GridFSBucket(connection.db, { bucketName: HR_DOCUMENTS_BUCKET });
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && ObjectId.isValid(id)) return new ObjectId(id);
  if (id?._id) return toObjectId(id._id);
  return null;
}

export function documentStorageKeyFromFileId(fileId) {
  return String(fileId);
}

/** Only 24-char hex ObjectIds are GridFS ids; legacy disk keys return null. */
export function documentFileIdFromStorageKey(storageKey) {
  const raw = String(storageKey || "").trim();
  if (!/^[a-fA-F0-9]{24}$/.test(raw)) return null;
  return toObjectId(raw);
}

export async function putDocumentFile({
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
  const safeName = String(filename || "document.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);

  if (testAdapter) {
    return testAdapter.putFile({
      body,
      contentType,
      filename: safeName,
      metadata: { ...metadata, purpose: PURPOSE_HR_DOCUMENT, checksumSha256 },
      checksumSha256,
    });
  }

  requireConnection(connection);
  const bucket = getBucket(connection);
  const meta = {
    ...metadata,
    purpose: PURPOSE_HR_DOCUMENT,
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
    throw new HttpError(500, `Failed to store document: ${error.message}`, {
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
    storageKey: documentStorageKeyFromFileId(fileId),
  };
}

export async function getDocumentFileBuffer({ connection, fileId }) {
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

export async function deleteDocumentFile({ connection, fileId }) {
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

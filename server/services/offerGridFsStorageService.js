import crypto from "node:crypto";
import { Readable } from "node:stream";
import { GridFSBucket, ObjectId } from "mongodb";
import { HttpError } from "../utils/httpError.js";

/**
 * Per-tenant GridFS storage for offer templates / issued PDFs.
 * Bucket name: offer_docs (lazy-created on first write).
 *
 * Env (optional):
 *   OFFER_DOCX_MAX_BYTES   default 2097152 (2 MB)
 *   OFFER_PDF_MAX_BYTES    default 5242880 (5 MB)
 *   OFFER_TEMPLATE_VERSION_RETENTION  default 5
 */

export const OFFER_DOCS_BUCKET = "offer_docs";
export const PURPOSE_TEMPLATE_SOURCE = "template_source";
export const PURPOSE_ISSUED_PDF = "issued_pdf";
/** Final PDF after candidate signs (HR + candidate signatures). Separate from issued_pdf; never overwrites it. */
export const PURPOSE_SIGNED_PDF = "signed_pdf";

const DEFAULT_DOCX_MAX = 2 * 1024 * 1024;
const DEFAULT_PDF_MAX = 5 * 1024 * 1024;
const DEFAULT_VERSION_RETENTION = 5;

let testAdapter = null;

export function getOfferDocxMaxBytes() {
  const n = Number(process.env.OFFER_DOCX_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DOCX_MAX;
}

export function getOfferPdfMaxBytes() {
  const n = Number(process.env.OFFER_PDF_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PDF_MAX;
}

export function getTemplateVersionRetention() {
  const n = Number(process.env.OFFER_TEMPLATE_VERSION_RETENTION);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_VERSION_RETENTION;
}

/** Always available when a tenant Mongo connection is present (Phase 1 — no R2). */
export function isOfferStorageConfigured(connection) {
  if (testAdapter) return true;
  return Boolean(connection?.db);
}

/**
 * Test hook: inject { putFile, getFileBuffer, openDownloadStream, deleteFile, findTemplateSourceByChecksum }.
 * Pass null to restore GridFS.
 */
export function setOfferStorageAdapter(adapter) {
  testAdapter = adapter || null;
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function requireConnection(connection) {
  if (testAdapter) return null;
  if (!connection?.db) {
    throw new HttpError(503, "Tenant database connection is required for document storage.", {
      code: "STORAGE_NOT_CONFIGURED",
    });
  }
  return connection;
}

function getBucket(connection) {
  requireConnection(connection);
  return new GridFSBucket(connection.db, { bucketName: OFFER_DOCS_BUCKET });
}

async function ensureCustomIndexes(connection) {
  if (testAdapter || !connection?.db) return;
  try {
    const files = connection.db.collection(`${OFFER_DOCS_BUCKET}.files`);
    await files.createIndex(
      { "metadata.checksumSha256": 1, "metadata.purpose": 1 },
      { name: "offer_docs_checksum_purpose", background: true }
    );
    await files.createIndex(
      { "metadata.purpose": 1, uploadDate: -1 },
      { name: "offer_docs_purpose_upload", background: true }
    );
  } catch (err) {
    console.warn("[offerGridFs] index ensure warning:", err.message);
  }
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && ObjectId.isValid(id)) return new ObjectId(id);
  if (id?._id) return toObjectId(id._id);
  return null;
}

export function storageRefFromUpload(result) {
  return {
    provider: "gridfs",
    bucket: OFFER_DOCS_BUCKET,
    fileId: result.fileId,
    key: String(result.fileId), // legacy field retained for older readers
    filename: result.filename || "",
    contentType: result.contentType || "",
    byteSize: result.byteSize || 0,
    checksumSha256: result.checksumSha256 || "",
    etag: result.checksumSha256 || "",
    uploadedAt: result.uploadedAt || new Date(),
  };
}

export function getStorageFileId(storage) {
  if (!storage) return null;
  return toObjectId(storage.fileId || storage.key);
}

/**
 * Upload a buffer. For template_source, reuses an existing file with the same checksum (dedupe).
 * Issued and signed PDFs always create a new file (signed never replaces issued).
 */
export async function putOfferFile({
  connection,
  body,
  contentType,
  filename,
  purpose,
  metadata = {},
}) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(400, "A non-empty file buffer is required.");
  }
  if (purpose === PURPOSE_TEMPLATE_SOURCE && body.length > getOfferDocxMaxBytes()) {
    throw new HttpError(
      400,
      `DOCX file is too large (max ${Math.round(getOfferDocxMaxBytes() / (1024 * 1024))} MB).`,
      { code: "FILE_TOO_LARGE" }
    );
  }
  if (
    (purpose === PURPOSE_ISSUED_PDF || purpose === PURPOSE_SIGNED_PDF) &&
    body.length > getOfferPdfMaxBytes()
  ) {
    throw new HttpError(
      400,
      `PDF file is too large to store (max ${Math.round(getOfferPdfMaxBytes() / (1024 * 1024))} MB).`,
      { code: "FILE_TOO_LARGE" }
    );
  }

  const checksumSha256 = sha256Hex(body);

  if (testAdapter) {
    return testAdapter.putFile({
      body,
      contentType,
      filename,
      purpose,
      metadata: { ...metadata, checksumSha256, purpose },
      checksumSha256,
    });
  }

  requireConnection(connection);
  await ensureCustomIndexes(connection);

  if (purpose === PURPOSE_TEMPLATE_SOURCE) {
    const existing = await findTemplateSourceByChecksum({ connection, checksumSha256 });
    if (existing) {
      await incrementRefCount({ connection, fileId: existing.fileId });
      return {
        fileId: existing.fileId,
        filename: existing.filename,
        contentType: existing.contentType,
        byteSize: existing.byteSize,
        checksumSha256,
        uploadedAt: existing.uploadedAt,
        deduped: true,
      };
    }
  }

  const bucket = getBucket(connection);
  const safeName = String(filename || "document.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  const meta = {
    ...metadata,
    purpose,
    checksumSha256,
    refCount: purpose === PURPOSE_TEMPLATE_SOURCE ? 1 : undefined,
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
    throw new HttpError(500, `Failed to store document: ${error.message}`, { code: "STORAGE_WRITE_FAILED" });
  }

  return {
    fileId,
    filename: safeName,
    contentType: contentType || "application/octet-stream",
    byteSize: body.length,
    checksumSha256,
    uploadedAt: new Date(),
    deduped: false,
  };
}

export async function findTemplateSourceByChecksum({ connection, checksumSha256 }) {
  if (!checksumSha256) return null;
  if (testAdapter?.findTemplateSourceByChecksum) {
    return testAdapter.findTemplateSourceByChecksum(checksumSha256);
  }
  requireConnection(connection);
  const doc = await connection.db.collection(`${OFFER_DOCS_BUCKET}.files`).findOne({
    "metadata.purpose": PURPOSE_TEMPLATE_SOURCE,
    "metadata.checksumSha256": checksumSha256,
  });
  if (!doc) return null;
  return {
    fileId: doc._id,
    filename: doc.filename,
    contentType: doc.contentType || "",
    byteSize: doc.length || 0,
    checksumSha256,
    uploadedAt: doc.uploadDate,
    refCount: doc.metadata?.refCount ?? 1,
  };
}

async function incrementRefCount({ connection, fileId }) {
  if (testAdapter?.incrementRefCount) return testAdapter.incrementRefCount(fileId);
  const id = toObjectId(fileId);
  if (!id) return;
  await connection.db.collection(`${OFFER_DOCS_BUCKET}.files`).updateOne(
    { _id: id },
    { $inc: { "metadata.refCount": 1 } }
  );
}

async function decrementRefCount({ connection, fileId }) {
  if (testAdapter?.decrementRefCount) return testAdapter.decrementRefCount(fileId);
  const id = toObjectId(fileId);
  if (!id) return null;
  const files = connection.db.collection(`${OFFER_DOCS_BUCKET}.files`);
  const doc = await files.findOne({ _id: id });
  if (!doc) return null;
  if (doc.metadata?.purpose === PURPOSE_ISSUED_PDF || doc.metadata?.purpose === PURPOSE_SIGNED_PDF) {
    // Never auto-delete issued PDFs via refcount.
    return { deleted: false, issued: true };
  }
  const next = Math.max(0, (doc.metadata?.refCount ?? 1) - 1);
  if (next <= 0) {
    await deleteOfferFile({ connection, fileId: id, allowIssued: false });
    return { deleted: true, issued: false };
  }
  await files.updateOne({ _id: id }, { $set: { "metadata.refCount": next } });
  return { deleted: false, issued: false };
}

export async function getOfferFileBuffer({ connection, fileId }) {
  const id = toObjectId(fileId);
  if (!id) throw new HttpError(404, "Stored document was not found.");

  if (testAdapter) return testAdapter.getFileBuffer(id);

  requireConnection(connection);
  const bucket = getBucket(connection);
  const chunks = [];
  await new Promise((resolve, reject) => {
    const stream = bucket.openDownloadStream(id);
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", (err) => {
      if (err?.code === "ENOENT" || /FileNotFound/i.test(err.message || "")) {
        reject(new HttpError(404, "Stored document was not found."));
      } else {
        reject(err);
      }
    });
    stream.on("end", resolve);
  });
  return Buffer.concat(chunks);
}

/**
 * Open a download stream. Caller must pipe to the HTTP response and handle errors.
 * Returns { stream, length, contentType, filename }.
 */
export async function openOfferDownloadStream({ connection, fileId }) {
  const id = toObjectId(fileId);
  if (!id) throw new HttpError(404, "Stored document was not found.");

  if (testAdapter) {
    const buffer = await testAdapter.getFileBuffer(id);
    const stream = Readable.from(buffer);
    return {
      stream,
      length: buffer.length,
      contentType: "application/octet-stream",
      filename: "document",
    };
  }

  requireConnection(connection);
  const files = connection.db.collection(`${OFFER_DOCS_BUCKET}.files`);
  const meta = await files.findOne({ _id: id });
  if (!meta) throw new HttpError(404, "Stored document was not found.");

  const bucket = getBucket(connection);
  const stream = bucket.openDownloadStream(id);
  return {
    stream,
    length: meta.length,
    contentType: meta.contentType || "application/octet-stream",
    filename: meta.filename || "document",
  };
}

/**
 * Delete a GridFS file. Issued PDFs are refused unless allowIssued=true (explicit only — not used in normal GC).
 */
export async function deleteOfferFile({ connection, fileId, allowIssued = false }) {
  const id = toObjectId(fileId);
  if (!id) return false;

  if (testAdapter) return testAdapter.deleteFile(id, { allowIssued });

  requireConnection(connection);
  const files = connection.db.collection(`${OFFER_DOCS_BUCKET}.files`);
  const meta = await files.findOne({ _id: id });
  if (!meta) return false;
  if (
    (meta.metadata?.purpose === PURPOSE_ISSUED_PDF || meta.metadata?.purpose === PURPOSE_SIGNED_PDF) &&
    !allowIssued
  ) {
    return false;
  }
  try {
    await getBucket(connection).delete(id);
    return true;
  } catch {
    return false;
  }
}

/** Release a template_source reference (refcount or delete when unused). Never touches issued PDFs. */
export async function releaseTemplateSourceFile({ connection, fileId }) {
  return decrementRefCount({ connection, fileId });
}

/**
 * Collect fileIds referenced by a template document (current + versions).
 */
export function collectTemplateFileIds(template) {
  const ids = new Set();
  const add = (storage) => {
    const id = getStorageFileId(storage);
    if (id) ids.add(String(id));
  };
  add(template?.storage);
  for (const v of template?.versions || []) add(v.storage);
  return [...ids];
}

/**
 * After appending a new version, drop GridFS files for versions older than retention
 * that are no longer referenced by the retained window or current storage.
 * Never deletes files still referenced by an active version entry.
 */
export async function pruneOldTemplateVersions({ connection, templateDoc }) {
  const retention = getTemplateVersionRetention();
  const versions = [...(templateDoc.versions || [])].sort((a, b) => a.version - b.version);
  if (versions.length <= retention) return { pruned: 0 };

  const keep = versions.slice(-retention);
  const keepIds = new Set();
  for (const v of keep) {
    const id = getStorageFileId(v.storage);
    if (id) keepIds.add(String(id));
  }
  const currentId = getStorageFileId(templateDoc.storage);
  if (currentId) keepIds.add(String(currentId));

  const drop = versions.slice(0, versions.length - retention);
  let pruned = 0;
  const nextVersions = keep;

  for (const v of drop) {
    const id = getStorageFileId(v.storage);
    if (id && !keepIds.has(String(id))) {
      await releaseTemplateSourceFile({ connection, fileId: id });
      pruned += 1;
    }
  }

  templateDoc.versions = nextVersions;
  return { pruned };
}

/**
 * Delete all template_source files for a draft template that are not shared.
 */
export async function cleanupTemplateFiles({ connection, template }) {
  const ids = collectTemplateFileIds(template);
  let deleted = 0;
  for (const id of ids) {
    const result = await releaseTemplateSourceFile({ connection, fileId: id });
    if (result?.deleted) deleted += 1;
  }
  return { deleted };
}

/**
 * Pipe a GridFS download to Express response. Handles stream errors.
 */
export async function streamOfferFileToResponse({ connection, fileId, res, downloadName, contentType }) {
  const { stream, length, contentType: ct, filename } = await openOfferDownloadStream({
    connection,
    fileId,
  });
  res.setHeader("Content-Type", contentType || ct);
  if (length != null) res.setHeader("Content-Length", String(length));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${String(downloadName || filename).replace(/"/g, "")}"`
  );
  return new Promise((resolve, reject) => {
    stream.on("error", (err) => {
      if (!res.headersSent) {
        reject(
          err?.status
            ? err
            : new HttpError(500, `Failed to stream document: ${err.message}`)
        );
      } else {
        res.destroy(err);
        resolve();
      }
    });
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

export { toObjectId as toOfferFileObjectId };

import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "../utils/httpError.js";

/**
 * Cloudflare R2 (S3-compatible) private object storage.
 * Metadata lives in MongoDB; bytes live here. The bucket is never public —
 * downloads go through short-lived presigned GET URLs or server-side reads.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *      R2_ENDPOINT (optional; derived from R2_ACCOUNT_ID), R2_PRESIGN_TTL_SECONDS
 */

const DEFAULT_PRESIGN_TTL_SECONDS = 300;
const KEY_PART_PATTERN = /^[A-Za-z0-9._-]+$/;

let client = null;
let clientSignature = "";
let testAdapter = null;

export function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const endpoint =
    process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  return {
    accountId,
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    endpoint,
  };
}

export function isR2Configured() {
  if (testAdapter) return true;
  const cfg = getR2Config();
  return Boolean(cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && cfg.endpoint);
}

/**
 * Test hook: inject an adapter { putObject, getObjectBuffer, getPresignedGetUrl }.
 * Pass null to restore the real R2 client.
 */
export function setStorageAdapter(adapter) {
  testAdapter = adapter || null;
}

function requireConfigured() {
  if (!isR2Configured()) {
    throw new HttpError(
      503,
      "Document storage is not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_ACCOUNT_ID (or R2_ENDPOINT).",
      { code: "STORAGE_NOT_CONFIGURED" }
    );
  }
}

function getClient() {
  const cfg = getR2Config();
  const signature = `${cfg.endpoint}|${cfg.accessKeyId}|${cfg.bucket}`;
  if (!client || clientSignature !== signature) {
    client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    clientSignature = signature;
  }
  return client;
}

function sanitizePart(part) {
  const value = String(part ?? "").trim();
  if (!value || value === "." || value === ".." || !KEY_PART_PATTERN.test(value)) {
    throw new HttpError(400, `Invalid storage key segment: '${value}'`);
  }
  return value;
}

/** tenants/{databaseName}/...parts — databaseName must come from req.auth.company. */
export function buildTenantKey(databaseName, ...parts) {
  return ["tenants", sanitizePart(databaseName), ...parts.map(sanitizePart)].join("/");
}

/** platform/...parts — platform-owned assets only. */
export function buildPlatformKey(...parts) {
  return ["platform", ...parts.map(sanitizePart)].join("/");
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload an object. Returns the storage metadata to persist in Mongo.
 */
export async function putObject({ key, body, contentType = "application/octet-stream" }) {
  if (!key || typeof key !== "string") throw new HttpError(400, "Storage key is required.");
  if (!Buffer.isBuffer(body)) throw new HttpError(400, "Storage body must be a Buffer.");
  requireConfigured();

  const checksumSha256 = sha256Hex(body);
  const bucket = testAdapter ? "test-bucket" : getR2Config().bucket;

  let etag = "";
  if (testAdapter) {
    const res = await testAdapter.putObject({ key, body, contentType });
    etag = res?.etag || "";
  } else {
    const res = await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(checksumSha256, "hex").toString("base64"),
      })
    );
    etag = (res.ETag || "").replace(/"/g, "");
  }

  return {
    provider: "r2",
    bucket,
    key,
    contentType,
    byteSize: body.length,
    checksumSha256,
    etag,
    uploadedAt: new Date(),
  };
}

export async function getObjectBuffer(key) {
  if (!key) throw new HttpError(400, "Storage key is required.");
  requireConfigured();
  if (testAdapter) return testAdapter.getObjectBuffer(key);

  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: getR2Config().bucket, Key: key })
    );
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      throw new HttpError(404, "Stored document was not found.");
    }
    throw error;
  }
}

export async function deleteObject(key) {
  if (!key) return;
  requireConfigured();
  if (testAdapter) {
    if (testAdapter.deleteObject) await testAdapter.deleteObject(key);
    return;
  }
  await getClient().send(new DeleteObjectCommand({ Bucket: getR2Config().bucket, Key: key }));
}

export async function objectExists(key) {
  requireConfigured();
  if (testAdapter) {
    try {
      await testAdapter.getObjectBuffer(key);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: getR2Config().bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getPresignedGetUrl(key, ttl) {
  if (!key) throw new HttpError(400, "Storage key is required.");
  requireConfigured();
  const expiresIn =
    Number(ttl) > 0
      ? Math.floor(Number(ttl))
      : Number(process.env.R2_PRESIGN_TTL_SECONDS) > 0
        ? Math.floor(Number(process.env.R2_PRESIGN_TTL_SECONDS))
        : DEFAULT_PRESIGN_TTL_SECONDS;
  if (testAdapter) return testAdapter.getPresignedGetUrl(key, expiresIn);
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getR2Config().bucket, Key: key }),
    { expiresIn }
  );
}

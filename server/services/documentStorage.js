import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { HttpError } from "../utils/httpError.js";

export function getUploadsRoot() {
  if (process.env.UPLOADS_DIR) {
    return process.env.UPLOADS_DIR;
  }
  // On Vercel / serverless runtime, the root filesystem outside /tmp is read-only.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "hrms_uploads");
  }
  return path.join(process.cwd(), "uploads");
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const FORBIDDEN_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".php",
  ".js",
  ".mjs",
  ".vbs",
  ".msi",
  ".dll",
  ".scr",
  ".com",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateDocumentFile({ fileName, mimeType, fileSize }) {
  if (!fileName || typeof fileName !== "string") {
    throw new HttpError(400, "File name is required");
  }

  const ext = path.extname(fileName).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new HttpError(400, "Executable or disallowed file types cannot be uploaded.");
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new HttpError(400, "Unsupported document format. Allowed types: PDF, PNG, JPG, Word documents.");
  }

  if (fileSize && fileSize > MAX_FILE_SIZE) {
    throw new HttpError(400, "File size exceeds the 10 MB maximum upload limit.");
  }

  return true;
}

export async function saveDocumentFile({ databaseName, employeeId, fileName, fileData, mimeType }) {
  validateDocumentFile({ fileName, mimeType });

  let fileBuffer;
  if (Buffer.isBuffer(fileData)) {
    fileBuffer = fileData;
  } else if (typeof fileData === "string") {
    // Handle base64 data URLs or raw base64
    const base64Clean = fileData.replace(/^data:[^;]+;base64,/, "");
    fileBuffer = Buffer.from(base64Clean, "base64");
  } else {
    throw new HttpError(400, "Invalid file payload. Expected base64 or Buffer.");
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new HttpError(400, "File size exceeds the 10 MB maximum upload limit.");
  }

  const uploadsRoot = getUploadsRoot();
  const baseDir = path.join(uploadsRoot, databaseName, String(employeeId));
  await fs.promises.mkdir(baseDir, { recursive: true });

  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${safeName}`;
  const absolutePath = path.join(baseDir, storageKey);

  await fs.promises.writeFile(absolutePath, fileBuffer);

  return {
    storageKey,
    fileName: safeName,
    fileSize: fileBuffer.length,
    mimeType: mimeType || "application/octet-stream",
    absolutePath,
  };
}

export function getDocumentAbsolutePath({ databaseName, employeeId, storageKey }) {
  if (!storageKey || typeof storageKey !== "string") {
    return null;
  }
  // Sanitize path to prevent path traversal
  const safeKey = path.basename(storageKey);
  const uploadsRoot = getUploadsRoot();
  const filePath = path.join(uploadsRoot, databaseName, String(employeeId), safeKey);
  return fs.existsSync(filePath) ? filePath : null;
}

const LOGO_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const LOGO_ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

function detectLogoMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateCompanyLogoFile({ fileName, mimeType, fileSize }) {
  if (!fileName || typeof fileName !== "string") {
    throw new HttpError(400, "Logo file name is required.");
  }
  const ext = path.extname(fileName).toLowerCase();
  if (!LOGO_ALLOWED_EXT.has(ext)) {
    throw new HttpError(400, "Logo must be a PNG, JPEG, or WebP image.");
  }
  if (mimeType && !LOGO_ALLOWED_MIME.has(String(mimeType).toLowerCase())) {
    throw new HttpError(400, "Logo must be a PNG, JPEG, or WebP image.");
  }
  if (fileSize && fileSize > MAX_LOGO_SIZE) {
    throw new HttpError(400, "Logo file size must be 2 MB or smaller.");
  }
  return true;
}

export async function saveCompanyLogoFile({ databaseName, fileName, fileData, mimeType }) {
  validateCompanyLogoFile({ fileName, mimeType });

  let fileBuffer;
  if (Buffer.isBuffer(fileData)) {
    fileBuffer = fileData;
  } else if (typeof fileData === "string") {
    const base64Clean = fileData.replace(/^data:[^;]+;base64,/, "");
    fileBuffer = Buffer.from(base64Clean, "base64");
  } else {
    throw new HttpError(400, "Invalid logo payload. Expected base64 or Buffer.");
  }

  if (fileBuffer.length > MAX_LOGO_SIZE) {
    throw new HttpError(400, "Logo file size must be 2 MB or smaller.");
  }

  const detected = detectLogoMime(fileBuffer);
  if (!detected) {
    throw new HttpError(400, "The uploaded file is not a valid PNG, JPEG, or WebP image.");
  }

  const uploadsRoot = getUploadsRoot();
  const baseDir = path.join(uploadsRoot, String(databaseName), "branding");
  await fs.promises.mkdir(baseDir, { recursive: true });

  const ext = detected === "image/png" ? ".png" : detected === "image/webp" ? ".webp" : ".jpg";
  const storageKey = `logo_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
  const absolutePath = path.join(baseDir, storageKey);
  await fs.promises.writeFile(absolutePath, fileBuffer);

  return {
    storageKey,
    fileName: path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_"),
    fileSize: fileBuffer.length,
    mimeType: detected,
    absolutePath,
  };
}

export function getCompanyLogoAbsolutePath({ databaseName, storageKey }) {
  if (!storageKey || typeof storageKey !== "string") return null;
  const safeKey = path.basename(storageKey);
  if (!safeKey.startsWith("logo_")) return null;
  const uploadsRoot = getUploadsRoot();
  const filePath = path.join(uploadsRoot, String(databaseName), "branding", safeKey);
  return fs.existsSync(filePath) ? filePath : null;
}

export async function deleteCompanyLogoFile({ databaseName, storageKey }) {
  const filePath = getCompanyLogoAbsolutePath({ databaseName, storageKey });
  if (!filePath) return false;
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

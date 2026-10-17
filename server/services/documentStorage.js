import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HttpError } from "../utils/httpError.js";

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

  const baseDir = path.join(process.cwd(), "uploads", databaseName, String(employeeId));
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
  const filePath = path.join(process.cwd(), "uploads", databaseName, String(employeeId), safeKey);
  return fs.existsSync(filePath) ? filePath : null;
}

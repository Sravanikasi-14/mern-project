import path from "node:path";
import mongoose from "mongoose";
import { buildTenantKey, deleteObject, getObjectBuffer, putObject } from "./r2StorageService.js";
import { HttpError } from "../utils/httpError.js";
import { isStrictObjectId } from "./reportingManagerService.js";

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 5;
const ABSOLUTE_MAX_BYTES = 8 * 1024 * 1024;

const MIME_FOR_EXT = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
});

export function attachmentLimits() {
  const bytes = Number(process.env.CHAT_ATTACHMENT_MAX_BYTES);
  const count = Number(process.env.CHAT_ATTACHMENT_MAX_COUNT);
  return {
    maxBytes: Number.isFinite(bytes) && bytes >= 1024 && bytes <= ABSOLUTE_MAX_BYTES ? Math.floor(bytes) : DEFAULT_MAX_BYTES,
    maxCount: Number.isInteger(count) && count >= 1 && count <= 10 ? count : DEFAULT_MAX_COUNT,
  };
}

function sizeLabel(bytes) {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function assertObjectId(value, message) {
  if (!isStrictObjectId(value)) throw new HttpError(404, message);
  return new mongoose.Types.ObjectId(String(value));
}

async function requireActiveMember(models, conversationId, userId) {
  const member = await models.ConversationMember.findOne({
    conversationId,
    userId,
    leftAt: null,
  }).lean();
  if (!member) throw new HttpError(404, "Conversation not found");
  return member;
}

export function safeAttachmentName(fileName) {
  const raw = String(fileName || "").replace(/\\/g, "/").replace(/[\u0000-\u001f]/g, "").trim();
  const base = path.posix.basename(raw);
  if (!base || base === "." || base === ".." || base.length > 180) {
    throw new HttpError(400, "Choose a file with a valid name.");
  }
  const ext = path.posix.extname(base).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MIME_FOR_EXT, ext)) {
    throw new HttpError(400, "This file type is not supported.");
  }
  return { fileName: base, ext };
}

function detectImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function detectDocumentMime(buffer, ext) {
  if (!buffer || buffer.length < 1) return null;
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  const zip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  const ole = buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 65536)).toString("latin1");
  if (zip && sample.includes("word/")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (zip && sample.includes("xl/")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (ole && ext === ".doc") return "application/msword";
  if (ole && ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".csv" || ext === ".txt") {
    if (zip || ole || detectImageMime(buffer) || buffer.subarray(0, 5).toString("latin1") === "%PDF-") return null;
    if (buffer.includes(0)) return null;
    return ext === ".csv" ? "text/csv" : "text/plain";
  }
  return null;
}

export function inspectAttachment(fileName, fileData) {
  const { fileName: safeName, ext } = safeAttachmentName(fileName);
  const { maxBytes } = attachmentLimits();
  if (typeof fileData !== "string" || !fileData.trim()) {
    throw new HttpError(400, "Choose a file to attach.");
  }
  const prefixBudget = 80;
  const maxChars = Math.ceil(maxBytes / 3) * 4 + prefixBudget;
  if (fileData.length > maxChars) {
    throw new HttpError(400, `Each file must be ${sizeLabel(maxBytes)} or smaller.`);
  }
  const base64 = fileData.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new HttpError(400, "That file is empty.");
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `Each file must be ${sizeLabel(maxBytes)} or smaller.`);
  }
  const detected = detectImageMime(buffer) || detectDocumentMime(buffer, ext);
  const expected = MIME_FOR_EXT[ext];
  if (!detected || detected !== expected) {
    throw new HttpError(400, detected ? "This file does not match its type." : "This file type is not supported.");
  }
  return { fileName: safeName, mimeType: detected, buffer };
}

function publicFile(file) {
  return {
    id: String(file._id || file.fileId),
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    uploadedAt: file.uploadedAt || file.createdAt,
    uploadedBy: String(file.uploadedBy),
  };
}

export function publicAttachments(message) {
  if (!message || message.deletedAt) return [];
  return (message.attachments || []).map((file) => ({
    id: String(file.fileId),
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    uploadedAt: file.uploadedAt,
    uploadedBy: String(file.uploadedBy),
  }));
}

export async function uploadConversationFile(req, conversationId) {
  assertObjectId(conversationId, "Conversation not found");
  const { user, models, company } = req.auth;
  await requireActiveMember(models, conversationId, user._id);
  const inspected = inspectAttachment(req.body?.fileName, req.body?.fileData);
  const { maxCount } = attachmentLimits();
  const pending = await models.ChatFile.countDocuments({
    conversationId,
    uploadedBy: user._id,
    messageId: null,
  });
  if (pending >= maxCount) {
    throw new HttpError(400, `You can attach up to ${maxCount} files.`);
  }

  const fileId = new mongoose.Types.ObjectId();
  const storageKey = buildTenantKey(company.databaseName, "chat", String(conversationId), String(fileId));
  await putObject({ key: storageKey, body: inspected.buffer, contentType: inspected.mimeType });
  try {
    const saved = await models.ChatFile.create({
      _id: fileId,
      conversationId,
      uploadedBy: user._id,
      fileName: inspected.fileName,
      mimeType: inspected.mimeType,
      size: inspected.buffer.length,
      storageKey,
    });
    return publicFile(saved);
  } catch (error) {
    await deleteObject(storageKey).catch(() => {});
    throw error;
  }
}

export async function discardConversationFile(req, conversationId, fileId) {
  assertObjectId(conversationId, "Conversation not found");
  assertObjectId(fileId, "File not found");
  const { user, models } = req.auth;
  await requireActiveMember(models, conversationId, user._id);
  const file = await models.ChatFile.findOne({
    _id: fileId,
    conversationId,
    uploadedBy: user._id,
    messageId: null,
  });
  if (!file) throw new HttpError(404, "File not found");
  await deleteObject(file.storageKey);
  await file.deleteOne();
  return { id: String(file._id), deleted: true };
}

export async function prepareMessageAttachments(req, conversationId, rawIds) {
  if (rawIds == null) return [];
  if (!Array.isArray(rawIds)) throw new HttpError(400, "Choose a file from this conversation.");
  const { maxCount } = attachmentLimits();
  if (rawIds.length > maxCount) throw new HttpError(400, `You can attach up to ${maxCount} files.`);
  const ids = rawIds.map((id) => {
    if (!isStrictObjectId(id)) throw new HttpError(400, "Choose a file from this conversation.");
    return String(id);
  });
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "Choose each file once.");
  if (ids.length === 0) return [];
  const { user, models } = req.auth;
  const files = await models.ChatFile.find({
    _id: { $in: ids },
    conversationId,
    uploadedBy: user._id,
    messageId: null,
  }).lean();
  if (files.length !== ids.length) throw new HttpError(400, "Choose a file from this conversation.");
  const byId = new Map(files.map((file) => [String(file._id), file]));
  return ids.map((id) => {
    const file = byId.get(id);
    return {
      fileId: file._id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      storageKey: file.storageKey,
      uploadedAt: file.createdAt,
      uploadedBy: file.uploadedBy,
    };
  });
}

export async function linkMessageAttachments(models, message, userId) {
  const ids = (message.attachments || []).map((file) => file.fileId);
  if (ids.length === 0) return;
  const updated = await models.ChatFile.updateMany(
    { _id: { $in: ids }, conversationId: message.conversationId, uploadedBy: userId, messageId: null },
    { $set: { messageId: message._id } }
  );
  if (updated.modifiedCount !== ids.length) {
    await models.Message.deleteOne({ _id: message._id });
    throw new HttpError(409, "One of those files was already sent.");
  }
}

export async function releaseMessageAttachments(models, message) {
  for (const file of message.attachments || []) {
    if (!file?.storageKey) continue;
    const shared = await models.Message.countDocuments({
      _id: { $ne: message._id },
      deletedAt: null,
      "attachments.storageKey": file.storageKey,
    });
    if (shared > 0) continue;
    try {
      await deleteObject(file.storageKey);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[chat] attachment was not removed:", error.message);
      }
    }
  }
}

export async function readMessageAttachment(req, conversationId, messageId, fileId) {
  assertObjectId(conversationId, "Conversation not found");
  assertObjectId(messageId, "File not found");
  assertObjectId(fileId, "File not found");
  const { user, models } = req.auth;
  const member = await requireActiveMember(models, conversationId, user._id);
  const since = member.joinedAt ? new Date(member.joinedAt) : new Date(0);
  const message = await models.Message.findOne({
    _id: messageId,
    conversationId,
    createdAt: { $gte: since },
    deletedAt: null,
  }).lean();
  if (!message) throw new HttpError(404, "File not found");
  const attachment = (message.attachments || []).find((file) => String(file.fileId) === String(fileId));
  if (!attachment?.storageKey) throw new HttpError(404, "File not found");
  const body = await getObjectBuffer(attachment.storageKey);
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    body,
  };
}

export function contentDisposition(fileName, inline) {
  const fallback = String(fileName || "download").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || "download")}`;
}

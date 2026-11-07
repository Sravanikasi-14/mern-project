import { HttpError } from "./httpError.js";

/**
 * Shared helpers for HR / candidate electronic signature images.
 * Accepts PNG / JPEG / WebP data URLs (max ~500 KB) or generates an SVG from typed text.
 */

export const SIGNATURE_METHODS = Object.freeze(["DRAW", "UPLOAD", "TYPE"]);
export const MAX_SIGNATURE_BYTES = 500 * 1024;
export const MAX_TYPED_SIGNATURE_CHARS = 80;
export const SVG_SIGNATURE_MIME = "image/svg+xml";

const RASTER_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/** Convert a Mongo/BSON Binary, Uint8Array or Buffer into a Node Buffer. */
export function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  // bson Binary: `.buffer` may be larger than the logical length (`.position`).
  if (data.buffer) {
    const len = typeof data.position === "number" ? data.position : data.buffer.length;
    return Buffer.from(data.buffer).subarray(0, len);
  }
  return null;
}

export function detectRasterMime(buf) {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

export function sanitizeTypedSignature(text) {
  return String(text ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TYPED_SIGNATURE_CHARS);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Simple cursive SVG so Puppeteer always embeds a real image for typed signatures. */
export function buildTypedSignatureSvg(text) {
  const safe = xmlEscape(sanitizeTypedSignature(text));
  const width = Math.min(640, Math.max(220, 40 + safe.length * 22));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="80" viewBox="0 0 ${width} 80">` +
    `<text x="10" y="55" font-family="Segoe Script, Brush Script MT, Lucida Handwriting, cursive" ` +
    `font-size="36" fill="#1e3a8a">${safe}</text></svg>`
  );
}

export function bufferToDataUrl(buffer, mime) {
  const buf = toBuffer(buffer);
  if (!buf || !buf.length || !mime) return "";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Only raster (png/jpeg/webp) or server-generated SVG data URLs may be embedded in HTML <img>. */
export function isSafeSignatureDataUrl(src) {
  if (typeof src !== "string" || src.length > MAX_SIGNATURE_BYTES * 2) return false;
  return /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src);
}

function decodeImagePayload(raw, mimeHint) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpError(400, "A signature image is required.");
  }
  let mime = String(mimeHint || "").toLowerCase().trim();
  let b64 = raw.trim();
  const m = /^data:([^;,]+);base64,(.*)$/is.exec(b64);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  } else if (/^data:/i.test(b64)) {
    throw new HttpError(400, "Signature image must be a base64 data URL.");
  }
  if (mime && !RASTER_MIMES.has(mime)) {
    throw new HttpError(400, "Signature image must be a PNG, JPEG, or WebP file.");
  }
  b64 = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length === 0) {
    throw new HttpError(400, "Signature image data is not valid base64.");
  }
  // Reject oversize payloads before decoding the whole thing.
  if (Math.floor((b64.length * 3) / 4) > MAX_SIGNATURE_BYTES + 3) {
    throw new HttpError(400, "Signature image must be 500 KB or smaller.");
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length === 0) throw new HttpError(400, "Signature image is empty.");
  if (buffer.length > MAX_SIGNATURE_BYTES) {
    throw new HttpError(400, "Signature image must be 500 KB or smaller.");
  }
  const detected = detectRasterMime(buffer);
  if (!detected) {
    throw new HttpError(400, "The signature file is not a valid PNG, JPEG, or WebP image.");
  }
  return { buffer, mimeType: detected };
}

/**
 * Validate a signature payload from an HTTP body.
 * Accepts `{ method|signatureMethod, fileData|imageDataUrl, mimeType, typedText }`.
 * @returns {{ method: string, buffer: Buffer, mimeType: string, typedText: string }}
 */
export function normalizeSignatureInput(body = {}) {
  const method = String(body.signatureMethod ?? body.method ?? "").toUpperCase().trim();
  if (!SIGNATURE_METHODS.includes(method)) {
    throw new HttpError(400, "Choose a signature method: DRAW, UPLOAD, or TYPE.");
  }
  const typedText = sanitizeTypedSignature(body.typedText);
  const rawImage = body.imageDataUrl || body.fileData || "";

  if (method === "TYPE") {
    if (!typedText) throw new HttpError(400, "Type your name to create a signature.");
    if (rawImage) {
      // Client-rendered PNG of the typed text is accepted; fall back to SVG on any problem.
      try {
        const decoded = decodeImagePayload(rawImage, body.mimeType);
        return { method, typedText, ...decoded };
      } catch {
        /* use generated SVG */
      }
    }
    return {
      method,
      typedText,
      buffer: Buffer.from(buildTypedSignatureSvg(typedText), "utf8"),
      mimeType: SVG_SIGNATURE_MIME,
    };
  }

  if (!rawImage) {
    throw new HttpError(
      400,
      method === "DRAW" ? "Draw your signature before saving." : "Upload a signature image before saving."
    );
  }
  const decoded = decodeImagePayload(rawImage, body.mimeType);
  return { method, typedText: "", ...decoded };
}

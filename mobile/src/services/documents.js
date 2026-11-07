import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FileOpener } from "@capacitor-community/file-opener";

/**
 * Capacitor-aware document helpers for the Android WebView.
 * Browser/dev builds keep using Blob URLs + <a download>.
 * Native builds write to app cache, then open or share via system intents.
 * Auth stays on the Axios request that produced the Blob — never public URLs.
 */

const CACHE_SUBDIR = "hrms-docs";

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function sanitizeFilename(name, fallback = "document") {
  const raw = String(name || fallback).trim() || fallback;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function ensureExtension(filename, mimeType, defaultExt = "") {
  const safe = sanitizeFilename(filename);
  if (/\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
  const fromMime = mimeExtension(mimeType);
  const ext = fromMime || defaultExt;
  return ext ? `${safe}.${ext.replace(/^\./, "")}` : safe;
}

function mimeExtension(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("csv") || type.includes("text/csv")) return "csv";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("msword")) return "doc";
  if (type.includes("wordprocessingml")) return "docx";
  if (type.includes("sheet") || type.includes("excel")) return "xlsx";
  return "";
}

export function guessMimeType(filename, contentType) {
  const header = String(contentType || "").split(";")[0].trim();
  if (header && header !== "application/octet-stream") return header;
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return header || "application/octet-stream";
}

export function filenameFromContentDisposition(headers, fallback) {
  const cd =
    headers?.["content-disposition"] ||
    headers?.["Content-Disposition"] ||
    "";
  if (!cd) return sanitizeFilename(fallback);
  const utfMatch = String(cd).match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(utfMatch[1]));
    } catch {
      /* fall through */
    }
  }
  const plain = String(cd).match(/filename="?([^";]+)"?/i);
  if (plain?.[1]) return sanitizeFilename(plain[1]);
  return sanitizeFilename(fallback);
}

export async function assertBinaryBlob(blob, contentType) {
  if (!blob) throw new Error("No file data was returned.");
  const type = String(contentType || blob.type || "").toLowerCase();
  if (type.includes("application/json") || type.startsWith("text/")) {
    const text = await blob.text();
    let message = "Could not download this document.";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) message = parsed.message;
    } catch {
      if (text && text.length < 300) message = text;
    }
    const error = new Error(message);
    error.code = "NOT_BINARY";
    throw error;
  }
  return blob;
}

export async function blobFromAxiosResponse(response, fallbackName = "document") {
  const contentType = response?.headers?.["content-type"] || response?.data?.type || "";
  const blob = response?.data;
  await assertBinaryBlob(blob, contentType);
  const filename = filenameFromContentDisposition(
    response?.headers,
    ensureExtension(fallbackName, contentType)
  );
  return {
    blob,
    contentType: guessMimeType(filename, contentType),
    filename,
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the downloaded file."));
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function uniqueCachePath(filename) {
  const safe = sanitizeFilename(filename);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${CACHE_SUBDIR}/${stamp}_${safe}`;
}

/**
 * Capacitor writeFile defaults to recursive=false, so nested paths like
 * `hrms-docs/file.pdf` fail unless the parent folder exists.
 * Create CACHE_SUBDIR first (ignore "already exists"), then write with recursive.
 */
async function ensureCacheDocsDir() {
  try {
    await Filesystem.mkdir({
      path: CACHE_SUBDIR,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch (err) {
    const message = String(err?.message || err || "").toLowerCase();
    // Capacitor / Android may reject when the folder is already present.
    if (
      message.includes("exists") ||
      message.includes("exist") ||
      message.includes("already") ||
      err?.code === "OS-PLUG-FILE-0009"
    ) {
      return;
    }
    console.error("[documents] Failed to create cache directory", CACHE_SUBDIR, err);
    throw new Error(
      `Could not prepare the download folder (${CACHE_SUBDIR}): ${err?.message || err}`
    );
  }
}

async function writeBlobToCache(blob, filename) {
  await ensureCacheDocsDir();
  const path = await uniqueCachePath(filename);
  const data = await blobToBase64(blob);
  try {
    const written = await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Cache,
      // Create any missing parents if mkdir raced or nested paths deepen later.
      recursive: true,
    });
    return {
      path,
      uri: written.uri,
      filename: sanitizeFilename(filename),
    };
  } catch (err) {
    console.error("[documents] writeFile failed", { path, directory: "Cache" }, err);
    throw new Error(err?.message || "Could not save the document on this device.");
  }
}

async function downloadInBrowser(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizeFilename(filename);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

/**
 * Persist a document for the user.
 * Native: write to app cache and open the share sheet (Save to Files / Drive / etc.).
 * Browser: trigger a normal download.
 */
export async function saveDocument({ blob, filename, mimeType }) {
  const safeName = ensureExtension(filename, mimeType || blob?.type);
  const type = guessMimeType(safeName, mimeType || blob?.type);

  if (!isNativePlatform()) {
    await downloadInBrowser(blob, safeName);
    return { mode: "browser-download", filename: safeName, mimeType: type };
  }

  const written = await writeBlobToCache(blob, safeName);
  try {
    await Share.share({
      title: safeName,
      files: [written.uri],
      dialogTitle: "Save or share document",
    });
  } catch (err) {
    // User cancelled share sheet — file is still in cache; treat as soft success
    if (String(err?.message || err).toLowerCase().includes("cancel")) {
      return { mode: "native-saved", ...written, mimeType: type, cancelledShare: true };
    }
    throw err;
  }
  return { mode: "native-share-save", ...written, mimeType: type };
}

/**
 * Open/view a document.
 * Native: write to cache + FileOpener (falls back to Share).
 * Browser: window.open blob URL, with download fallback if popups blocked.
 */
export async function openDocument({ blob, filename, mimeType }) {
  const safeName = ensureExtension(filename, mimeType || blob?.type, "pdf");
  const type = guessMimeType(safeName, mimeType || blob?.type);

  if (!isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      await downloadInBrowser(blob, safeName);
      URL.revokeObjectURL(url);
      return { mode: "browser-download-fallback", filename: safeName, mimeType: type };
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { mode: "browser-preview", filename: safeName, mimeType: type };
  }

  const written = await writeBlobToCache(blob, safeName);
  try {
    await FileOpener.open({
      filePath: written.uri,
      contentType: type,
      openWithDefault: true,
    });
    return { mode: "native-open", ...written, mimeType: type };
  } catch (openErr) {
    try {
      await Share.share({
        title: safeName,
        files: [written.uri],
        dialogTitle: "Open with…",
      });
      return { mode: "native-open-via-share", ...written, mimeType: type };
    } catch {
      const error = new Error(
        openErr?.message || "No app is available to open this document."
      );
      error.cause = openErr;
      throw error;
    }
  }
}

/**
 * Share an already-fetched blob through the system share sheet.
 */
export async function shareDocument({ blob, filename, mimeType }) {
  const safeName = ensureExtension(filename, mimeType || blob?.type);
  const type = guessMimeType(safeName, mimeType || blob?.type);

  if (!isNativePlatform()) {
    if (typeof navigator !== "undefined" && navigator.share && navigator.canShare) {
      const file = new File([blob], safeName, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: safeName });
        return { mode: "web-share", filename: safeName, mimeType: type };
      }
    }
    await downloadInBrowser(blob, safeName);
    return { mode: "browser-download-fallback", filename: safeName, mimeType: type };
  }

  const written = await writeBlobToCache(blob, safeName);
  await Share.share({
    title: safeName,
    files: [written.uri],
    dialogTitle: "Share document",
  });
  return { mode: "native-share", ...written, mimeType: type };
}

/**
 * Map Axios / network failures into short user-facing messages.
 */
export function documentErrorMessage(err, fallback = "Could not download this document.") {
  if (!err) return fallback;
  if (err.response?.status === 401) {
    return "Your session has expired. Please sign in again.";
  }
  if (err.response?.status === 403) {
    return "You do not have permission to access this document.";
  }
  if (err.response?.status === 404) {
    return "This document was not found.";
  }
  if (err.response?.data instanceof Blob) {
    return fallback;
  }
  return err.response?.data?.message || err.message || fallback;
}

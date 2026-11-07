import { HttpError } from "../utils/httpError.js";

/**
 * Optional DOCX → PDF conversion via a self-hosted LibreOffice/unoserver-style worker.
 *
 * Env:
 *   LIBREOFFICE_CONVERT_URL   – base URL of the convert endpoint (POST multipart or raw)
 *   LIBREOFFICE_CONVERT_TOKEN – optional Bearer token
 *
 * When unset: returns a clear CONVERSION_NOT_CONFIGURED error.
 * Never falls back to a paid API.
 */

const REQUEST_TIMEOUT_MS = 90000;
const NOT_CONFIGURED_MESSAGE =
  "DOCX to PDF conversion is not configured. Set LIBREOFFICE_CONVERT_URL to a self-hosted LibreOffice convert worker, or download the filled DOCX instead. A PDF version is not required for DOCX templates to be usable.";

let converter = null;

/** Test hook: inject `async (buffer) => Buffer`. Pass null to restore env-based worker. */
export function setConverter(mock) {
  converter = typeof mock === "function" ? mock : null;
}

export function isConversionConfigured() {
  return Boolean(converter || process.env.LIBREOFFICE_CONVERT_URL);
}

export function getConversionStatus() {
  const configured = isConversionConfigured();
  return {
    configured,
    provider: configured ? (converter ? "test" : "libreoffice") : null,
    message: configured
      ? "DOCX to PDF conversion is available via the configured LibreOffice worker."
      : NOT_CONFIGURED_MESSAGE,
  };
}

async function convertWithLibreOfficeWorker(buffer) {
  const baseUrl = String(process.env.LIBREOFFICE_CONVERT_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE, { code: "CONVERSION_NOT_CONFIGURED" });
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "document.docx"
  );

  const headers = { Accept: "application/pdf, application/json" };
  const token = process.env.LIBREOFFICE_CONVERT_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    throw new HttpError(502, `DOCX to PDF conversion failed: ${error.message}`, {
      code: "CONVERSION_FAILED",
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 503 || response.status === 501) {
    throw new HttpError(503, NOT_CONFIGURED_MESSAGE, { code: "CONVERSION_NOT_CONFIGURED" });
  }

  if (!response.ok) {
    throw new HttpError(502, `DOCX to PDF conversion failed (worker status ${response.status}).`, {
      code: "CONVERSION_FAILED",
    });
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new HttpError(502, "DOCX to PDF conversion produced an invalid PDF.", {
        code: "CONVERSION_FAILED",
      });
    }
    return bytes;
  }

  // Some workers return JSON with base64 FileData / pdfBase64
  const payload = await response.json().catch(() => null);
  const b64 = payload?.pdfBase64 || payload?.FileData || payload?.Files?.[0]?.FileData;
  if (!b64) {
    throw new HttpError(502, "DOCX to PDF conversion returned no file.", { code: "CONVERSION_FAILED" });
  }
  return Buffer.from(b64, "base64");
}

export async function convertDocxToPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, "A non-empty DOCX buffer is required for conversion.");
  }

  let pdf;
  if (converter) {
    pdf = await converter(buffer);
  } else {
    if (!process.env.LIBREOFFICE_CONVERT_URL) {
      throw new HttpError(503, NOT_CONFIGURED_MESSAGE, { code: "CONVERSION_NOT_CONFIGURED" });
    }
    pdf = await convertWithLibreOfficeWorker(buffer);
  }

  if (!Buffer.isBuffer(pdf) || pdf.length === 0 || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new HttpError(502, "DOCX to PDF conversion produced an invalid PDF.", {
      code: "CONVERSION_FAILED",
    });
  }
  return pdf;
}

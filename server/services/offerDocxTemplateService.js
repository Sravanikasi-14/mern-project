import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { HttpError } from "../utils/httpError.js";
import { OFFER_FIELD_CATALOG, buildOfferFieldValues } from "./offerTemplateRenderService.js";

/**
 * Uploaded DOCX template helpers: validation, {{placeholder}} detection,
 * mapping validation, and filling.
 */

import { getOfferDocxMaxBytes } from "./offerGridFsStorageService.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Configurable via OFFER_DOCX_MAX_BYTES (default 2 MB). */
export function getMaxDocxBytes() {
  return getOfferDocxMaxBytes();
}
/** Numeric snapshot for simple imports; prefer getMaxDocxBytes() when env may change. */
export const MAX_DOCX_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
const MAX_XML_CHARS = 20 * 1024 * 1024;
const PLACEHOLDER_REGEX = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const PART_REGEX = /^word\/(document|header\d*|footer\d*)\.xml$/;

function openZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, "A DOCX file is required.");
  }
  const maxBytes = getMaxDocxBytes();
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `DOCX file is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).`);
  }
  // ZIP local file header magic: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new HttpError(400, "The uploaded file is not a valid DOCX document.");
  }
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new HttpError(400, "The uploaded file is not a valid DOCX document.");
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES || !zip.file("word/document.xml") || !zip.file("[Content_Types].xml")) {
    throw new HttpError(400, "The uploaded file is not a valid DOCX document.");
  }
  for (const name of names) {
    if (PART_REGEX.test(name)) {
      const text = zip.file(name).asText();
      if (text.length > MAX_XML_CHARS) {
        throw new HttpError(400, "The uploaded DOCX content is too large.");
      }
    }
  }
  return zip;
}

function buildDoc(zip) {
  try {
    return new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
  } catch (error) {
    const detail = error?.properties?.errors?.[0]?.properties?.explanation || error.message;
    throw new HttpError(400, `The DOCX template has invalid placeholder syntax: ${detail}`, {
      code: "INVALID_TEMPLATE",
    });
  }
}

/** Validate a DOCX buffer and return the unique simple {{placeholders}} found. */
export function inspectDocx(buffer) {
  const zip = openZip(buffer);
  const doc = buildDoc(zip);
  const found = new Set();
  for (const name of Object.keys(zip.files)) {
    if (!PART_REGEX.test(name)) continue;
    let text = "";
    try {
      text = doc.getFullText(name);
    } catch {
      text = "";
    }
    for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
      found.add(match[1]);
    }
  }
  return { placeholders: [...found].sort() };
}

function normalizeKey(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

/** Suggest mappings for placeholders whose names match the offer field catalog. */
export function suggestMappings(placeholders) {
  return placeholders.map((placeholder) => {
    const key = normalizeKey(placeholder);
    const aliases = {
      position: "designation",
      job_title: "designation",
      full_name: "candidate_name",
      salary: "monthly_salary",
      date_of_joining: "joining_date",
    };
    const field = OFFER_FIELD_CATALOG.includes(key) ? key : aliases[key] || "";
    return { placeholder, field, required: true, defaultValue: "", format: "" };
  });
}

/** Validate user-supplied mappings against detected placeholders. Returns cleaned mappings. */
export function validateMappings(rawMappings, placeholders) {
  if (!Array.isArray(rawMappings)) {
    throw new HttpError(400, "mappings must be an array.");
  }
  const known = new Set(placeholders);
  const errors = {};
  const cleaned = [];
  const seen = new Set();
  rawMappings.forEach((m, i) => {
    const placeholder = String(m?.placeholder || "").trim();
    const field = String(m?.field || "").trim();
    if (!known.has(placeholder)) {
      errors[`mappings[${i}].placeholder`] = `'${placeholder}' is not a placeholder in this template.`;
      return;
    }
    if (seen.has(placeholder)) {
      errors[`mappings[${i}].placeholder`] = `'${placeholder}' is mapped more than once.`;
      return;
    }
    if (field && !OFFER_FIELD_CATALOG.includes(field)) {
      errors[`mappings[${i}].field`] = `'${field}' is not a supported offer field.`;
      return;
    }
    seen.add(placeholder);
    cleaned.push({
      placeholder,
      field,
      required: m?.required !== false,
      defaultValue: String(m?.defaultValue ?? "").slice(0, 500),
      format: String(m?.format ?? "").slice(0, 50),
    });
  });
  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, "Invalid placeholder mappings.", { errors });
  }
  return cleaned;
}

/** Placeholders that still lack a field or default value (required ones only). */
export function findMissingMappings(placeholders, mappings) {
  const byName = new Map((mappings || []).map((m) => [m.placeholder, m]));
  return placeholders.filter((p) => {
    const m = byName.get(p);
    if (!m) return true;
    if (m.required === false) return false;
    return !(m.field || (m.defaultValue && m.defaultValue.length > 0));
  });
}

/** Fill a DOCX template with offer data. Returns a DOCX buffer. */
export function fillDocxTemplate(buffer, mappings, offerData, company) {
  const zip = openZip(buffer);
  const doc = buildDoc(zip);
  const fields = buildOfferFieldValues(offerData, company);
  const data = {};
  for (const m of mappings || []) {
    let value = m.field ? fields[m.field] : m.defaultValue;
    if (!value && m.defaultValue) value = m.defaultValue;
    value = value == null ? "" : String(value);
    if (m.format === "uppercase") value = value.toUpperCase();
    data[m.placeholder] = value;
  }
  try {
    doc.render(data);
  } catch (error) {
    const detail = error?.properties?.errors?.[0]?.properties?.explanation || error.message;
    throw new HttpError(400, `Failed to fill the DOCX template: ${detail}`, { code: "INVALID_TEMPLATE" });
  }
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Simplified HTML preview for DOCX templates (no conversion needed). */
export function renderDocxPlaceholderPreviewHtml(template, offerData, company) {
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const fields = buildOfferFieldValues(offerData, company);
  const rows = (template.placeholderMappings || [])
    .map((m) => {
      const value = m.field ? fields[m.field] : m.defaultValue;
      return `<tr><td style="padding:4px 12px 4px 0"><code>{{${esc(m.placeholder)}}}</code></td><td>${esc(
        value || m.defaultValue || ""
      )}</td></tr>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(
    template.name
  )}</title></head><body style="font-family:Arial,sans-serif;font-size:13px;padding:24px"><h3>${esc(
    template.name
  )}</h3><p>Uploaded DOCX template. The final PDF is produced from your Word document; this table shows how placeholders will be filled.</p><table style="border-collapse:collapse">${rows}</table></body></html>`;
}

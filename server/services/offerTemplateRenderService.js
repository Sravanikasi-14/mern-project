import Company from "../models/Company.js";
import {
  MAX_SIGNATURE_BYTES,
  SVG_SIGNATURE_MIME,
  bufferToDataUrl,
  toBuffer,
} from "../utils/signatureImage.js";
import {
  buildMasterOfferHtml,
  getDefaultLegalSections,
  getMasterSectionConfig,
} from "../assets/offer-templates/hrms-default-master.js";

/**
 * Rendering helpers for DEFAULT_BUILDER templates and shared offer-field catalog
 * (also used to map placeholders in uploaded DOCX templates).
 */

/** Offer fields that a DOCX placeholder may be mapped to. */
export const OFFER_FIELD_CATALOG = Object.freeze([
  "company_name",
  "candidate_name",
  "candidate_email",
  "designation",
  "department",
  "employment_type",
  "work_location",
  "reporting_manager",
  "joining_date",
  "offer_date",
  "monthly_salary",
  "annual_salary",
]);

/** Fictional sample data for previews (no real people). */
export const SAMPLE_OFFER_DATA = Object.freeze({
  candidate: { fullName: "Candidate Name", email: "candidate@example.com" },
  position: "Senior Software Engineer",
  department: "Engineering",
  workLocation: "Head Office",
  reportingManager: "Reporting Manager",
  employmentType: "Full-time Permanent",
  monthlySalary: 100000,
  annualSalary: 1200000,
});

const ALLOWED_LOGO_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

/** Load company logo as a data URL (logoData is select:false on Company). */
export async function loadCompanyLogoDataUrl(company) {
  try {
    if (!company?._id) return "";
    const doc = await Company.findById(company._id)
      .select("branding.logoMimeType +branding.logoData")
      .lean();
    const mime = String(doc?.branding?.logoMimeType || "").toLowerCase();
    const data = doc?.branding?.logoData;
    if (!data || !ALLOWED_LOGO_MIME.has(mime)) return "";
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer || data);
    if (buf.length === 0 || buf.length > 1_500_000) return "";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

const ALLOWED_SIGNATURE_RENDER_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  SVG_SIGNATURE_MIME,
]);

/**
 * Load the HR signature for the company letterhead.
 * `signatureData` is select:false — mirrors loadCompanyLogoDataUrl and fetches bytes explicitly
 * unless the caller already supplied them on `company.letterhead.signatureData`.
 * @returns {Promise<{ dataUrl: string|null, method: string, typedText: string }>}
 */
export async function loadCompanySignature(company) {
  const empty = { dataUrl: null, method: "", typedText: "" };
  try {
    if (!company?._id) return empty;
    let lh = company.letterhead;
    let data = lh?.signatureData;
    if (!data) {
      const doc = await Company.findById(company._id)
        .select(
          "letterhead.signatureMethod letterhead.signatureMimeType letterhead.signatureTypedText +letterhead.signatureData"
        )
        .lean();
      lh = doc?.letterhead;
      data = lh?.signatureData;
    }
    const method = String(lh?.signatureMethod || "").toUpperCase();
    const typedText = String(lh?.signatureTypedText || "");
    const mime = String(lh?.signatureMimeType || "").toLowerCase();
    const buf = toBuffer(data);
    if (buf && buf.length > 0 && buf.length <= MAX_SIGNATURE_BYTES && ALLOWED_SIGNATURE_RENDER_MIME.has(mime)) {
      return { dataUrl: bufferToDataUrl(buf, mime === "image/jpg" ? "image/jpeg" : mime), method, typedText };
    }
    // TYPE with text but no stored image: HTML renders typed cursive text instead.
    return { dataUrl: null, method, typedText: method === "TYPE" ? typedText : "" };
  } catch {
    return empty;
  }
}

/** Data URL for the HR signature image, or null when there is none (see loadCompanySignature). */
export async function loadCompanySignatureDataUrl(company) {
  const { dataUrl } = await loadCompanySignature(company);
  return dataUrl;
}

function asDate(value, fallback) {
  const d = value ? new Date(value) : fallback;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

/** Raw (unescaped) values keyed by OFFER_FIELD_CATALOG, formatted for documents. */
export function buildOfferFieldValues(offerData = {}, company = {}) {
  const monthly = Number(offerData.monthlySalary) || 0;
  const annual = Number(offerData.annualSalary) || monthly * 12;
  const fmtDate = (v) =>
    v
      ? asDate(v, null)?.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) || ""
      : "";
  const fmtMoney = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  return {
    company_name: company?.companyName || company?.name || "",
    candidate_name: offerData.candidate?.fullName || "",
    candidate_email: offerData.candidate?.email || "",
    designation: offerData.position || "",
    department: offerData.department || "",
    employment_type: offerData.employmentType || "Full-time Permanent",
    work_location: offerData.workLocation || "",
    reporting_manager: offerData.reportingManager || "",
    joining_date: fmtDate(offerData.joiningDate),
    offer_date: fmtDate(offerData.createdAt || new Date()),
    monthly_salary: monthly ? fmtMoney(monthly) : "",
    annual_salary: annual ? fmtMoney(annual) : "",
  };
}

/** Build the master snapshot stored on a tenant template version. */
export function buildBuilderSnapshot({ sectionConfig, legalSections, settings, masterCode, masterVersion }) {
  const config = sectionConfig && Object.keys(sectionConfig).length ? sectionConfig : getMasterSectionConfig();
  return JSON.parse(
    JSON.stringify({
      sectionConfig: config,
      legalSections: Array.isArray(legalSections) ? legalSections : getDefaultLegalSections(),
      settings: settings || {},
      masterCode: masterCode || null,
      masterVersion: masterVersion ?? null,
    })
  );
}

/** Pick the snapshot for a template (optionally a frozen historical version). */
export function getTemplateSnapshot(template, version) {
  if (!template) return null;
  const target = version ?? template.version;
  const entry = (template.versions || []).find((v) => v.version === target);
  return entry?.snapshot || null;
}

export function buildRenderContext({ offerData = {}, company = {}, snapshot = {}, logoDataUrl = "", signature = null }) {
  const settings = { ...(snapshot.settings || {}) };
  const config = snapshot.sectionConfig || {};
  const defaults = config.defaults || {};
  const values = buildOfferFieldValues(offerData, company);
  return {
    companyName: values.company_name,
    companyWebsite: settings.companyWebsite || "",
    companyEmail: settings.companyEmail || company?.primaryContact?.email || "",
    companyPhone: settings.companyPhone || company?.primaryContact?.phoneNumber || "",
    companyAddress: settings.companyAddress || "",
    logoDataUrl: settings.showLogo === false ? "" : logoDataUrl,
    candidateName: values.candidate_name,
    candidateEmail: values.candidate_email,
    designation: values.designation,
    department: values.department,
    employmentType: values.employment_type,
    workLocation: values.work_location,
    reportingManager: values.reporting_manager,
    joiningDate: offerData.joiningDate,
    offerDate: offerData.createdAt || new Date(),
    place: settings.place || values.work_location,
    monthlySalary: Number(offerData.monthlySalary) || 0,
    annualSalary: Number(offerData.annualSalary) || (Number(offerData.monthlySalary) || 0) * 12,
    signatoryName: settings.signatoryName || "",
    signatoryTitle: settings.signatoryTitle || "Authorized Signatory",
    probationMonths: settings.probationMonths ?? defaults.probationMonths,
    probationNoticeDays: settings.probationNoticeDays ?? defaults.probationNoticeDays,
    noticeDays: settings.noticeDays ?? defaults.noticeDays,
    officeHours: settings.officeHours || defaults.officeHours,
    workingDays: settings.workingDays || defaults.workingDays,
    acceptanceDays: settings.acceptanceDays ?? defaults.acceptanceDays,
    defaults,
    cover: config.cover,
    execution: config.execution,
    sections: snapshot.legalSections,
    signature,
  };
}

/** Render builder HTML from a template version snapshot + offer data. */
export function renderBuilderHtml({ snapshot, offerData, company, logoDataUrl = "", signature = null }) {
  return buildMasterOfferHtml(buildRenderContext({ offerData, company, snapshot, logoDataUrl, signature }));
}

/** Short notice HTML stored in OfferLetter.content for UPLOADED_DOCX offers. */
export function renderDocxOfferSummaryHtml({ offerData, company, template }) {
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const v = buildOfferFieldValues(offerData, company);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Offer Letter</title></head><body style="font-family:Arial,sans-serif;font-size:13px;color:#1f2937;padding:24px">
<h2 style="margin:0 0 8px">${esc(v.company_name)} - Offer Letter</h2>
<p>This offer was generated from the company template <strong>${esc(template?.name || "Uploaded template")}</strong>. The formal document is the populated Word file (DOCX). A PDF is available only when a LibreOffice convert worker is configured.</p>
<table style="border-collapse:collapse;margin-top:12px">
<tr><td style="padding:4px 12px 4px 0"><strong>Candidate</strong></td><td>${esc(v.candidate_name)}</td></tr>
<tr><td style="padding:4px 12px 4px 0"><strong>Designation</strong></td><td>${esc(v.designation)}</td></tr>
<tr><td style="padding:4px 12px 4px 0"><strong>Employment type</strong></td><td>${esc(v.employment_type)}</td></tr>
<tr><td style="padding:4px 12px 4px 0"><strong>Joining date</strong></td><td>${esc(v.joining_date)}</td></tr>
<tr><td style="padding:4px 12px 4px 0"><strong>Monthly salary</strong></td><td>${esc(v.monthly_salary)}</td></tr>
</table></body></html>`;
}

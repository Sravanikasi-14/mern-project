/**
 * Single standard HRMS offer renderer.
 * Source of truth: assets/offer-templates/hrms-default-master.js
 */
import {
  MASTER_TEMPLATE_CODE,
  MASTER_TEMPLATE_VERSION,
  getMasterSectionConfig,
  getDefaultLegalSections,
  buildMasterOfferHtml,
  injectCandidateSignature,
  safeSignatureSrc,
} from "../assets/offer-templates/hrms-default-master.js";
import {
  loadCompanyLogoDataUrl,
  loadCompanySignature,
  buildOfferFieldValues,
} from "./offerTemplateRenderService.js";
import { bufferToDataUrl, toBuffer } from "../utils/signatureImage.js";
import { generateOfferLetterPdf } from "./pdfService.js";

function trimStr(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

export function getCompanyLetterhead(company = {}) {
  const lh = company.letterhead || {};
  return {
    address: trimStr(lh.address, 1000),
    website: trimStr(lh.website, 300),
    signatoryName: trimStr(lh.signatoryName, 200),
    signatoryTitle: trimStr(lh.signatoryTitle, 200) || "Authorized Signatory",
  };
}

export function buildOfferDataFromSources(offerLetter, extras = {}) {
  const snap = offerLetter?.offerDataSnapshot || {};
  const candidate = extras.candidate || offerLetter?.candidate || snap.candidate || {};
  const monthly =
    extras.monthlySalary != null
      ? Number(extras.monthlySalary)
      : Number(offerLetter?.monthlySalary ?? snap.monthlySalary) || 0;
  return {
    candidate: {
      fullName: String(candidate.fullName || "").trim(),
      email: String(candidate.email || "").trim().toLowerCase(),
    },
    position: String(extras.position ?? offerLetter?.position ?? snap.position ?? "").trim(),
    department: String(extras.department ?? offerLetter?.department ?? snap.department ?? "").trim(),
    workLocation: String(
      extras.workLocation ?? offerLetter?.workLocation ?? snap.workLocation ?? ""
    ).trim(),
    reportingManager: String(
      extras.reportingManager ?? offerLetter?.reportingManager ?? snap.reportingManager ?? ""
    ).trim(),
    employmentType: String(
      extras.employmentType ?? offerLetter?.employmentType ?? snap.employmentType ?? "Full-time Permanent"
    ).trim(),
    monthlySalary: monthly,
    annualSalary:
      extras.annualSalary != null
        ? Number(extras.annualSalary)
        : Number(offerLetter?.annualSalary ?? snap.annualSalary) || Math.round(monthly * 12),
    joiningDate: extras.joiningDate
      ? new Date(extras.joiningDate)
      : offerLetter?.joiningDate
        ? new Date(offerLetter.joiningDate)
        : snap.joiningDate
          ? new Date(snap.joiningDate)
          : new Date(),
    clauses: Array.isArray(extras.clauses)
      ? extras.clauses
      : Array.isArray(offerLetter?.clauses)
        ? offerLetter.clauses
        : Array.isArray(snap.clauses)
          ? snap.clauses
          : [],
    createdAt: offerLetter?.createdAt || snap.createdAt || new Date(),
    signatoryName:
      extras.signatoryName != null
        ? trimStr(extras.signatoryName, 200)
        : trimStr(snap.signatoryName, 200),
    signatoryTitle:
      extras.signatoryTitle != null
        ? trimStr(extras.signatoryTitle, 200)
        : trimStr(snap.signatoryTitle, 200),
  };
}

/** HR signature (image data URL and/or typed text) captured for a render/freeze. */
export async function resolveHrSignatureForRender({ offerData, company, includeHrSignature = true }) {
  // A frozen copy on the offer snapshot always wins (immutability of what was issued).
  const frozen = safeSignatureSrc(offerData?.hrSignatureDataUrl);
  if (frozen) {
    return { dataUrl: frozen, typedText: String(offerData?.hrTypedSignature || "") };
  }
  if (offerData?.hrTypedSignature) {
    return { dataUrl: "", typedText: String(offerData.hrTypedSignature) };
  }
  if (!includeHrSignature) return { dataUrl: "", typedText: "" };
  const hr = await loadCompanySignature(company);
  return { dataUrl: hr.dataUrl || "", typedText: hr.typedText || "" };
}

export async function renderStandardOfferHtml({
  offerData,
  company,
  signature = null,
  includeHrSignature = true,
}) {
  const letterhead = getCompanyLetterhead(company);
  const logoDataUrl = await loadCompanyLogoDataUrl(company);
  const hrSig = await resolveHrSignatureForRender({ offerData, company, includeHrSignature });
  const candidateImage = safeSignatureSrc(signature?.imageDataUrl);
  const values = buildOfferFieldValues(offerData, company);
  const sectionConfig = getMasterSectionConfig();
  const legalSections = getDefaultLegalSections();
  const defaults = sectionConfig.defaults || {};

  const signatoryName =
    trimStr(offerData?.signatoryName, 200) || letterhead.signatoryName || "";
  const signatoryTitle =
    trimStr(offerData?.signatoryTitle, 200) ||
    letterhead.signatoryTitle ||
    "Authorized Signatory";

  const context = {
    companyName: values.company_name,
    companyWebsite: letterhead.website || "",
    companyEmail: company?.primaryContact?.email || "",
    companyPhone: company?.primaryContact?.phoneNumber || "",
    companyAddress: letterhead.address || "",
    logoDataUrl: logoDataUrl || "",
    candidateName: values.candidate_name,
    candidateEmail: values.candidate_email,
    designation: values.designation,
    department: values.department,
    employmentType: values.employment_type,
    workLocation: values.work_location,
    reportingManager: values.reporting_manager,
    joiningDate: offerData.joiningDate,
    offerDate: offerData.createdAt || new Date(),
    place: letterhead.address || values.work_location,
    monthlySalary: Number(offerData.monthlySalary) || 0,
    annualSalary:
      Number(offerData.annualSalary) || (Number(offerData.monthlySalary) || 0) * 12,
    signatoryName,
    signatoryTitle,
    probationMonths: defaults.probationMonths,
    probationNoticeDays: defaults.probationNoticeDays,
    noticeDays: defaults.noticeDays,
    officeHours: defaults.officeHours,
    workingDays: defaults.workingDays,
    acceptanceDays: defaults.acceptanceDays,
    defaults,
    cover: sectionConfig.cover,
    execution: sectionConfig.execution,
    sections: legalSections,
    signature,
    hrSignatureDataUrl: hrSig.dataUrl,
    hrTypedSignature: hrSig.typedText,
    candidateSignatureDataUrl: candidateImage,
    candidateTypedSignature: candidateImage ? "" : String(signature?.typedText || ""),
    masterCode: MASTER_TEMPLATE_CODE,
    masterVersion: MASTER_TEMPLATE_VERSION,
  };

  return buildMasterOfferHtml(context);
}

export function appendSignatureBlockToHtml(issuedHtml, signature) {
  if (!signature?.signerName) return String(issuedHtml || "");
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const signedAt = signature.signedAt
    ? new Date(signature.signedAt).toLocaleString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const imgSrc = safeSignatureSrc(signature.imageDataUrl);
  const sigMark = imgSrc
    ? `<p style="margin:8px 0 0"><img src="${imgSrc}" alt="Candidate signature" style="max-height:60px;max-width:220px" /></p>`
    : signature.typedText
      ? `<p style="margin:8px 0 0;font-family:'Segoe Script','Brush Script MT',cursive;font-size:22px;color:#1e3a8a">${esc(signature.typedText)}</p>`
      : "";
  const block = `
<section style="margin-top:28px;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;page-break-inside:avoid">
  <h3 style="margin:0 0 8px;font-size:14px;color:#0f172a">Candidate Acceptance Record</h3>${sigMark}
  <p style="margin:0 0 6px;font-size:12.5px;color:#334155">${esc(signature.legalStatement || "Offer accepted electronically.")}</p>
  <p style="margin:0;font-size:12.5px;color:#0f172a"><strong>Signed by:</strong> ${esc(signature.signerName)}</p>
  <p style="margin:4px 0 0;font-size:12.5px;color:#0f172a"><strong>Email:</strong> ${esc(signature.signerEmail || "")}</p>
  <p style="margin:4px 0 0;font-size:12.5px;color:#0f172a"><strong>Signed at:</strong> ${esc(signedAt)}</p>
</section>`;
  const html = String(issuedHtml || "");
  const idx = html.toLowerCase().lastIndexOf("</body>");
  if (idx === -1) return html + block;
  return html.slice(0, idx) + block + html.slice(idx);
}

/**
 * Convert a stored OfferLetter.signature record (with imageData loaded) into render input.
 * @returns {{ signerName, signerEmail, signedAt, legalStatement, method, typedText, imageDataUrl }}
 */
export function signatureRecordToRenderInput(sig = {}) {
  const buf = toBuffer(sig.imageData);
  return {
    signerName: sig.signerName || "",
    signerEmail: sig.signerEmail || "",
    signedAt: sig.signedAt || null,
    legalStatement: sig.legalStatement || "",
    method: sig.method || "",
    typedText: sig.typedText || "",
    imageDataUrl: buf && buf.length ? bufferToDataUrl(buf, sig.imageMimeType) : "",
  };
}

/**
 * HTML for the final signed PDF: the frozen issuedContent (which already carries the HR
 * signature) with only the candidate signature + date injected into their markers.
 * The legal text is never re-rendered from the live master/company. Documents frozen before
 * the markers existed fall back to an appended "Candidate Acceptance Record" block.
 */
export function buildSignedOfferHtml({ issuedContent, signature }) {
  const input = signature?.imageDataUrl !== undefined && !signature.imageData
    ? signature
    : signatureRecordToRenderInput(signature);
  const { html, injected } = injectCandidateSignature(issuedContent, {
    dataUrl: input.imageDataUrl,
    typedText: input.typedText,
    signedAt: input.signedAt,
  });
  if (injected) return { html, mode: "injected" };
  return { html: appendSignatureBlockToHtml(issuedContent, input), mode: "appended" };
}

export async function pdfBufferFromHtml(html) {
  return generateOfferLetterPdf(html);
}

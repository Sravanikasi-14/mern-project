from pathlib import Path
content = r'''/**
 * Single standard HRMS offer renderer.
 * Source of truth: assets/offer-templates/hrms-default-master.js
 */
import {
  MASTER_TEMPLATE_CODE,
  MASTER_TEMPLATE_VERSION,
  getMasterSectionConfig,
  getDefaultLegalSections,
  buildMasterOfferHtml,
} from "../assets/offer-templates/hrms-default-master.js";
import { loadCompanyLogoDataUrl, buildOfferFieldValues } from "./offerTemplateRenderService.js";
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

export async function renderStandardOfferHtml({ offerData, company, signature = null }) {
  const letterhead = getCompanyLetterhead(company);
  const logoDataUrl = await loadCompanyLogoDataUrl(company);
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
  const block = `
<section style="margin-top:28px;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;page-break-inside:avoid">
  <h3 style="margin:0 0 8px;font-size:14px;color:#0f172a">Candidate Acceptance Record</h3>
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

export async function pdfBufferFromHtml(html) {
  return generateOfferLetterPdf(html);
}
'''
Path(r"c:\Users\SRAVANI\mern-project\server\services\offerStandardRenderService.js").write_text(content, encoding="utf-8", newline="\n")
print("OK", len(content))

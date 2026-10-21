/**
 * Reusable Library of Predefined Clauses and Deterministic Offer Letter Template Engine
 */

export const DEFAULT_OFFER_CLAUSES = Object.freeze([
  {
    id: "probation_period",
    title: "1. Probation Period & Confirmation",
    body: "You will be on probation for a period of {{probationMonths}} months from your date of joining. During this period, your performance, conduct, and suitability for the role will be periodically evaluated. Upon satisfactory completion of the probationary period, your employment will be confirmed in writing. The company reserves the right to extend the probationary period if performance expectations are not met.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 1,
  },
  {
    id: "notice_period",
    title: "2. Notice Period & Termination",
    body: "During the probationary period, either party may terminate the employment relationship by providing {{probationNoticeDays}} days' prior written notice or equivalent basic salary in lieu thereof. Upon confirmation, the notice period required by either party shall be {{confirmedNoticeDays}} days. The company reserves the right to relieve you immediately upon payment of salary in lieu of notice or require you to serve the full notice period to facilitate smooth transition.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 2,
  },
  {
    id: "working_hours",
    title: "3. Working Days, Working Hours & Location",
    body: "Your standard work week is Monday through Friday, from {{officeStartTime}} to {{officeEndTime}}, with scheduled weekends off, subject to company policies and business needs. You will be based out of {{workLocation}}. Due to the nature of business operations, you may occasionally be required to work different hours, shifts, or travel on official assignment as necessary.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 3,
  },
  {
    id: "compensation_terms",
    title: "4. Compensation & Payment Terms",
    body: "Your monthly gross compensation will be {{monthlySalaryFormatted}} (annualized compensation of {{annualSalaryFormatted}}). Compensation is payable on or before the last working day of each calendar month via direct electronic bank transfer, subject to statutory tax deductions (TDS, PF, ESI, Professional Tax) as mandated by applicable laws.",
    isIncluded: true,
    isCustom: false,
    isRequired: true, // Compensation is required
    order: 4,
  },
  {
    id: "leave_holidays",
    title: "5. Leave & Holidays Policy Reference",
    body: "You will be eligible for annual statutory leaves (Casual Leave, Sick Leave, and Privilege/Earned Leave) and observed company holidays as stipulated in the official Company HR Policy. Leaves accrue on a pro-rata basis from your date of joining and must be applied for and approved through the HRMS portal in advance.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 5,
  },
  {
    id: "confidentiality",
    title: "6. Confidentiality & Non-Disclosure",
    body: "You acknowledge that in the course of your employment, you will have access to confidential, proprietary, trade secret, client, and financial information belonging to {{companyName}}. You agree to maintain strict confidentiality during and after your employment. Unauthorized disclosure, copying, or use of any proprietary data will result in immediate termination and legal action.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 6,
  },
  {
    id: "intellectual_property",
    title: "7. Intellectual Property & Work-Product Ownership",
    body: "All inventions, software code, designs, algorithms, processes, documentation, and work products conceived, developed, or contributed by you during your employment with {{companyName}} shall be the sole and exclusive intellectual property of the company from inception.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 7,
  },
  {
    id: "company_property",
    title: "8. Company Property & Asset Return",
    body: "Any equipment, hardware, access cards, documentation, or accounts provided to you for official duties remain the exclusive property of {{companyName}}. Upon separation of employment for any reason, all company property must be returned in good working condition prior to the release of your final settlement and relieving documents.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 8,
  },
  {
    id: "background_verification",
    title: "9. Background & Credential Verification",
    body: "This offer of employment is contingent upon satisfactory verification of your professional credentials, prior employment history, educational qualifications, address, and reference checks. Any false, misleading, or suppressed information may lead to revocation of this offer or summary termination without notice.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 9,
  },
  {
    id: "code_of_conduct",
    title: "10. Code of Conduct & Company Policies",
    body: "You are required to adhere to all established company policies, ethical standards, prevention of sexual harassment (POSH) guidelines, data security rules, and codes of conduct in effect throughout your tenure.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 10,
  },
  {
    id: "joining_instructions",
    title: "11. Joining Instructions & Onboarding Documents",
    body: "Please report to our office or join the virtual onboarding session on {{joiningDateFormatted}} at 09:30 AM. You must furnish digital and self-attested physical copies of your Government Photo ID (PAN / Aadhaar), highest educational degree certificates, previous employer relieving and experience letters, and recent payslips.",
    isIncluded: true,
    isCustom: false,
    isRequired: false,
    order: 11,
  },
  {
    id: "acceptance_instructions",
    title: "12. Offer Acceptance Instructions",
    body: "Please confirm your acceptance of this offer by signing and returning a duplicate copy of this letter within 5 business days from the date of issuance. If we do not receive your written acceptance within this period, {{companyName}} reserves the right to withdraw this offer without further obligation.",
    isIncluded: true,
    isCustom: false,
    isRequired: true, // Offer acceptance clause is required
    order: 12,
  },
]);

/**
 * Basic HTML escaping for safe interpolation
 */
export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format currency amount with Indian standard formatting
 */
export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Format date nicely
 */
export function formatDate(dateInput) {
  if (!dateInput) return "--";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Format date and time nicely with standard Indian application locale
 */
export function formatDateTime(dateInput) {
  if (!dateInput) return "--";
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Builds the placeholder replacement dictionary
 */
export function buildPlaceholders(offerData, company) {
  const companyName = company?.companyName || company?.name || "The Company";
  const candidateName = offerData.candidate?.fullName || "Candidate";
  const position = offerData.position || "Team Member";
  const department = offerData.department || "General";
  const workLocation = offerData.workLocation || "Company Office";
  const employmentType = offerData.employmentType || "Full-time Permanent";
  const reportingManager = offerData.reportingManager || "Department Head";

  const monthlySalary = Number(offerData.monthlySalary) || 0;
  const annualSalary = offerData.annualSalary || monthlySalary * 12;

  const monthlySalaryFormatted = formatCurrency(monthlySalary);
  const annualSalaryFormatted = formatCurrency(annualSalary);

  const joiningDateFormatted = formatDate(offerData.joiningDate);
  const offerDateFormatted = formatDate(offerData.createdAt || new Date());

  return {
    "{{companyName}}": escapeHtml(companyName),
    "{{candidateName}}": escapeHtml(candidateName),
    "{{candidateEmail}}": escapeHtml(offerData.candidate?.email || ""),
    "{{position}}": escapeHtml(position),
    "{{department}}": escapeHtml(department),
    "{{workLocation}}": escapeHtml(workLocation),
    "{{employmentType}}": escapeHtml(employmentType),
    "{{reportingManager}}": escapeHtml(reportingManager),
    "{{monthlySalary}}": escapeHtml(monthlySalaryFormatted),
    "{{monthlySalaryFormatted}}": escapeHtml(monthlySalaryFormatted),
    "{{annualSalary}}": escapeHtml(annualSalaryFormatted),
    "{{annualSalaryFormatted}}": escapeHtml(annualSalaryFormatted),
    "{{joiningDate}}": escapeHtml(joiningDateFormatted),
    "{{joiningDateFormatted}}": escapeHtml(joiningDateFormatted),
    "{{offerDate}}": escapeHtml(offerDateFormatted),
    "{{offerDateFormatted}}": escapeHtml(offerDateFormatted),
    "{{probationMonths}}": "3",
    "{{probationNoticeDays}}": "30",
    "{{confirmedNoticeDays}}": "60",
    "{{officeStartTime}}": "09:30 AM",
    "{{officeEndTime}}": "06:30 PM",
  };
}

/**
 * Deterministically render clause text with placeholder replacements
 */
export function interpolatePlaceholders(text, placeholders) {
  if (!text) return "";
  let result = text;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

/**
 * Deterministically render final Offer Letter HTML document
 */
export function renderOfferLetterHtml(offerData, company) {
  const placeholders = buildPlaceholders(offerData, company);

  const candidateName = escapeHtml(offerData.candidate?.fullName || "Candidate");
  const candidateEmail = escapeHtml(offerData.candidate?.email || "");
  const position = escapeHtml(offerData.position || "");
  const department = escapeHtml(offerData.department || "");
  const workLocation = escapeHtml(offerData.workLocation || "Company Premises");
  const employmentType = escapeHtml(offerData.employmentType || "Full-time Permanent");
  const joiningDateFormatted = formatDate(offerData.joiningDate);
  const offerDateFormatted = formatDate(offerData.createdAt || new Date());
  const companyName = escapeHtml(company?.companyName || company?.name || "Acme Technologies");

  const monthlySalary = Number(offerData.monthlySalary) || 0;
  const annualSalary = offerData.annualSalary || monthlySalary * 12;
  const monthlySalaryFormatted = formatCurrency(monthlySalary);
  const annualSalaryFormatted = formatCurrency(annualSalary);

  // Filter and sort included clauses
  const activeClauses = (offerData.clauses && offerData.clauses.length > 0 ? offerData.clauses : DEFAULT_OFFER_CLAUSES)
    .filter((c) => c.isIncluded !== false && c.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const clausesHtml = activeClauses
    .map((clause, idx) => {
      const title = interpolatePlaceholders(escapeHtml(clause.title), placeholders);
      const body = interpolatePlaceholders(escapeHtml(clause.body), placeholders);
      return `
        <div class="clause-block">
          <div class="clause-title">${title}</div>
          <div class="clause-body">${body}</div>
        </div>
      `;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Offer of Employment - ${candidateName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 18mm 18mm 18mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: #1e293b;
      background: #ffffff;
      padding: 24px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .letter-container {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 20px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .company-brand {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0f172a;
      text-transform: uppercase;
    }
    .company-sub {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-block {
      text-align: right;
      font-size: 11.5px;
      color: #475569;
    }
    .doc-title {
      text-align: center;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #0f172a;
      text-transform: uppercase;
      margin: 18px 0 20px 0;
      padding: 6px 0;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .recipient-info {
      margin-bottom: 18px;
      font-size: 13px;
      word-break: break-word;
      overflow-wrap: break-word;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .recipient-name {
      font-weight: 700;
      color: #0f172a;
      font-size: 14px;
    }
    .recipient-detail {
      color: #475569;
      margin-top: 1px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .salutation {
      margin-bottom: 14px;
      font-weight: 600;
      color: #0f172a;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .opening-paragraph {
      margin-bottom: 16px;
      text-align: justify;
      color: #334155;
      line-height: 1.55;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .summary-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 18px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .summary-item {
      display: flex;
      flex-direction: column;
      min-width: 0;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .summary-label {
      font-size: 10.5px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-val {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 1px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .clauses-container {
      margin-bottom: 24px;
    }
    .clause-block {
      margin-bottom: 14px;
      page-break-inside: avoid;
      break-inside: avoid;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .clause-title {
      font-size: 12.5px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 3px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .clause-body {
      font-size: 12px;
      color: #334155;
      text-align: justify;
      line-height: 1.5;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .closing-text {
      margin: 18px 0 24px 0;
      font-size: 12px;
      color: #334155;
      line-height: 1.5;
      page-break-inside: avoid;
      break-inside: avoid;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .signatures-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px dashed #cbd5e1;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sig-col {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .sig-heading {
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 45px;
    }
    .sig-line {
      border-top: 1px solid #94a3b8;
      padding-top: 6px;
      font-size: 11.5px;
      color: #334155;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .footer-note {
      text-align: center;
      margin-top: 28px;
      font-size: 10px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 10px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="letter-container">
    <!-- Header -->
    <div class="header-bar">
      <div>
        <div class="company-brand">${companyName}</div>
        <div class="company-sub">Human Resources Management</div>
      </div>
      <div class="meta-block">
        <div><strong>Date:</strong> ${offerDateFormatted}</div>
        <div><strong>Reference:</strong> OFF-${new Date().getFullYear()}-${candidateName.substring(0, 3).toUpperCase()}</div>
      </div>
    </div>

    <!-- Title -->
    <div class="doc-title">Letter of Employment Offer</div>

    <!-- Recipient -->
    <div class="recipient-info">
      <div>To,</div>
      <div class="recipient-name">${candidateName}</div>
      <div class="recipient-detail">${candidateEmail}</div>
    </div>

    <!-- Salutation -->
    <div class="salutation">Dear ${candidateName},</div>

    <!-- Opening -->
    <div class="opening-paragraph">
      On behalf of <strong>${companyName}</strong>, we are pleased to extend an offer of employment for the position of <strong>${position}</strong>${department ? ` in the <strong>${department}</strong> department` : ""}. We were impressed with your qualifications and believe your skills will make a valuable contribution to our team.
    </div>

    <!-- Quick Terms Summary Card -->
    <div class="summary-card">
      <div class="summary-item">
        <span class="summary-label">Designation / Role</span>
        <span class="summary-val">${position}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Employment Type</span>
        <span class="summary-val">${employmentType}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Proposed Date of Joining</span>
        <span class="summary-val">${joiningDateFormatted}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Work Location</span>
        <span class="summary-val">${workLocation}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Monthly Gross Salary</span>
        <span class="summary-val">${monthlySalaryFormatted}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Annualized Compensation (x12)</span>
        <span class="summary-val">${annualSalaryFormatted}</span>
      </div>
    </div>

    <!-- Clauses -->
    <div class="clauses-container">
      ${clausesHtml}
    </div>

    <!-- Closing -->
    <div class="closing-text">
      We look forward to welcoming you to ${companyName} and anticipate a mutually rewarding and productive association.
    </div>

    <!-- Signatures -->
    <div class="signatures-grid">
      <div class="sig-col">
        <div class="sig-heading">For ${companyName}:</div>
        <div class="sig-line">
          <strong>Authorized Signatory</strong><br>
          Human Resources Department<br>
          ${companyName}
        </div>
      </div>
      <div class="sig-col">
        <div class="sig-heading">Candidate Acceptance:</div>
        ${
          offerData.status === "ACCEPTED" || offerData.signature?.signedAt
            ? `
        <div class="sig-line" style="border-top: 1px solid #16a34a; padding-top: 8px;">
          <div style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 6px;">
            Accepted Electronically
          </div>
          <div style="font-size: 12px; margin-bottom: 3px;">
            <strong>Electronically Signed By:</strong> ${escapeHtml(
              offerData.signature?.signerName || offerData.candidate?.fullName || candidateName
            )}
          </div>
          <div style="font-size: 11.5px; color: #475569; margin-bottom: 3px;">
            <strong>Email:</strong> ${escapeHtml(
              offerData.signature?.signerEmail || offerData.candidate?.email || candidateEmail
            )}
          </div>
          <div style="font-size: 11.5px; color: #475569; margin-bottom: 6px;">
            <strong>Signed On:</strong> ${formatDateTime(
              offerData.signature?.signedAt || offerData.decisionAt || new Date()
            )}
          </div>
          ${
            offerData.signature?.legalStatement
              ? `
          <div style="font-size: 10.5px; color: #64748b; font-style: italic; line-height: 1.4; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0;">
            "${escapeHtml(offerData.signature.legalStatement)}"
          </div>`
              : ""
          }
          ${
            offerData.signature?.documentHash
              ? `
          <div style="font-size: 9.5px; color: #94a3b8; font-family: monospace; margin-top: 5px;">
            Document Verification Hash: ${escapeHtml(offerData.signature.documentHash.substring(0, 16))}...
          </div>`
              : ""
          }
        </div>
        `
            : `
        <div class="sig-line">
          <strong>Signature:</strong> _______________________<br>
          <strong>Name:</strong> ${candidateName}<br>
          <strong>Date:</strong> _________________________
        </div>
        `
        }
      </div>
    </div>

    <div class="footer-note">
      This document constitutes an official offer of employment generated by ${companyName} HRMS.
    </div>
  </div>
</body>
</html>`;
}

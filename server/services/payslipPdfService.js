import { generateOfferLetterPdf, generatePureJsPdf } from "./pdfService.js";

function formatCurrency(amount, symbol = "INR ") {
  if (amount == null || isNaN(amount)) return `${symbol}0`;
  return `${symbol}${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Builds printable HTML for an employee payslip.
 */
export function buildPayslipHtml(payslip, company) {
  const emp = payslip.employeeSnapshot || {};
  const days = payslip.daysBreakdown || {};
  const earnings = payslip.earnings || [];
  const deductions = payslip.employeeDeductions || [];
  const employerContribs = payslip.employerContributions || [];

  const companyName = company?.companyName || "Enterprise Suite";
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const monthName = monthNames[payslip.periodMonth - 1] || "";
  const periodLabel = `${monthName} ${payslip.periodYear}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payslip - ${payslip.payslipNumber}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #09090b;
      background: #ffffff;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 2px solid #18181b;
      padding-bottom: 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .company-title {
      font-size: 22px;
      font-weight: 800;
      color: #09090b;
      margin: 0 0 4px;
    }
    .doc-title {
      font-size: 15px;
      font-weight: 700;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-box {
      text-align: right;
      font-size: 12px;
      color: #52525b;
    }
    .employee-info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      font-size: 12.5px;
    }
    .info-label {
      width: 140px;
      color: #64748b;
      font-weight: 600;
    }
    .info-value {
      color: #0f172a;
      font-weight: 600;
    }
    .attendance-bar {
      display: flex;
      justify-content: space-between;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 10px 16px;
      font-size: 12px;
      margin-bottom: 20px;
      color: #1e40af;
      font-weight: 600;
    }
    .financials-table-wrap {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .table-section {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    .table-header {
      background: #f1f5f9;
      padding: 10px 14px;
      font-weight: 700;
      font-size: 13px;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
    }
    .item-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 14px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12.5px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 14px;
      font-weight: 700;
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      font-size: 13px;
    }
    .net-pay-banner {
      background: #18181b;
      color: #ffffff;
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .net-pay-val {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
    }
    .footer-note {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
      margin-top: 30px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="company-title">${companyName}</h1>
      <div class="doc-title">Salary Payslip — ${periodLabel}</div>
    </div>
    <div class="meta-box">
      <div><strong>Payslip Ref:</strong> ${payslip.payslipNumber}</div>
      <div><strong>Pay Period:</strong> ${formatDate(payslip.periodStartDate)} to ${formatDate(payslip.periodEndDate)}</div>
      <div><strong>Status:</strong> ${payslip.paymentStatus === "PAID" ? "PAID / DISBURSED" : "FINALIZED"}</div>
    </div>
  </div>

  <div class="employee-info-grid">
    <div class="info-row">
      <span class="info-label">Employee Name:</span>
      <span class="info-value">${emp.fullName || "—"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Employee Code:</span>
      <span class="info-value">${emp.employeeCode || "—"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Designation:</span>
      <span class="info-value">${emp.jobTitle || "—"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Department:</span>
      <span class="info-value">${emp.department || "—"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Bank Account:</span>
      <span class="info-value">${emp.bankAccountNumber ? "XXXX-" + String(emp.bankAccountNumber).slice(-4) : "On File"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">PAN Number:</span>
      <span class="info-value">${emp.panNumber || "—"}</span>
    </div>
  </div>

  <div class="attendance-bar">
    <span>Days in Month: ${days.totalDaysInMonth || 0}</span>
    <span>Working Days: ${days.workingDays || 0}</span>
    <span>Present: ${days.presentDays || 0}</span>
    <span>Approved Leave: ${days.paidLeaveDays || 0}</span>
    <span>Loss of Pay (LOP): ${days.lossOfPayDays || 0}</span>
    <span>Payable Days: ${days.payableDays || 0}</span>
  </div>

  <div class="financials-table-wrap">
    <!-- Earnings Column -->
    <div class="table-section">
      <div class="table-header">
        <span>EARNINGS & ALLOWANCES</span>
        <span>AMOUNT (${payslip.currency || "INR"})</span>
      </div>
      ${earnings.map((e) => `
        <div class="item-row">
          <span>${e.name}</span>
          <span style="font-weight:600;">${formatCurrency(e.amount, "")}</span>
        </div>
      `).join("")}
      <div class="total-row">
        <span>GROSS EARNINGS</span>
        <span style="color:#166534;">${formatCurrency(payslip.grossEarnings, payslip.currencySymbol || "₹")}</span>
      </div>
    </div>

    <!-- Deductions Column -->
    <div class="table-section">
      <div class="table-header">
        <span>DEDUCTIONS</span>
        <span>AMOUNT (${payslip.currency || "INR"})</span>
      </div>
      ${deductions.length === 0 ? `
        <div class="item-row" style="color:#94a3b8; font-style:italic;">No employee deductions applicable</div>
      ` : deductions.map((d) => `
        <div class="item-row">
          <span>${d.name}</span>
          <span style="font-weight:600; color:#b91c1c;">-${formatCurrency(d.amount, "")}</span>
        </div>
      `).join("")}
      <div class="total-row">
        <span>TOTAL DEDUCTIONS</span>
        <span style="color:#b91c1c;">${formatCurrency(payslip.totalDeductions, payslip.currencySymbol || "₹")}</span>
      </div>
    </div>
  </div>

  ${employerContribs.length > 0 ? `
    <div style="font-size:11.5px; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 14px; margin-bottom:20px;">
      <strong>Employer Contributions (Informational):</strong>
      ${employerContribs.map((c) => `${c.name}: ${formatCurrency(c.amount, payslip.currencySymbol || "₹")}`).join(" | ")}
    </div>
  ` : ""}

  <div class="net-pay-banner">
    <div>
      <div style="font-size:12px; text-transform:uppercase; color:#a1a1aa; font-weight:600;">Net Salary Payable</div>
      <div style="font-size:12px; color:#cbd5e1; margin-top:2px;">(Gross Earnings − Total Deductions)</div>
    </div>
    <div class="net-pay-val">${formatCurrency(payslip.netPayable, payslip.currencySymbol || "₹")}</div>
  </div>

  <div class="footer-note">
    This is an authorized system-generated computer document issued by ${companyName}. No physical signature is required.
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Generates a real PDF binary buffer for the given payslip and company context.
 */
export async function generatePayslipPdfBuffer(payslip, company) {
  const html = buildPayslipHtml(payslip, company);
  try {
    return await generateOfferLetterPdf(html);
  } catch (err) {
    return generatePureJsPdf(html);
  }
}

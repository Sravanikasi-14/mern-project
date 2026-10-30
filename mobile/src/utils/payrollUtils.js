const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month) {
  const m = Number(month);
  if (m >= 1 && m <= 12) return MONTHS[m - 1];
  return "";
}

export function periodLabel(month, year) {
  const name = monthName(month);
  return name && year ? `${name} ${year}` : "Payroll period";
}

export function cycleLabel(cycle) {
  if (!cycle) return "Select period";
  return periodLabel(cycle.periodMonth, cycle.periodYear);
}

export function formatMoney(amount, symbol = "₹") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${symbol}${n.toLocaleString("en-IN")}`;
}

export function extractPayslips(detailData) {
  if (Array.isArray(detailData?.payslips)) return detailData.payslips;
  if (Array.isArray(detailData?.data?.payslips)) return detailData.data.payslips;
  if (Array.isArray(detailData?.data?.register)) return detailData.data.register;
  return [];
}

export function payslipEmployeeName(row) {
  if (row?.employeeSnapshot?.fullName) return row.employeeSnapshot.fullName;
  if (row?.employeeId && typeof row.employeeId === "object" && row.employeeId.fullName) {
    return row.employeeId.fullName;
  }
  return row?.fullName || row?.employeeName || "Employee";
}

export function payslipEmployeeCode(row) {
  return (
    row?.employeeSnapshot?.employeeCode ||
    (row?.employeeId && typeof row.employeeId === "object" ? row.employeeId.employeeCode : "") ||
    row?.employeeCode ||
    row?.employeeNumber ||
    ""
  );
}

export function payslipJobTitle(row) {
  return (
    row?.employeeSnapshot?.jobTitle ||
    (row?.employeeId && typeof row.employeeId === "object" ? row.employeeId.jobTitle || row.employeeId?.job?.title : "") ||
    row?.jobTitle ||
    ""
  );
}

export function payslipDepartment(row) {
  return (
    row?.employeeSnapshot?.department ||
    (row?.employeeId && typeof row.employeeId === "object" ? row.employeeId.department : "") ||
    row?.department ||
    ""
  );
}

export function payslipStatus(row) {
  return row?.paymentStatus || row?.status || "";
}

export function earningsLines(row) {
  return Array.isArray(row?.earnings) ? row.earnings.filter((line) => line && Number(line.amount) >= 0) : [];
}

export function deductionLines(row) {
  if (Array.isArray(row?.employeeDeductions)) {
    return row.employeeDeductions.filter((line) => line && Number(line.amount) >= 0);
  }
  if (Array.isArray(row?.deductions)) {
    return row.deductions.filter((line) => line && Number(line.amount) >= 0);
  }
  return [];
}

export function paymentDate(row) {
  const payments = Array.isArray(row?.payments) ? row.payments : [];
  const dated = payments.filter((p) => p?.paymentDate);
  if (!dated.length) return "";
  return dated[dated.length - 1].paymentDate;
}

export function statusBucket(row) {
  const s = String(payslipStatus(row)).toUpperCase();
  if (s === "PAID") return "paid";
  if (s === "PARTIALLY_PAID" || s === "PROCESSING" || s === "FINALIZED" || s === "CALCULATED") {
    return "pending";
  }
  if (s === "FAILED" || s === "CANCELLED") return "failed";
  if (s === "UNPAID" || s === "DRAFT") return "pending";
  return "pending";
}

export { MONTHS };

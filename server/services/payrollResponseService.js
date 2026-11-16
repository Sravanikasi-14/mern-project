/**
 * F50-D / F61 — Slim payroll HTTP response helpers.
 *
 * Create/recalculate: cycle summary + validationIssues only (no payslip reload).
 * Detail: projected payslips with optional server pagination + filters (F61).
 * CSV export uses the same scoped filter (no silent truncation of the export set).
 *
 * F50-E: async payroll deferred — sync create/recalc remains the supported path under
 * Vercel 60s / 1024MB for typical headcounts after F50-A/B/C/D.
 *
 * Remaining O(N): accumulated employeeRecords during calc; CSV export still streams
 * the filtered register (bounded by cycle size, not loaded into the default GET).
 */

import mongoose from "mongoose";
import {
  filterPayslipsByScope,
  filterValidationIssuesByScope,
  shapePayrollCycleForHrAccess,
} from "./hrAccessEnforcementService.js";
import { HR_SCOPE_MODES } from "../constants/hrAccessCatalog.js";
import { USER_ROLES } from "../models/User.js";

/** Cycle fields for list cards / dashboard summary. */
export const PAYROLL_CYCLE_LIST_SELECT =
  "periodMonth periodYear status notes totalNetPayable totalGrossEarnings totalEmployeeDeductions totalEmployerContributions employeeCount totalPaidAmount paymentStatus createdBy finalizedBy createdAt updatedAt finalizedAt calculatedAt";

/** Detail select — omit calcLockToken (internal ownership; F50 residual hardening). */
export const PAYROLL_CYCLE_DETAIL_SELECT = `${PAYROLL_CYCLE_LIST_SELECT} periodStartDate periodEndDate validationIssues payments calcLockUntil`;

/**
 * Payslip fields required by AdminPayroll register, CSV, modal, and mobile HR.
 */
export const PAYSLIP_REGISTER_SELECT = [
  "_id",
  "payrollCycleId",
  "employeeId",
  "payslipNumber",
  "periodMonth",
  "periodYear",
  "periodStartDate",
  "periodEndDate",
  "employeeSnapshot",
  "daysBreakdown",
  "earnings",
  "employeeDeductions",
  "employerContributions",
  "grossEarnings",
  "totalDeductions",
  "totalEmployerContributions",
  "netPayable",
  "currency",
  "currencySymbol",
  "status",
  "paymentStatus",
  "payments",
  "finalizedAt",
  "createdAt",
  "updatedAt",
].join(" ");

/** Slimmer select for employee self-service list (modal still loads full slip via detail/download). */
export const PAYSLIP_EMPLOYEE_LIST_SELECT = [
  "_id",
  "payslipNumber",
  "periodMonth",
  "periodYear",
  "periodStartDate",
  "periodEndDate",
  "daysBreakdown",
  "earnings",
  "employeeDeductions",
  "employerContributions",
  "grossEarnings",
  "totalDeductions",
  "netPayable",
  "currency",
  "currencySymbol",
  "status",
  "paymentStatus",
  "payments",
  "finalizedAt",
  "employeeSnapshot",
].join(" ");

export const DEFAULT_PAYSLIP_PAGE_SIZE = 25;
export const MAX_PAYSLIP_PAGE_SIZE = 100;
export const DEFAULT_EMPLOYEE_PAYSLIP_LIMIT = 36;
export const MAX_EMPLOYEE_PAYSLIP_LIMIT = 100;

export function resolvePayslipPagination(query = {}, { defaultPage = null, defaultLimit = null } = {}) {
  const rawPage = parseInt(query.page ?? defaultPage, 10);
  const rawLimit = parseInt(query.limit ?? defaultLimit, 10);
  if (!Number.isFinite(rawPage) || rawPage < 1 || !Number.isFinite(rawLimit) || rawLimit < 1) {
    return null;
  }
  return {
    page: rawPage,
    limit: Math.min(Math.floor(rawLimit), MAX_PAYSLIP_PAGE_SIZE),
  };
}

export function resolveRegisterFilters(query = {}) {
  const search = String(query.search || query.q || "").trim();
  const department = String(query.department || "").trim();
  const paymentStatus = String(query.paymentStatus || query.status || "").trim().toUpperCase();
  return {
    search: search || "",
    department: department && department !== "ALL" ? department : "",
    paymentStatus:
      paymentStatus === "PAID" || paymentStatus === "UNPAID" ? paymentStatus : "",
  };
}

/**
 * Normalize employeeSnapshot so UI bankDetails reads work with flat calc fields.
 */
export function mapPayslipForRegister(payslip) {
  if (!payslip) return payslip;
  const snap = payslip.employeeSnapshot || {};
  const bankDetails =
    snap.bankDetails && typeof snap.bankDetails === "object"
      ? snap.bankDetails
      : {
          accountNumber: snap.bankAccountNumber || "",
          bankName: snap.bankName || "",
          ifscCode: snap.bankIfsc || "",
        };

  return {
    ...payslip,
    employeeId: payslip.employeeId?._id || payslip.employeeId,
    employeeSnapshot: {
      ...snap,
      bankDetails,
    },
    employeeNumber: snap.employeeCode || "",
  };
}

function scopedEmployeeIdFilter(hrAccess) {
  if (
    hrAccess?.enforced &&
    hrAccess.role === USER_ROLES.HR_ADMIN &&
    hrAccess.configured &&
    hrAccess.scopeMode === HR_SCOPE_MODES.CUSTOM &&
    hrAccess.allowedEmployeeIdSet
  ) {
    return [...hrAccess.allowedEmployeeIdSet];
  }
  return null;
}

/** Build Mongo filter for cycle register (F61 scope-in-query + optional UI filters). */
export function buildCyclePayslipFilter(cycleId, hrAccess, filters = {}) {
  // Aggregate $match does not cast string ids the way Model.find does.
  const cycleObjectId =
    mongoose.Types.ObjectId.isValid(cycleId) && !(cycleId instanceof mongoose.Types.ObjectId)
      ? new mongoose.Types.ObjectId(cycleId)
      : cycleId;
  const filter = { payrollCycleId: cycleObjectId };
  const scopedIds = scopedEmployeeIdFilter(hrAccess);

  if (
    hrAccess?.enforced &&
    hrAccess.role === USER_ROLES.HR_ADMIN &&
    !hrAccess.configured
  ) {
    return { filter: null, empty: true, scopedIds: [] };
  }

  if (scopedIds) {
    filter.employeeId = {
      $in: scopedIds.map((id) =>
        mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
      ),
    };
  }

  if (filters.department) {
    filter["employeeSnapshot.department"] = filters.department;
  }

  if (filters.paymentStatus === "PAID") {
    filter.$or = [{ paymentStatus: "PAID" }, { status: "PAID" }];
  } else if (filters.paymentStatus === "UNPAID") {
    filter.paymentStatus = { $ne: "PAID" };
    filter.status = { $ne: "PAID" };
  }

  if (filters.search) {
    const rx = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { "employeeSnapshot.fullName": rx },
          { "employeeSnapshot.employeeCode": rx },
          { "employeeSnapshot.department": rx },
          { payslipNumber: rx },
        ],
      },
    ];
  }

  return { filter, empty: false, scopedIds };
}

/**
 * Aggregate register metrics under the same scope/filters as the paged list (F61).
 */
export async function loadCycleRegisterSummary(Payslip, cycleId, hrAccess, filters = {}) {
  const { filter, empty } = buildCyclePayslipFilter(cycleId, hrAccess, filters);
  if (empty || !filter) {
    return {
      payslipCount: 0,
      unpaidCount: 0,
      totalGrossEarnings: 0,
      totalEmployeeDeductions: 0,
      totalNetPayable: 0,
      departments: [],
    };
  }

  const [agg] = await Payslip.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        payslipCount: { $sum: 1 },
        unpaidCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$paymentStatus", "PAID"] },
                  { $ne: ["$status", "PAID"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalGrossEarnings: { $sum: "$grossEarnings" },
        totalEmployeeDeductions: { $sum: "$totalDeductions" },
        totalNetPayable: { $sum: "$netPayable" },
        departments: { $addToSet: "$employeeSnapshot.department" },
      },
    },
  ]);

  const departments = (agg?.departments || [])
    .filter((d) => d && String(d).trim())
    .sort((a, b) => String(a).localeCompare(String(b)));

  return {
    payslipCount: agg?.payslipCount || 0,
    unpaidCount: agg?.unpaidCount || 0,
    totalGrossEarnings: agg?.totalGrossEarnings || 0,
    totalEmployeeDeductions: agg?.totalEmployeeDeductions || 0,
    totalNetPayable: agg?.totalNetPayable || 0,
    departments,
  };
}

/**
 * Load register payslips with projection (no populate).
 * F61: CUSTOM scope uses employeeId $in; optional pagination + filters.
 */
export async function loadCyclePayslipsForResponse(
  Payslip,
  cycleId,
  hrAccess,
  { pagination, filters = {} } = {}
) {
  const { filter, empty, scopedIds } = buildCyclePayslipFilter(cycleId, hrAccess, filters);
  if (empty || !filter) {
    return {
      payslips: [],
      total: 0,
      pagination: pagination
        ? { page: pagination.page, limit: pagination.limit, total: 0, totalPages: 0 }
        : null,
    };
  }

  const total = await Payslip.countDocuments(filter);
  let query = Payslip.find(filter)
    .select(PAYSLIP_REGISTER_SELECT)
    .sort({ "employeeSnapshot.fullName": 1 })
    .lean();

  if (pagination) {
    const skip = (pagination.page - 1) * pagination.limit;
    query = query.skip(skip).limit(pagination.limit);
  }

  let payslips = await query;
  if (!scopedIds) {
    payslips = filterPayslipsByScope(hrAccess, payslips);
  }

  const mapped = payslips.map(mapPayslipForRegister);
  return {
    payslips: mapped,
    total,
    pagination: pagination
      ? {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages: Math.max(1, Math.ceil((total || 0) / pagination.limit)),
        }
      : null,
  };
}

export function buildRegisterCsv(payslips, cycle) {
  const headers = [
    "Payslip Number",
    "Employee Code",
    "Employee Name",
    "Department",
    "Designation",
    "Working Days",
    "Present Days",
    "Paid Leave Days",
    "Loss of Pay Days",
    "Payable Days",
    "Gross Earnings (INR)",
    "Total Deductions (INR)",
    "Net Payable (INR)",
    "Status",
    "Payment Status",
  ];

  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = (payslips || []).map((p) =>
    [
      escape(p.payslipNumber || ""),
      escape(p.employeeSnapshot?.employeeCode || ""),
      escape(p.employeeSnapshot?.fullName || ""),
      escape(p.employeeSnapshot?.department || ""),
      escape(p.employeeSnapshot?.jobTitle || ""),
      p.daysBreakdown?.workingDays ?? 0,
      p.daysBreakdown?.presentDays ?? 0,
      p.daysBreakdown?.paidLeaveDays ?? 0,
      p.daysBreakdown?.lossOfPayDays ?? 0,
      p.daysBreakdown?.payableDays ?? 0,
      p.grossEarnings ?? 0,
      p.totalDeductions ?? 0,
      p.netPayable ?? 0,
      escape(p.status || ""),
      escape(p.paymentStatus || ""),
    ].join(",")
  );

  const period = cycle
    ? `${cycle.periodYear || ""}_${cycle.periodMonth || ""}`
    : "register";
  return {
    filename: `Payroll_Register_${period}.csv`,
    content: [headers.join(","), ...rows].join("\n"),
  };
}

/**
 * Apply scoped register summary onto a shaped cycle for CUSTOM HR when only a page of payslips is loaded.
 */
export function applyRegisterSummaryToCycle(shapedCycle, summary) {
  if (!shapedCycle || !summary) return shapedCycle;
  if (!shapedCycle._aggregatesRestricted) {
    return {
      ...shapedCycle,
      // Still expose register metrics for UI cards
      registerSummary: summary,
    };
  }
  return {
    ...shapedCycle,
    employeeCount: summary.payslipCount,
    totalGrossEarnings: summary.totalGrossEarnings,
    totalEmployeeDeductions: summary.totalEmployeeDeductions,
    totalNetPayable: summary.totalNetPayable,
    totalNetSalary: summary.totalNetPayable,
    registerSummary: summary,
  };
}

/**
 * Shape create/recalculate mutation response without reloading payslips.
 */
export function buildPayrollMutationResponse({
  hrAccess,
  cycle,
  validationIssues,
  message,
  statusCode = 200,
}) {
  const cycleObj = cycle?.toObject ? cycle.toObject() : { ...cycle };
  const scopedValidationIssues = filterValidationIssuesByScope(
    hrAccess,
    validationIssues ?? cycleObj.validationIssues ?? []
  );
  const shapedCycle = shapePayrollCycleForHrAccess(
    hrAccess,
    { ...cycleObj, validationIssues: scopedValidationIssues },
    null
  );

  return {
    statusCode,
    body: {
      success: true,
      cycle: shapedCycle,
      data: shapedCycle,
      payslips: [],
      employeeCount: shapedCycle.employeeCount,
      payslipCount: Number(cycleObj.employeeCount) || 0,
      validationIssues: scopedValidationIssues,
      message,
    },
  };
}

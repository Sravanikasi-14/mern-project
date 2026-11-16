import { assertCanAccessPayslip } from "../authorization/resourceOwnership.js";
import { HttpError } from "../utils/httpError.js";
import { generatePayslipPdfBuffer } from "../services/payslipPdfService.js";
import {
  createPayrollCycleAtomic,
  finalizePayrollCycleAtomic,
  recalculatePayrollCycleAtomic,
} from "../services/payrollWriteService.js";
import {
  DEFAULT_EMPLOYEE_PAYSLIP_LIMIT,
  MAX_EMPLOYEE_PAYSLIP_LIMIT,
  PAYROLL_CYCLE_DETAIL_SELECT,
  PAYROLL_CYCLE_LIST_SELECT,
  PAYSLIP_EMPLOYEE_LIST_SELECT,
  applyRegisterSummaryToCycle,
  buildPayrollMutationResponse,
  buildRegisterCsv,
  loadCyclePayslipsForResponse,
  loadCycleRegisterSummary,
  resolvePayslipPagination,
  resolveRegisterFilters,
} from "../services/payrollResponseService.js";
import {
  assertEmployeeInScope,
  assertHrPermission,
  assertHrCompanyWidePayrollMutation,
  shapePayrollCycleForHrAccess,
} from "../services/hrAccessEnforcementService.js";
import { USER_ROLES } from "../models/User.js";

/**
 * GET /api/payroll/cycles
 * HR Admin lists all payroll cycles for the company.
 */
export async function listPayrollCycles(req, res, next) {
  try {
    const { PayrollCycle } = req.auth.models;
    // F50-D: lean list projection; no payslips. Populate only display names.
    const cycles = await PayrollCycle.find({})
      .select(PAYROLL_CYCLE_LIST_SELECT)
      .sort({ periodYear: -1, periodMonth: -1 })
      .limit(36)
      .populate("createdBy", "fullName name email")
      .populate("finalizedBy", "fullName name email")
      .lean();

    // CUSTOM-scoped HR: redact company-wide stored totals (list has no payslip set to recompute)
    const shaped = cycles.map((c) => shapePayrollCycleForHrAccess(req.hrAccess, c, null));

    res.status(200).json({
      success: true,
      cycles: shaped,
      data: shaped,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payroll/cycles
 * HR Admin initiates a new payroll cycle for periodMonth and periodYear.
 */
export async function createPayrollCycle(req, res, next) {
  try {
    assertHrCompanyWidePayrollMutation(req.hrAccess);
    const { notes } = req.body || {};

    let month;
    let year;

    // Support YYYY-MM period string, Date object, or numeric month/year fields
    if (typeof req.body?.period === "string" && req.body.period.includes("-")) {
      const parts = req.body.period.split("-");
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
    } else if (req.body?.period instanceof Date) {
      year = req.body.period.getFullYear();
      month = req.body.period.getMonth() + 1;
    } else {
      const rawMonth = req.body?.periodMonth ?? req.body?.month;
      const rawYear = req.body?.periodYear ?? req.body?.year;
      month = parseInt(rawMonth, 10);
      year = parseInt(rawYear, 10);
    }

    if (isNaN(month) || month < 1 || month > 12) {
      throw new HttpError(400, "Please provide a valid payroll month (1-12).");
    }
    if (isNaN(year) || year < 2020 || year > 2100) {
      throw new HttpError(400, "Please provide a valid payroll year.");
    }

    // F50-A: calculate outside the write txn; cycle + payslips commit together.
    const { cycle: newCycle, calculation } = await createPayrollCycleAtomic({
      models: req.auth.models,
      company: req.auth.company,
      periodMonth: month,
      periodYear: year,
      notes: notes || "",
      createdBy: req.auth.user._id,
    });

    // F50-D: do not re-fetch/populate payslips for the HTTP response.
    // Clients use cycle._id then GET /cycles/:id for the register.
    const { statusCode, body } = buildPayrollMutationResponse({
      hrAccess: req.hrAccess,
      cycle: newCycle,
      validationIssues: calculation.validationIssues,
      message: `Payroll cycle for ${month}/${year} created and draft calculated.`,
      statusCode: 201,
    });
    res.status(statusCode).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payroll/cycles/:cycleId
 * HR Admin views a specific cycle and its employee register.
 *
 * F61: prefer ?page=&limit= (AdminPayroll always sends these). Without page/limit,
 * returns the full filtered register for backward-compatible clients/mobile.
 * Register metrics come from an aggregate under the same scope/filters — not the page rows.
 */
export async function getPayrollCycleDetails(req, res, next) {
  try {
    const { PayrollCycle, Payslip } = req.auth.models;
    const { cycleId } = req.params;

    const cycle = await PayrollCycle.findById(cycleId)
      .select(PAYROLL_CYCLE_DETAIL_SELECT)
      .populate("createdBy", "fullName name email")
      .populate("finalizedBy", "fullName name email")
      .lean();

    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    const filters = resolveRegisterFilters(req.query);
    const pagination = resolvePayslipPagination(req.query);
    const registerSummary = await loadCycleRegisterSummary(
      Payslip,
      cycleId,
      req.hrAccess,
      filters
    );
    const {
      payslips,
      total: payslipTotal,
      pagination: payslipPagination,
    } = await loadCyclePayslipsForResponse(Payslip, cycleId, req.hrAccess, {
      pagination,
      filters,
    });

    // Do not reshape CUSTOM totals from a single page — use registerSummary instead.
    let shapedCycle = shapePayrollCycleForHrAccess(
      req.hrAccess,
      cycle,
      pagination ? null : payslips
    );
    shapedCycle = applyRegisterSummaryToCycle(shapedCycle, registerSummary);

    const cycleData = {
      ...shapedCycle,
      totalDeductions: shapedCycle.totalEmployeeDeductions,
      register: payslips,
      payslips,
      payslipTotal,
      registerSummary,
      ...(payslipPagination ? { pagination: payslipPagination } : {}),
    };

    res.status(200).json({
      success: true,
      cycle: shapedCycle,
      payslips,
      payslipTotal,
      registerSummary,
      ...(payslipPagination ? { pagination: payslipPagination } : {}),
      data: cycleData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payroll/cycles/:cycleId/export
 * F61 — CSV export of the filtered register (same scope/filters as detail; not truncated by page).
 */
export async function exportPayrollCycleRegister(req, res, next) {
  try {
    const { PayrollCycle, Payslip } = req.auth.models;
    const { cycleId } = req.params;

    const cycle = await PayrollCycle.findById(cycleId)
      .select("periodMonth periodYear status")
      .lean();
    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    const filters = resolveRegisterFilters(req.query);
    const { payslips } = await loadCyclePayslipsForResponse(Payslip, cycleId, req.hrAccess, {
      filters,
    });
    const { filename, content } = buildRegisterCsv(payslips, cycle);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(content);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payroll/cycles/:cycleId/calculate
 * Recalculate draft payroll for an open cycle.
 */
export async function recalculatePayrollCycle(req, res, next) {
  try {
    assertHrCompanyWidePayrollMutation(req.hrAccess);
    const { cycleId } = req.params;

    // F50-A/B: lock → calculate → transactional replace; prior drafts survive abort.
    const { cycle, calculation } = await recalculatePayrollCycleAtomic({
      models: req.auth.models,
      company: req.auth.company,
      cycleId,
    });

    // F50-D: slim mutation response; clients refetch GET /cycles/:id for the register.
    const { statusCode, body } = buildPayrollMutationResponse({
      hrAccess: req.hrAccess,
      cycle,
      validationIssues: calculation.validationIssues,
      message: "Payroll draft recalculated successfully.",
    });
    res.status(statusCode).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payroll/cycles/:cycleId/finalize
 * Finalizes the payroll cycle, locking records and generating permanent payslips.
 */
export async function finalizePayrollCycle(req, res, next) {
  try {
    assertHrCompanyWidePayrollMutation(req.hrAccess);
    const { cycleId } = req.params;

    // F50-F: cycle + payslip FINALIZED commit together; blocked while calc lock held.
    const { cycle } = await finalizePayrollCycleAtomic({
      models: req.auth.models,
      cycleId,
      finalizedBy: req.auth.user._id,
      actor: req.auth.user,
    });

    const cycleObj = cycle.toObject ? cycle.toObject() : cycle;
    // Finalize remains company-wide; response aggregates redacted for CUSTOM scope
    const shapedCycle = shapePayrollCycleForHrAccess(req.hrAccess, cycleObj, null);

    res.status(200).json({
      success: true,
      cycle: shapedCycle,
      data: shapedCycle,
      message: `Payroll cycle for ${cycle.periodMonth}/${cycle.periodYear} finalized successfully. Payslips are now available for employee access.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payroll/cycles/:cycleId/pay
 * Records payment against a finalized payroll cycle.
 */
export async function recordCyclePayment(req, res, next) {
  try {
    assertHrCompanyWidePayrollMutation(req.hrAccess);
    const { PayrollCycle, Payslip, AuditLog } = req.auth.models;
    const { cycleId } = req.params;
    const { paymentDate, paymentMethod, referenceNumber, amount, amountPaid, remarks, notes } = req.body || {};

    const cycle = await PayrollCycle.findById(cycleId);
    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    if (cycle.status === "DRAFT" || cycle.status === "CALCULATED") {
      throw new HttpError(400, "Cannot record payment on an unfinalized payroll cycle. Finalize payroll first.");
    }

    const rawAmount = amountPaid != null ? amountPaid : amount;
    const payAmount = parseFloat(rawAmount != null ? rawAmount : cycle.totalNetPayable);
    if (isNaN(payAmount) || payAmount <= 0) {
      throw new HttpError(400, "Please provide a valid payment amount greater than zero.");
    }

    // Check duplicate reference number
    const refNum = referenceNumber?.trim() || "";
    if (refNum && Array.isArray(cycle.payments)) {
      const isDuplicate = cycle.payments.some((p) => p.referenceNumber && p.referenceNumber.toLowerCase() === refNum.toLowerCase());
      if (isDuplicate) {
        throw new HttpError(409, `Payment with reference number "${refNum}" has already been recorded.`);
      }
    }

    // Check overpayment
    const currentPaid = cycle.totalPaidAmount || 0;
    const remaining = Math.max(0, cycle.totalNetPayable - currentPaid);
    if (payAmount > remaining) {
      throw new HttpError(400, `Payment amount cannot exceed the remaining payable balance of ₹${remaining.toLocaleString("en-IN")}.`);
    }

    const paymentRecord = {
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      paymentMethod: paymentMethod || "NEFT_RTGS",
      referenceNumber: refNum,
      amount: payAmount,
      remarks: (remarks || notes || "").trim(),
      recordedBy: req.auth.user._id,
      recordedAt: new Date(),
    };

    cycle.payments.push(paymentRecord);
    cycle.totalPaidAmount = currentPaid + payAmount;

    if (cycle.totalPaidAmount >= cycle.totalNetPayable) {
      cycle.paymentStatus = "PAID";
      cycle.status = "PAID";
    } else {
      cycle.paymentStatus = "PARTIALLY_PAID";
      cycle.status = "PARTIALLY_PAID";
    }

    await cycle.save();

    // Mark individual payslips as PAID / PARTIALLY_PAID
    await Payslip.updateMany(
      { payrollCycleId: cycle._id },
      {
        $set: {
          paymentStatus: cycle.paymentStatus,
          status: cycle.paymentStatus === "PAID" ? "PAID" : "FINALIZED",
        },
        $push: { payments: paymentRecord },
      }
    );

    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "PAYROLL_PAYMENT_RECORDED",
        targetType: "PayrollCycle",
        targetId: cycle._id,
        changes: {
          amount: payAmount,
          paymentMethod,
          referenceNumber: refNum,
        },
      });
    }

    const cycleObj = cycle.toObject ? cycle.toObject() : cycle;
    cycleObj.paymentSummary = {
      totalPaid: cycle.totalPaidAmount,
      remainingPayable: Math.max(0, cycle.totalNetPayable - cycle.totalPaidAmount),
      paymentStatus: cycle.paymentStatus,
    };

    res.status(200).json({
      success: true,
      cycle: cycleObj,
      data: cycleObj,
      message: `Payment of ₹${payAmount.toLocaleString("en-IN")} recorded successfully.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payroll/employee/payslips
 * Authenticated employee retrieves their own finalized payslips.
 */
export async function getEmployeePayslips(req, res, next) {
  try {
    const { Employee, Payslip } = req.auth.models;

    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee profile not found.");
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      MAX_EMPLOYEE_PAYSLIP_LIMIT,
      Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_EMPLOYEE_PAYSLIP_LIMIT)
    );
    const filter = {
      employeeId: employee._id,
      status: { $in: ["FINALIZED", "PAID"] },
    };
    const total = await Payslip.countDocuments(filter);

    // F50 residual: bounded self-service list (default 36 ≈ 3 years monthly).
    const payslips = await Payslip.find(filter)
      .select(PAYSLIP_EMPLOYEE_LIST_SELECT)
      .sort({ periodYear: -1, periodMonth: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      payslips,
      data: payslips,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil((total || 0) / limit)),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payroll/employee/payslips/:payslipId/download
 * Downloads a finalized payslip in authentic PDF format.
 */
export async function downloadPayslipPdf(req, res, next) {
  try {
    const { Employee, Payslip } = req.auth.models;
    const { payslipId } = req.params;

    let payslip = null;

    // Search by ObjectId or payslipNumber
    if (/^[0-9a-fA-F]{24}$/.test(payslipId)) {
      payslip = await Payslip.findById(payslipId).lean();
    }
    if (!payslip) {
      payslip = await Payslip.findOne({ payslipNumber: payslipId }).lean();
    }

    if (!payslip) {
      throw new HttpError(404, "Payslip not found.");
    }

    // Fail closed: owner or HR_ADMIN only (non-EMPLOYEE identity roles cannot bypass).
    const viewerEmployee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });
    assertCanAccessPayslip({
      user: req.auth.user,
      viewerEmployee,
      payslip,
    });

    if (req.auth.user.role === USER_ROLES.HR_ADMIN) {
      // HR may download via ownership bypass; still require payroll.view + scope when enforced
      if (!req.hrAccess) {
        const { resolveHrAccessContext } = await import("../services/hrAccessEnforcementService.js");
        req.hrAccess = await resolveHrAccessContext({
          user: req.auth.user,
          company: req.auth.company,
          models: req.auth.models,
        });
      }
      assertHrPermission(req.hrAccess, "payroll.view");
      assertEmployeeInScope(req.hrAccess, payslip.employeeId);
    }

    // Do not download unfinalized drafts
    if (payslip.status === "DRAFT") {
      throw new HttpError(400, "Draft payslips cannot be downloaded until payroll has been finalized.");
    }

    const pdfBuffer = await generatePayslipPdfBuffer(payslip, req.auth.company);

    const safeCode = (payslip.employeeSnapshot?.employeeCode || "EMP").replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `Payslip_${safeCode}_${payslip.periodYear}_${String(payslip.periodMonth).padStart(2, "0")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

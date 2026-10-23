import { HttpError } from "../utils/httpError.js";
import { calculatePayrollCycle } from "../services/payrollCalculationService.js";
import { generatePayslipPdfBuffer } from "../services/payslipPdfService.js";

/**
 * GET /api/payroll/cycles
 * HR Admin lists all payroll cycles for the company.
 */
export async function listPayrollCycles(req, res, next) {
  try {
    const { PayrollCycle } = req.auth.models;
    const cycles = await PayrollCycle.find({})
      .sort({ periodYear: -1, periodMonth: -1 })
      .populate("createdBy", "name email")
      .populate("finalizedBy", "name email")
      .lean();

    res.status(200).json({
      success: true,
      cycles,
      data: cycles,
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
    const { PayrollCycle, Payslip } = req.auth.models;
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

    // Check for duplicate cycle for this company
    const existing = await PayrollCycle.findOne({ periodMonth: month, periodYear: year });
    if (existing) {
      throw new HttpError(409, `A payroll cycle for ${month}/${year} already exists.`);
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const monthStr = String(month).padStart(2, "0");
    const periodStartDate = new Date(`${year}-${monthStr}-01T00:00:00.000Z`);
    const periodEndDate = new Date(`${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`);

    // Calculate initial preview draft
    const calculation = await calculatePayrollCycle({
      models: req.auth.models,
      company: req.auth.company,
      periodMonth: month,
      periodYear: year,
    });

    const newCycle = await PayrollCycle.create({
      periodMonth: month,
      periodYear: year,
      periodStartDate,
      periodEndDate,
      status: "CALCULATED",
      employeeCount: calculation.cycleSummary.employeeCount,
      totalGrossEarnings: calculation.cycleSummary.totalGrossEarnings,
      totalEmployeeDeductions: calculation.cycleSummary.totalEmployeeDeductions,
      totalEmployerContributions: calculation.cycleSummary.totalEmployerContributions,
      totalNetPayable: calculation.cycleSummary.totalNetPayable,
      totalPaidAmount: 0,
      paymentStatus: "UNPAID",
      payments: [],
      validationIssues: calculation.validationIssues,
      notes: notes || "",
      createdBy: req.auth.user._id,
      calculatedAt: new Date(),
    });

    // Save draft payslips
    if (calculation.employeeRecords.length > 0) {
      const payslipsToInsert = calculation.employeeRecords.map((rec) => ({
        ...rec,
        payrollCycleId: newCycle._id,
        status: "DRAFT",
      }));
      await Payslip.insertMany(payslipsToInsert);
    }

    res.status(201).json({
      success: true,
      cycle: newCycle,
      data: newCycle,
      employeeCount: calculation.cycleSummary.employeeCount,
      validationIssues: calculation.validationIssues,
      message: `Payroll cycle for ${month}/${year} created and draft calculated.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/payroll/cycles/:cycleId
 * HR Admin views a specific cycle and its employee register.
 */
export async function getPayrollCycleDetails(req, res, next) {
  try {
    const { PayrollCycle, Payslip } = req.auth.models;
    const { cycleId } = req.params;

    const cycle = await PayrollCycle.findById(cycleId)
      .populate("createdBy", "name email")
      .populate("finalizedBy", "name email")
      .lean();

    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    const payslips = await Payslip.find({ payrollCycleId: cycleId })
      .populate("employeeId", "fullName employeeCode email avatar job")
      .sort({ "employeeSnapshot.fullName": 1 })
      .lean();

    const cycleData = {
      ...cycle,
      totalDeductions: cycle.totalEmployeeDeductions,
      register: payslips.map((p) => ({
        ...p,
        employeeNumber: p.employeeSnapshot?.employeeCode || "",
      })),
      payslips,
    };

    res.status(200).json({
      success: true,
      cycle,
      payslips,
      data: cycleData,
    });
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
    const { PayrollCycle, Payslip } = req.auth.models;
    const { cycleId } = req.params;

    const cycle = await PayrollCycle.findById(cycleId);
    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    if (cycle.status === "FINALIZED" || cycle.status === "PAID" || cycle.status === "PARTIALLY_PAID") {
      throw new HttpError(400, "Cannot recalculate a finalized or paid payroll cycle. Only draft cycles may be recalculated.");
    }

    const calculation = await calculatePayrollCycle({
      models: req.auth.models,
      company: req.auth.company,
      periodMonth: cycle.periodMonth,
      periodYear: cycle.periodYear,
    });

    // Update cycle summary
    cycle.status = "CALCULATED";
    cycle.employeeCount = calculation.cycleSummary.employeeCount;
    cycle.totalGrossEarnings = calculation.cycleSummary.totalGrossEarnings;
    cycle.totalEmployeeDeductions = calculation.cycleSummary.totalEmployeeDeductions;
    cycle.totalEmployerContributions = calculation.cycleSummary.totalEmployerContributions;
    cycle.totalNetPayable = calculation.cycleSummary.totalNetPayable;
    cycle.validationIssues = calculation.validationIssues;
    cycle.calculatedAt = new Date();
    await cycle.save();

    // Re-create draft payslips
    await Payslip.deleteMany({ payrollCycleId: cycle._id });

    if (calculation.employeeRecords.length > 0) {
      const payslipsToInsert = calculation.employeeRecords.map((rec) => ({
        ...rec,
        payrollCycleId: cycle._id,
        status: "DRAFT",
      }));
      await Payslip.insertMany(payslipsToInsert);
    }

    const updatedPayslips = await Payslip.find({ payrollCycleId: cycle._id })
      .populate("employeeId", "fullName employeeCode email avatar job")
      .sort({ "employeeSnapshot.fullName": 1 })
      .lean();

    res.status(200).json({
      success: true,
      cycle,
      data: cycle,
      payslips: updatedPayslips,
      validationIssues: calculation.validationIssues,
      message: "Payroll draft recalculated successfully.",
    });
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
    const { PayrollCycle, Payslip, AuditLog } = req.auth.models;
    const { cycleId } = req.params;

    const cycle = await PayrollCycle.findById(cycleId);
    if (!cycle) {
      throw new HttpError(404, "Payroll cycle not found.");
    }

    if (cycle.status === "FINALIZED" || cycle.status === "PAID") {
      throw new HttpError(400, "Payroll cycle has already been finalized.");
    }

    const now = new Date();
    cycle.status = "FINALIZED";
    cycle.finalizedAt = now;
    cycle.finalizedBy = req.auth.user._id;
    await cycle.save();

    // Lock all draft payslips to FINALIZED
    await Payslip.updateMany(
      { payrollCycleId: cycle._id },
      {
        $set: {
          status: "FINALIZED",
          finalizedAt: now,
          finalizedBy: req.auth.user._id,
        },
      }
    );

    // Record audit log
    if (AuditLog) {
      await AuditLog.create({
        actorUserId: req.auth.user._id,
        actorEmail: req.auth.user.email,
        actorRole: req.auth.user.role,
        action: "PAYROLL_FINALIZED",
        targetType: "PayrollCycle",
        targetId: cycle._id,
        changes: {
          periodMonth: cycle.periodMonth,
          periodYear: cycle.periodYear,
          employeeCount: cycle.employeeCount,
          totalNetPayable: cycle.totalNetPayable,
        },
      });
    }

    res.status(200).json({
      success: true,
      cycle,
      data: cycle,
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
    const { PayrollCycle, Payslip, AuditLog } = req.auth.models;
    const { cycleId } = req.params;
    const { paymentDate, paymentMethod, referenceNumber, amount, amountPaid, remarks, notes } = req.body;

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

    // Only return FINALIZED or PAID payslips (never drafts!)
    const payslips = await Payslip.find({
      employeeId: employee._id,
      status: { $in: ["FINALIZED", "PAID"] },
    })
      .sort({ periodYear: -1, periodMonth: -1 })
      .lean();

    res.status(200).json({
      success: true,
      payslips,
      data: payslips,
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

    // Security ownership check:
    // If the authenticated user is an Employee, they can ONLY access their own payslip!
    if (req.auth.user.role === "EMPLOYEE") {
      const employee = await Employee.findOne({
        $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
      });

      if (!employee || String(payslip.employeeId) !== String(employee._id)) {
        throw new HttpError(403, "Access denied: You are not authorized to view or download this payslip.");
      }
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

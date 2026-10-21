import { findCompanyById, getCompanyModels } from "../config/db.js";
import { SETTLEMENT_STATUSES, VALID_STATUS_TRANSITIONS } from "../models/Settlement.js";
import { HttpError } from "../utils/httpError.js";

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function initiateSettlement(req, res, next) {
  try {
    const { employeeId, lastWorkingDay, exitReason, hrRemarks } = req.body || {};

    if (!employeeId) {
      throw new HttpError(400, "Employee ID is required to initiate F&F settlement.");
    }
    if (!lastWorkingDay) {
      throw new HttpError(400, "Last working day is required.");
    }
    if (!exitReason || !exitReason.trim()) {
      throw new HttpError(400, "Exit reason is required.");
    }

    const lwdDate = new Date(lastWorkingDay);
    if (isNaN(lwdDate.getTime())) {
      throw new HttpError(400, "Please provide a valid last working day date.");
    }

    const models = await getCompanyModels(req.auth.company);
    const employee = await models.Employee.findById(employeeId);
    if (!employee) {
      throw new HttpError(404, "Employee not found in company workspace.");
    }

    // Check if an active (non-completed) settlement already exists
    const existingSettlement = await models.Settlement.findOne({
      employeeId: employee._id,
      status: { $ne: SETTLEMENT_STATUSES.COMPLETED },
    }).populate("employeeId", "fullName employeeCode email job status exit");

    if (existingSettlement) {
      return res.status(200).json({
        success: true,
        existing: true,
        message: "An active F&F settlement already exists for this employee.",
        settlement: existingSettlement,
      });
    }

    // Retrieve compensation revision to calculate baseline pending salary
    let compRecord = null;
    if (models.EmployeeCompensation) {
      compRecord = await models.EmployeeCompensation.findOne({ employeeId: employee._id });
    }
    const latestRevision = compRecord?.revisions && compRecord.revisions.length > 0
      ? compRecord.revisions[compRecord.revisions.length - 1]
      : null;

    // Calculate exit month calendar and worked days
    const exitYear = lwdDate.getFullYear();
    const exitMonth = lwdDate.getMonth(); // 0-indexed
    const totalDaysInExitMonth = new Date(exitYear, exitMonth + 1, 0).getDate();
    const workedDaysInExitMonth = Math.min(lwdDate.getDate(), totalDaysInExitMonth);

    let monthlyCtc = 0;
    let basicSalary = 0;
    let hra = 0;
    let specialAllowance = 0;
    let employerProvidentFund = 0;
    const missingDataFlags = [];

    if (latestRevision) {
      monthlyCtc = parseFloat(latestRevision.monthlyCostToCompany?.toString() || 0);
      basicSalary = parseFloat(latestRevision.salaryComponents?.basicSalary?.toString() || 0);
      hra = parseFloat(latestRevision.salaryComponents?.houseRentAllowance?.toString() || 0);
      specialAllowance = parseFloat(latestRevision.salaryComponents?.specialAllowance?.toString() || 0);
      employerProvidentFund = parseFloat(latestRevision.salaryComponents?.employerProvidentFund?.toString() || 0);

      if (monthlyCtc <= 0 && basicSalary <= 0) {
        missingDataFlags.push("Compensation revision contains zero values. Review salary before approval.");
      }
    } else if (employee.salary || employee.compensation) {
      const sal = employee.salary || employee.compensation;
      monthlyCtc = parseFloat(sal.monthlyCTC || sal.monthlyCostToCompany || 0);
      basicSalary = parseFloat(sal.basicMonthly || sal.basicSalary || 0);
      hra = parseFloat(sal.hraMonthly || sal.houseRentAllowance || 0);
      specialAllowance = parseFloat(sal.specialAllowanceMonthly || sal.specialAllowance || 0);
      employerProvidentFund = parseFloat(sal.statutoryEPFMonthly || sal.employerProvidentFund || 0);

      if (monthlyCtc <= 0 && basicSalary <= 0) {
        missingDataFlags.push("Salary structure contains zero values. Review salary before approval.");
      }
    } else {
      missingDataFlags.push("Salary structure is not configured on record. Please review and input pending salary manually.");
    }

    // Pro-rated Pending Salary
    const dailyRate = totalDaysInExitMonth > 0 ? (monthlyCtc || basicSalary) / totalDaysInExitMonth : 0;
    const pendingSalaryAmount = Math.round(dailyRate * workedDaysInExitMonth);

    // Retrieve Earned Leave Balance for Leave Encashment
    let earnedLeaveBalance = 0;
    if (employee.leaveBalances?.earned !== undefined && employee.leaveBalances.earned !== null) {
      earnedLeaveBalance = Number(employee.leaveBalances.earned);
    } else if (employee.attendance?.leaveBalance?.earned !== undefined && employee.attendance.leaveBalance.earned !== null) {
      earnedLeaveBalance = Number(employee.attendance.leaveBalance.earned);
    } else if (models.LeaveRequest) {
      const approvedEarnedLeaves = await models.LeaveRequest.find({
        employeeId: employee._id,
        leaveTypeCode: "EARNED",
        status: "APPROVED",
      });
      const usedEarnedDays = approvedEarnedLeaves.reduce((acc, req) => acc + (req.daysCount || 0), 0);
      earnedLeaveBalance = Math.max(0, 15 - usedEarnedDays);
    }

    let leaveEncashmentAmount = 0;
    let leaveEncashmentDailyRate = 0;
    if (basicSalary > 0 && earnedLeaveBalance > 0) {
      leaveEncashmentDailyRate = Math.round((basicSalary / 30) * 100) / 100;
      leaveEncashmentAmount = Math.round(earnedLeaveBalance * leaveEncashmentDailyRate);
    } else if (earnedLeaveBalance > 0 && basicSalary <= 0) {
      missingDataFlags.push("Basic salary required for automated leave encashment is missing.");
    }

    // Statutory deductions (EPF)
    const proRatedBasic = totalDaysInExitMonth > 0 ? Math.round((basicSalary / totalDaysInExitMonth) * workedDaysInExitMonth) : 0;
    const statutoryEpf = employerProvidentFund > 0
      ? Math.round((employerProvidentFund / totalDaysInExitMonth) * workedDaysInExitMonth)
      : Math.round(proRatedBasic * 0.12);

    const earnings = [
      {
        id: "pending_salary",
        title: `Pending Salary (${workedDaysInExitMonth}/${totalDaysInExitMonth} days in exit month)`,
        category: "SALARY",
        amount: pendingSalaryAmount,
        isSystemCalculated: true,
        remarks: `Calculated for ${workedDaysInExitMonth} days based on monthly CTC of ₹${monthlyCtc.toLocaleString("en-IN")}`,
      },
    ];

    if (leaveEncashmentAmount > 0) {
      earnings.push({
        id: "leave_encashment",
        title: `Leave Encashment (${earnedLeaveBalance} Earned Leaves)`,
        category: "LEAVE_ENCASHMENT",
        amount: leaveEncashmentAmount,
        isSystemCalculated: true,
        remarks: `${earnedLeaveBalance} leaves at ₹${leaveEncashmentDailyRate}/day based on basic salary`,
      });
    }

    const deductions = [];
    if (statutoryEpf > 0) {
      deductions.push({
        id: "statutory_epf",
        title: "Statutory Provident Fund (EPF Deduction)",
        category: "STATUTORY",
        amount: statutoryEpf,
        isSystemCalculated: true,
        remarks: "12% of pro-rated basic salary",
      });
    }

    const totalEarnings = earnings.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalDeductions = deductions.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const netSettlementAmount = Math.max(0, totalEarnings - totalDeductions);

    const settlement = await models.Settlement.create({
      employeeId: employee._id,
      exitDetails: {
        lastWorkingDay: lwdDate,
        exitReason: exitReason.trim(),
        hrRemarks: (hrRemarks || "").trim(),
        initiatedBy: req.auth.user._id,
        initiatedAt: new Date(),
      },
      status: SETTLEMENT_STATUSES.DRAFT,
      statusHistory: [
        {
          status: SETTLEMENT_STATUSES.DRAFT,
          changedBy: req.auth.user._id,
          changedAt: new Date(),
          remarks: "F&F Settlement initiated by HR Admin.",
        },
      ],
      calculationInputs: {
        monthlyCtc,
        basicSalary,
        hra,
        specialAllowance,
        workingDaysInExitMonth: totalDaysInExitMonth,
        workedDaysInExitMonth,
        dailyRate: Math.round(dailyRate * 100) / 100,
        earnedLeaveBalance,
        leaveEncashmentEligible: earnedLeaveBalance > 0,
        leaveEncashmentDailyRate,
        missingDataFlags,
      },
      financialBreakdown: {
        earnings,
        deductions,
        totalEarnings,
        totalDeductions,
        netSettlementAmount,
      },
      adjustmentsHistory: [],
      paymentDetails: {},
    });

    // Update employee record exit date and reason while strictly preserving historical records
    employee.exit = employee.exit || {};
    employee.exit.inactiveDate = lwdDate;
    employee.exit.reason = exitReason.trim();
    await employee.save();

    const populated = await models.Settlement.findById(settlement._id).populate(
      "employeeId",
      "fullName employeeCode email job status exit"
    );

    res.status(201).json({
      success: true,
      message: "F&F settlement initiated successfully.",
      settlement: populated,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSettlements(req, res, next) {
  try {
    const { search = "", status = "", page = 1, limit = 50 } = req.query;
    const models = await getCompanyModels(req.auth.company);

    const query = {};
    if (status && status !== "ALL" && Object.values(SETTLEMENT_STATUSES).includes(status.toUpperCase())) {
      query.status = status.toUpperCase();
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    let settlements = await models.Settlement.find(query)
      .populate("employeeId", "fullName employeeCode email job status exit")
      .populate("exitDetails.initiatedBy", "name email")
      .populate("paymentDetails.recordedBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      settlements = settlements.filter((s) => {
        const empName = s.employeeId?.fullName?.toLowerCase() || "";
        const empCode = s.employeeId?.employeeCode?.toLowerCase() || "";
        const empEmail = s.employeeId?.email?.toLowerCase() || "";
        const reason = s.exitDetails?.exitReason?.toLowerCase() || "";
        return (
          empName.includes(q) ||
          empCode.includes(q) ||
          empEmail.includes(q) ||
          reason.includes(q)
        );
      });
    }

    const total = settlements.length;
    const paginated = settlements.slice(skip, skip + limitNum);

    res.json({
      success: true,
      settlements: paginated,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSettlementById(req, res, next) {
  try {
    const { id } = req.params;
    const models = await getCompanyModels(req.auth.company);

    const settlement = await models.Settlement.findById(id)
      .populate("employeeId", "fullName employeeCode email job status exit residentialAddress bankDetails taxDetails")
      .populate("exitDetails.initiatedBy", "name email")
      .populate("statusHistory.changedBy", "name email")
      .populate("adjustmentsHistory.adjustedBy", "name email")
      .populate("paymentDetails.recordedBy", "name email");

    if (!settlement) {
      throw new HttpError(404, "Settlement record not found.");
    }

    // Role authorization check: only HR_ADMIN or owning employee with finalized settlement can access
    if (req.auth.user.role !== "HR_ADMIN") {
      if (req.auth.user.role === "EMPLOYEE") {
        const empUserId = settlement.employeeId?.userId?.toString();
        const empEmail = settlement.employeeId?.email?.toLowerCase();
        const currentUserId = req.auth.user._id?.toString();
        const currentUserEmail = req.auth.user.email?.toLowerCase();

        const isOwner = (empUserId && empUserId === currentUserId) || (empEmail && empEmail === currentUserEmail);
        if (!isOwner) {
          throw new HttpError(403, "You do not have permission to view another employee's settlement statement.");
        }

        // Do not expose draft or unapproved amounts to employee
        if (![SETTLEMENT_STATUSES.APPROVED, SETTLEMENT_STATUSES.PAID, SETTLEMENT_STATUSES.COMPLETED].includes(settlement.status)) {
          throw new HttpError(403, "Your settlement statement is currently under review or on hold and has not yet been finalized.");
        }
      } else {
        throw new HttpError(403, "Unauthorized to access settlement statements.");
      }
    }

    res.json({
      success: true,
      settlement,
      company: {
        name: req.auth.company.companyName,
        companyName: req.auth.company.companyName,
        slug: req.auth.company.slug,
        branding: req.auth.company.branding || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSettlementDraft(req, res, next) {
  try {
    const { id } = req.params;
    const { earnings, deductions, hrRemarks, manualAdjustmentRemarks } = req.body || {};
    const models = await getCompanyModels(req.auth.company);

    const settlement = await models.Settlement.findById(id);
    if (!settlement) {
      throw new HttpError(404, "Settlement record not found.");
    }

    if (settlement.status !== SETTLEMENT_STATUSES.DRAFT && settlement.status !== SETTLEMENT_STATUSES.ON_HOLD) {
      throw new HttpError(
        400,
        `Cannot modify financial breakdown of a settlement with status ${settlement.status}. Only DRAFT or ON_HOLD settlements can be edited.`
      );
    }

    if (!Array.isArray(earnings) || !Array.isArray(deductions)) {
      throw new HttpError(400, "Earnings and deductions must be provided as lists of items.");
    }

    // Validate and sanitize line items
    const sanitizedEarnings = earnings.map((item, idx) => {
      const amt = Math.max(0, parseFloat(item.amount) || 0);
      return {
        id: item.id || `custom_earn_${idx + 1}`,
        title: (item.title || "Other Earning").trim(),
        category: item.category || "OTHER",
        amount: amt,
        isSystemCalculated: Boolean(item.isSystemCalculated),
        remarks: (item.remarks || "").trim(),
      };
    });

    const sanitizedDeductions = deductions.map((item, idx) => {
      const amt = Math.max(0, parseFloat(item.amount) || 0);
      return {
        id: item.id || `custom_ded_${idx + 1}`,
        title: (item.title || "Other Deduction").trim(),
        category: item.category || "OTHER",
        amount: amt,
        isSystemCalculated: Boolean(item.isSystemCalculated),
        remarks: (item.remarks || "").trim(),
      };
    });

    const totalEarnings = sanitizedEarnings.reduce((acc, it) => acc + it.amount, 0);
    const totalDeductions = sanitizedDeductions.reduce((acc, it) => acc + it.amount, 0);
    const netSettlementAmount = Math.max(0, totalEarnings - totalDeductions);

    const previousNet = settlement.financialBreakdown?.netSettlementAmount || 0;
    if (previousNet !== netSettlementAmount || manualAdjustmentRemarks) {
      settlement.adjustmentsHistory.push({
        adjustedAt: new Date(),
        adjustedBy: req.auth.user._id,
        previousNet,
        newNet: netSettlementAmount,
        remarks: (manualAdjustmentRemarks || "Manual adjustments updated by HR Admin").trim(),
      });
    }

    settlement.financialBreakdown = {
      earnings: sanitizedEarnings,
      deductions: sanitizedDeductions,
      totalEarnings,
      totalDeductions,
      netSettlementAmount,
    };

    if (hrRemarks !== undefined) {
      settlement.exitDetails.hrRemarks = (hrRemarks || "").trim();
    }

    await settlement.save();

    const updated = await models.Settlement.findById(settlement._id)
      .populate("employeeId", "fullName employeeCode email job status exit")
      .populate("statusHistory.changedBy", "name email")
      .populate("adjustmentsHistory.adjustedBy", "name email");

    res.json({
      success: true,
      message: "Settlement draft updated successfully.",
      settlement: updated,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSettlementStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status: targetStatus, reason, remarks, holdReason } = req.body || {};
    const effectiveHoldReason = (holdReason || reason || remarks || "").trim();

    if (!targetStatus) {
      throw new HttpError(400, "Target status is required.");
    }

    const models = await getCompanyModels(req.auth.company);
    const settlement = await models.Settlement.findById(id);
    if (!settlement) {
      throw new HttpError(404, "Settlement record not found.");
    }

    const currentStatus = settlement.status;
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedTransitions.includes(targetStatus)) {
      throw new HttpError(
        400,
        `Invalid status transition from ${currentStatus} to ${targetStatus}. Allowed transitions: ${
          allowedTransitions.join(", ") || "None (Terminal State)"
        }`
      );
    }

    if (targetStatus === SETTLEMENT_STATUSES.ON_HOLD) {
      if (!effectiveHoldReason) {
        throw new HttpError(400, "A reason or remarks must be provided when placing a settlement on hold.");
      }
      settlement.holdReason = effectiveHoldReason;
    } else if (currentStatus === SETTLEMENT_STATUSES.ON_HOLD) {
      settlement.holdReason = "";
    }

    if (targetStatus === SETTLEMENT_STATUSES.APPROVED) {
      settlement.approvedAt = new Date();
      settlement.approvedBy = req.auth.user._id;
    }

    settlement.status = targetStatus;
    settlement.statusHistory.push({
      status: targetStatus,
      changedBy: req.auth.user._id,
      changedAt: new Date(),
      remarks: (remarks || reason || `Status changed to ${targetStatus}`).trim(),
    });

    await settlement.save();

    const updated = await models.Settlement.findById(settlement._id)
      .populate("employeeId", "fullName employeeCode email job status exit")
      .populate("statusHistory.changedBy", "name email");

    res.json({
      success: true,
      message: `Settlement status updated to ${targetStatus}.`,
      settlement: updated,
    });
  } catch (error) {
    next(error);
  }
}

export async function recordSettlementPayment(req, res, next) {
  try {
    const { id } = req.params;
    const { paymentDate, paymentMethod, referenceNumber, remarks } = req.body || {};

    if (!paymentDate) {
      throw new HttpError(400, "Payment date is required.");
    }
    if (!paymentMethod) {
      throw new HttpError(400, "Payment method is required.");
    }

    const payDate = new Date(paymentDate);
    if (isNaN(payDate.getTime())) {
      throw new HttpError(400, "Please provide a valid payment date.");
    }

    const models = await getCompanyModels(req.auth.company);
    const settlement = await models.Settlement.findById(id);
    if (!settlement) {
      throw new HttpError(404, "Settlement record not found.");
    }

    if (settlement.status !== SETTLEMENT_STATUSES.APPROVED) {
      throw new HttpError(
        400,
        `Payment can only be recorded for APPROVED settlements. Current status is ${settlement.status}.`
      );
    }

    settlement.paymentDetails = {
      paymentDate: payDate,
      paymentMethod,
      referenceNumber: (referenceNumber || "").trim(),
      remarks: (remarks || "").trim(),
      recordedBy: req.auth.user._id,
      recordedAt: new Date(),
    };

    settlement.status = SETTLEMENT_STATUSES.PAID;
    settlement.statusHistory.push({
      status: SETTLEMENT_STATUSES.PAID,
      changedBy: req.auth.user._id,
      changedAt: new Date(),
      remarks: `Payment recorded via ${paymentMethod} on ${formatDate(payDate)}. Ref: ${referenceNumber || "N/A"}`,
    });

    await settlement.save();

    const updated = await models.Settlement.findById(settlement._id)
      .populate("employeeId", "fullName employeeCode email job status exit")
      .populate("statusHistory.changedBy", "name email")
      .populate("paymentDetails.recordedBy", "name email");

    res.json({
      success: true,
      message: "Settlement payment recorded successfully.",
      settlement: updated,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeSettlement(req, res, next) {
  try {
    const { id } = req.params;
    const models = await getCompanyModels(req.auth.company);

    const settlement = await models.Settlement.findById(id);
    if (!settlement) {
      throw new HttpError(404, "Settlement record not found.");
    }

    if (settlement.status !== SETTLEMENT_STATUSES.PAID) {
      throw new HttpError(
        400,
        `Settlement can only be completed after payment has been recorded (PAID status). Current status is ${settlement.status}.`
      );
    }

    settlement.status = SETTLEMENT_STATUSES.COMPLETED;
    settlement.statusHistory.push({
      status: SETTLEMENT_STATUSES.COMPLETED,
      changedBy: req.auth.user._id,
      changedAt: new Date(),
      remarks: "Full and Final settlement formally completed and closed.",
    });

    await settlement.save();

    // Mark employee record with fullAndFinalGeneratedAt
    const employee = await models.Employee.findById(settlement.employeeId);
    if (employee) {
      employee.exit = employee.exit || {};
      employee.exit.fullAndFinalGeneratedAt = new Date();
      await employee.save();
    }

    const updated = await models.Settlement.findById(settlement._id)
      .populate("employeeId", "fullName employeeCode email job status exit")
      .populate("statusHistory.changedBy", "name email");

    res.json({
      success: true,
      message: "F&F Settlement completed successfully.",
      settlement: updated,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMySettlement(req, res, next) {
  try {
    const models = await getCompanyModels(req.auth.company);
    const user = req.auth.user;

    // Find employee linked to authenticated user
    const employee = await models.Employee.findOne({
      $or: [{ userId: user._id }, { email: user.email.toLowerCase() }],
    });

    if (!employee) {
      return res.json({ success: true, settlement: null });
    }

    // Expose only finalized statements: APPROVED, PAID, or COMPLETED
    const settlement = await models.Settlement.findOne({
      employeeId: employee._id,
      status: {
        $in: [
          SETTLEMENT_STATUSES.APPROVED,
          SETTLEMENT_STATUSES.PAID,
          SETTLEMENT_STATUSES.COMPLETED,
        ],
      },
    })
      .populate("employeeId", "fullName employeeCode email job status exit bankDetails")
      .sort({ createdAt: -1 })
      .lean();

    let formattedSettlement = null;
    if (settlement) {
      formattedSettlement = {
        ...settlement,
        id: settlement._id,
        settlementNumber: `FNF-${String(settlement._id).slice(-6).toUpperCase()}`,
        lastWorkingDay: settlement.exitDetails?.lastWorkingDay,
        exitReason: settlement.exitDetails?.exitReason,
        totalEarnings: settlement.financialBreakdown?.totalEarnings || 0,
        totalDeductions: settlement.financialBreakdown?.totalDeductions || 0,
        netSettlementAmount: settlement.financialBreakdown?.netSettlementAmount || 0,
        earnings: settlement.financialBreakdown?.earnings || [],
        deductions: settlement.financialBreakdown?.deductions || [],
        paymentDetails: {
          ...settlement.paymentDetails,
          paymentRecorded: Boolean(settlement.paymentDetails?.paymentDate),
          transactionReference: settlement.paymentDetails?.referenceNumber || "",
        },
        employee: {
          id: settlement.employeeId?._id,
          name: settlement.employeeId?.fullName,
          code: settlement.employeeId?.employeeCode,
          designation: settlement.employeeId?.job?.jobTitle || "—",
          department: settlement.employeeId?.job?.department || "—",
        },
        company: {
          name: req.auth.company.companyName,
          companyName: req.auth.company.companyName,
        },
      };
    }

    res.json({
      success: true,
      settlement: formattedSettlement,
      company: {
        name: req.auth.company.companyName,
        companyName: req.auth.company.companyName,
      },
    });
  } catch (error) {
    next(error);
  }
}

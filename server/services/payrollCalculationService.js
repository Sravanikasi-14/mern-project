import { getCompanyBusinessDate } from "./attendanceService.js";

function toDateString(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculates payroll for a company tenant and period.
 * 
 * @param {Object} options
 * @param {Object} options.models - Tenant database models (Employee, EmployeeCompensation, Attendance, LeaveRequest, CompanyHrPolicy)
 * @param {Object} options.company - Authenticated company context
 * @param {number} options.periodMonth - Month number 1..12
 * @param {number} options.periodYear - Year (e.g. 2026)
 * @returns {Promise<Object>} Calculation result with cycleSummary, employeeRecords, and validationIssues
 */
export async function calculatePayrollCycle({
  models,
  company,
  periodMonth,
  periodYear,
}) {
  const {
    Employee,
    EmployeeCompensation,
    Attendance,
    LeaveRequest,
    CompanyHrPolicy,
  } = models;

  const month = parseInt(periodMonth, 10);
  const year = parseInt(periodYear, 10);

  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid payroll month: ${periodMonth}`);
  }
  if (isNaN(year) || year < 2020 || year > 2100) {
    throw new Error(`Invalid payroll year: ${periodYear}`);
  }

  // 1. Period Dates
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = String(month).padStart(2, "0");
  const periodStartDate = new Date(`${year}-${monthStr}-01T00:00:00.000Z`);
  const periodEndDate = new Date(`${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`);
  const monthPrefix = `${year}-${monthStr}`;

  // 2. Fetch Active HR Policy for payroll, weekend and holiday rules
  let policy = null;
  if (CompanyHrPolicy) {
    policy = await CompanyHrPolicy.findOne({
      effectiveFromDate: { $lte: periodEndDate },
    })
      .sort({ effectiveFromDate: -1 })
      .lean();

    if (!policy) {
      policy = await CompanyHrPolicy.findOne({}).sort({ effectiveFromDate: -1 }).lean();
    }
  }

  const currencySymbol = policy?.payrollRules?.currencySymbol || "₹";
  const currencyCode = policy?.payrollRules?.currencyCode || "INR";
  const deductLopForUnpaidLeave = policy?.payrollRules?.deductLopForUnpaidLeave ?? true;
  const weekendRules = policy?.weekendRules || {
    saturdayOff: true,
    sundayOff: true,
    alternateSaturdaysOff: false,
    isPaidWeekend: true,
  };
  const policyHolidays = policy?.holidays || [];

  // Holiday map for the month
  const holidayDateMap = new Map();
  for (const h of policyHolidays) {
    if (h.date) {
      const dStr = toDateString(h.date);
      if (dStr.startsWith(monthPrefix)) {
        holidayDateMap.set(dStr, h.name || "Holiday");
      }
    }
  }

  // Calculate calendar days in the month
  let totalWorkingDays = 0;
  let totalWeekendDays = 0;
  let totalHolidayDays = 0;

  const calendarDayTypes = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${monthStr}-${String(d).padStart(2, "0")}`;
    const dateObj = new Date(`${dStr}T12:00:00.000Z`);
    const dayOfWeek = dateObj.getDay(); // 0 = Sun, 6 = Sat

    let isWeekend = false;
    if (dayOfWeek === 0 && weekendRules.sundayOff) {
      isWeekend = true;
    } else if (dayOfWeek === 6 && weekendRules.saturdayOff) {
      isWeekend = true;
    }

    const isHoliday = holidayDateMap.has(dStr);

    if (isHoliday) {
      totalHolidayDays++;
    } else if (isWeekend) {
      totalWeekendDays++;
    } else {
      totalWorkingDays++;
    }

    calendarDayTypes.push({
      dateStr: dStr,
      isWeekend,
      isHoliday,
      isWorkingDay: !isWeekend && !isHoliday,
    });
  }

  // 3. Fetch Active Employees
  const activeEmployees = await Employee.find({ status: "ACTIVE" })
    .select("_id employeeCode fullName email job bankDetails customFields panNumber")
    .lean();

  const employeeIds = activeEmployees.map((e) => e._id);

  // 4. Batch Fetch Compensation, Leaves, and Attendance for Period
  const [compensations, leaves, attendances] = await Promise.all([
    EmployeeCompensation.find({ employeeId: { $in: employeeIds } }).lean(),
    LeaveRequest.find({
      employeeId: { $in: employeeIds },
      status: "APPROVED",
      fromDate: { $lte: periodEndDate },
      toDate: { $gte: periodStartDate },
    }).lean(),
    Attendance.find({
      employeeId: { $in: employeeIds },
      date: { $regex: `^${monthPrefix}` },
    }).lean(),
  ]);

  // Group by employee
  const compMap = new Map();
  for (const c of compensations) {
    compMap.set(String(c.employeeId), c);
  }

  const leavesByEmp = new Map();
  for (const l of leaves) {
    const k = String(l.employeeId);
    if (!leavesByEmp.has(k)) leavesByEmp.set(k, []);
    leavesByEmp.get(k).push(l);
  }

  const attendanceByEmpAndDate = new Map();
  for (const a of attendances) {
    const k = `${String(a.employeeId)}_${a.date}`;
    attendanceByEmpAndDate.set(k, a);
  }

  const employeeRecords = [];
  const validationIssues = [];

  let cycleTotalGross = 0;
  let cycleTotalDeductions = 0;
  let cycleTotalEmployerContributions = 0;
  let cycleTotalNetPay = 0;

  for (const emp of activeEmployees) {
    const empIdStr = String(emp._id);
    const compRecord = compMap.get(empIdStr);

    // Find effective revision
    let effectiveRevision = null;
    if (compRecord && Array.isArray(compRecord.revisions) && compRecord.revisions.length > 0) {
      const validRevs = compRecord.revisions
        .filter((r) => new Date(r.effectiveFromDate) <= periodEndDate)
        .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

      if (validRevs.length > 0) {
        effectiveRevision = validRevs[0];
      } else {
        // Earliest revision if none <= periodEndDate
        effectiveRevision = compRecord.revisions[0];
      }
    }

    // Determine monthly CTC
    let monthlyCtc = 0;
    if (effectiveRevision) {
      monthlyCtc = parseFloat(effectiveRevision.monthlyCostToCompany?.toString() || 0);
    } else {
      // Fallback to customFields if present
      const legacySalary = parseFloat(String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0));
      if (!isNaN(legacySalary) && legacySalary > 0) {
        monthlyCtc = legacySalary;
      }
    }

    if (!monthlyCtc || isNaN(monthlyCtc) || monthlyCtc <= 0) {
      validationIssues.push({
        employeeId: emp._id,
        employeeCode: emp.employeeCode || "N/A",
        fullName: emp.fullName,
        issue: "No compensation revision or monthly CTC configured for employee",
      });
      continue;
    }

    // Calculate attendance & leaves for this employee
    const empLeaves = leavesByEmp.get(empIdStr) || [];

    let presentDays = 0;
    let paidLeaveDays = 0;
    let lossOfPayDays = 0;

    for (const day of calendarDayTypes) {
      const dStr = day.dateStr;

      // Check if employee has an approved leave on this date
      const activeLeave = empLeaves.find((l) => {
        const fromStr = toDateString(l.fromDate);
        const toStr = toDateString(l.toDate);
        return dStr >= fromStr && dStr <= toStr;
      });

      if (activeLeave) {
        // If leave type is UNPAID or LOP, it's loss of pay
        const isUnpaidLeave =
          activeLeave.leaveTypeCode === "UNPAID" ||
          activeLeave.leaveTypeCode === "LOP" ||
          activeLeave.isPaid === false;

        if (isUnpaidLeave) {
          lossOfPayDays++;
        } else {
          paidLeaveDays++;
        }
        continue;
      }

      // Check attendance on working days
      if (day.isWorkingDay) {
        const att = attendanceByEmpAndDate.get(`${empIdStr}_${dStr}`);
        if (att) {
          if (att.checkIn || att.status === "PRESENT" || att.status === "CHECKED_IN" || att.status === "CHECKED_OUT") {
            presentDays++;
          } else if (att.status === "HALF_DAY") {
            presentDays += 0.5;
            lossOfPayDays += 0.5;
          } else if (att.status === "ABSENT") {
            if (deductLopForUnpaidLeave) {
              lossOfPayDays++;
            }
          } else {
            presentDays++;
          }
        } else {
          // If no specific punch record exists on working day:
          // Check if system has active attendance records for this month overall.
          // If attendance is tracked and employee is absent, count as absent if deductLopForUnpaidLeave is on.
          // In test/demo environments where attendance is not logged, default to present.
          const empHadAnyPunches = attendances.some((a) => String(a.employeeId) === empIdStr);
          if (empHadAnyPunches && deductLopForUnpaidLeave) {
            // Employee has records in this month but not on this working day -> absence
            lossOfPayDays++;
          } else {
            presentDays++;
          }
        }
      }
    }

    // Payable Days formula
    const payableDays = Math.max(0, daysInMonth - lossOfPayDays);
    const prorationRatio = daysInMonth > 0 ? payableDays / daysInMonth : 1;

    // Component Breakdown
    const compComponents = effectiveRevision?.salaryComponents || {};

    let basic = compComponents.basicSalary ? parseFloat(compComponents.basicSalary.toString()) : 0;
    let hra = compComponents.houseRentAllowance ? parseFloat(compComponents.houseRentAllowance.toString()) : 0;
    let conveyance = compComponents.conveyanceAllowance ? parseFloat(compComponents.conveyanceAllowance.toString()) : 0;
    let special = compComponents.specialAllowance ? parseFloat(compComponents.specialAllowance.toString()) : 0;

    // If components are not explicitly itemized, calculate from company policy allowances or standard baseline
    if (basic === 0 && hra === 0 && special === 0) {
      const configuredAllowances = policy?.salaryComponentRules?.allowances;
      if (Array.isArray(configuredAllowances) && configuredAllowances.length > 0) {
        const basicCfg = configuredAllowances.find((a) => a.code === "BASIC");
        const hraCfg = configuredAllowances.find((a) => a.code === "HRA");
        const convCfg = configuredAllowances.find((a) => a.code === "CONVEYANCE");
        const basicPct = basicCfg !== undefined ? basicCfg.percentageOfCtc / 100 : 0.5;
        const hraPct = hraCfg !== undefined ? hraCfg.percentageOfCtc / 100 : 0.3;
        const convPct = convCfg !== undefined ? convCfg.percentageOfCtc / 100 : 0.05;

        basic = Math.round(monthlyCtc * basicPct);
        hra = Math.round(monthlyCtc * hraPct);
        conveyance = Math.round(monthlyCtc * convPct);
        special = Math.max(0, monthlyCtc - (basic + hra + conveyance));
      } else {
        basic = Math.round(monthlyCtc * 0.5);
        hra = Math.round(monthlyCtc * 0.3);
        conveyance = Math.round(monthlyCtc * 0.05);
        special = Math.max(0, monthlyCtc - (basic + hra + conveyance));
      }
    }

    // Prorate components by payable days
    const proratedBasic = Math.round(basic * prorationRatio);
    const proratedHra = Math.round(hra * prorationRatio);
    const proratedConveyance = Math.round(conveyance * prorationRatio);
    const proratedSpecial = Math.round(special * prorationRatio);

    const grossEarnings = proratedBasic + proratedHra + proratedConveyance + proratedSpecial;

    // Employee Deductions (e.g. EPF: 12% of basic)
    let epfDeduction = 0;
    if (compComponents.employerProvidentFund) {
      const epfConfig = parseFloat(compComponents.employerProvidentFund.toString());
      epfDeduction = Math.round(epfConfig * prorationRatio);
    } else if (policy?.taxStatutoryRules?.pfApplicable ?? true) {
      const pfRate = (policy?.taxStatutoryRules?.pfDeductionRatePercent ?? 12) / 100;
      epfDeduction = Math.round(proratedBasic * pfRate);
    }

    let otherDeductions = 0;
    if (compComponents.otherDeductions) {
      otherDeductions = Math.round(parseFloat(compComponents.otherDeductions.toString()) * prorationRatio);
    }

    const totalDeductions = epfDeduction + otherDeductions;

    // Employer Contributions (tracked separately, NOT subtracted from employee net pay)
    const employerPf = epfDeduction;
    const totalEmployerContributions = employerPf;

    const netPayable = Math.max(0, grossEarnings - totalDeductions);

    // Payslip identifier
    const payslipNumber = `PAY-${year}${monthStr}-${emp.employeeCode || String(emp._id).slice(-6).toUpperCase()}`;

    // Itemized breakdowns
    const earnings = [
      { name: "Basic Salary", code: "BASIC", amount: proratedBasic, isTaxable: true },
      { name: "House Rent Allowance (HRA)", code: "HRA", amount: proratedHra, isTaxable: true },
    ];
    if (proratedConveyance > 0) {
      earnings.push({ name: "Conveyance Allowance", code: "CONVEYANCE", amount: proratedConveyance, isTaxable: false });
    }
    if (proratedSpecial > 0) {
      earnings.push({ name: "Special Allowance", code: "SPECIAL", amount: proratedSpecial, isTaxable: true });
    }

    const employeeDeductions = [];
    if (epfDeduction > 0) {
      employeeDeductions.push({ name: "Provident Fund (EPF)", code: "EPF", amount: epfDeduction });
    }
    if (otherDeductions > 0) {
      employeeDeductions.push({ name: "Other Deductions", code: "OTHER", amount: otherDeductions });
    }

    const employerContributions = [];
    if (employerPf > 0) {
      employerContributions.push({ name: "Employer Provident Fund", code: "PF_EMPLOYER", amount: employerPf });
    }

    cycleTotalGross += grossEarnings;
    cycleTotalDeductions += totalDeductions;
    cycleTotalEmployerContributions += totalEmployerContributions;
    cycleTotalNetPay += netPayable;

    employeeRecords.push({
      employeeId: emp._id,
      payslipNumber,
      periodMonth: month,
      periodYear: year,
      periodStartDate,
      periodEndDate,
      employeeSnapshot: {
        employeeCode: emp.employeeCode || "",
        fullName: emp.fullName || "",
        email: emp.email || "",
        department: emp.job?.department || "General",
        jobTitle: emp.job?.jobTitle || "Specialist",
        bankAccountNumber: emp.bankDetails?.accountNumber || "",
        bankName: emp.bankDetails?.bankName || "",
        bankIfsc: emp.bankDetails?.ifscCode || "",
        panNumber: emp.panNumber || "",
      },
      compensationRevisionId: effectiveRevision?._id || null,
      monthlyCostToCompany: monthlyCtc,
      daysBreakdown: {
        totalDaysInMonth: daysInMonth,
        workingDays: totalWorkingDays,
        weekendDays: totalWeekendDays,
        holidayDays: totalHolidayDays,
        presentDays,
        paidLeaveDays,
        lossOfPayDays,
        payableDays,
      },
      earnings,
      employeeDeductions,
      employerContributions,
      grossEarnings,
      totalDeductions,
      totalEmployerContributions,
      netPayable,
      currency: currencyCode,
      currencySymbol,
      status: "DRAFT",
      paymentStatus: "UNPAID",
      payments: [],
    });
  }

  const cycleSummary = {
    periodMonth: month,
    periodYear: year,
    periodStartDate,
    periodEndDate,
    employeeCount: employeeRecords.length,
    totalGrossEarnings: cycleTotalGross,
    totalEmployeeDeductions: cycleTotalDeductions,
    totalEmployerContributions: cycleTotalEmployerContributions,
    totalNetPayable: cycleTotalNetPay,
    currency: currencyCode,
    currencySymbol,
  };

  return {
    cycleSummary,
    employeeRecords,
    validationIssues,
  };
}

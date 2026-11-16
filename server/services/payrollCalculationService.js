/**
 * Payroll cycle calculation (read-only).
 *
 * F50-C: ACTIVE employees are processed in bounded `_id`-ascending batches so
 * source Employee / Compensation / Leave / Attendance / Offer docs are not all
 * held at once. Batch-local maps are discarded after each batch.
 *
 * Remaining O(N) memory: accumulated `employeeRecords` and `validationIssues`
 * (required by the calculate → transactional write contract in F50-A/B/F).
 */

function toDateString(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Default ACTIVE-employee page size for F50-C batching. */
export const DEFAULT_PAYROLL_EMPLOYEE_BATCH_SIZE = 100;

/** Hard cap so env misconfig cannot unbounded-load a single page. */
export const MAX_PAYROLL_EMPLOYEE_BATCH_SIZE = 500;

export const EMPLOYEE_PAYROLL_SELECT =
  "_id employeeCode fullName email job bankDetails panNumber customFields.monthlySalary customFields.salary";

/** Fields actually read for effective revision + CTC / components. */
export const COMPENSATION_PAYROLL_SELECT =
  "employeeId revisions._id revisions.effectiveFromDate revisions.monthlyCostToCompany revisions.salaryComponents";

/**
 * Resolve bounded batch size: explicit option → env → default.
 * Always clamped to [1, MAX_PAYROLL_EMPLOYEE_BATCH_SIZE].
 */
export function resolvePayrollEmployeeBatchSize(override) {
  const raw =
    override != null && override !== ""
      ? Number(override)
      : Number(process.env.PAYROLL_EMPLOYEE_BATCH_SIZE);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PAYROLL_EMPLOYEE_BATCH_SIZE;
  }
  return Math.min(Math.max(1, Math.floor(raw)), MAX_PAYROLL_EMPLOYEE_BATCH_SIZE);
}

/** F50: O(1) set of employee IDs that appear in monthly attendance (parity with Array.some). */
export function buildEmployeesWithAttendanceSet(attendances) {
  const employeesWithAttendance = new Set();
  for (const a of attendances || []) {
    employeesWithAttendance.add(String(a.employeeId));
  }
  return employeesWithAttendance;
}

/**
 * F50: first-match monthly salary by normalized email (parity with Array.find).
 * Normalization: String(email).trim().toLowerCase()
 */
export function buildOfferSalaryByEmailMap(acceptedOffers) {
  const offerSalaryByEmail = new Map();
  for (const o of acceptedOffers || []) {
    const emailKey = String(o.candidate?.email || "").trim().toLowerCase();
    if (!emailKey || offerSalaryByEmail.has(emailKey)) continue;
    offerSalaryByEmail.set(emailKey, o.monthlySalary);
  }
  return offerSalaryByEmail;
}

/**
 * F50: pre-parse leave ranges into empId_dateStr → { isUnpaidLeave }.
 * First covering leave wins (same order as former empLeaves.find).
 * Date strings use the same toDateString local-boundary semantics as before.
 */
export function buildLeaveInfoByEmpAndDate(leavesByEmp, calendarDayTypes) {
  const leaveInfoByEmpAndDate = new Map();
  for (const [empIdStr, empLeaves] of leavesByEmp.entries()) {
    for (const l of empLeaves) {
      const fromStr = toDateString(l.fromDate);
      const toStr = toDateString(l.toDate);
      const isUnpaidLeave =
        l.leaveTypeCode === "UNPAID" || l.leaveTypeCode === "LOP" || l.isPaid === false;
      for (const day of calendarDayTypes) {
        const dStr = day.dateStr;
        if (dStr < fromStr || dStr > toStr) continue;
        const key = `${empIdStr}_${dStr}`;
        if (leaveInfoByEmpAndDate.has(key)) continue;
        leaveInfoByEmpAndDate.set(key, { isUnpaidLeave });
      }
    }
  }
  return leaveInfoByEmpAndDate;
}

export { toDateString };

/**
 * F50-C: stable `_id` pagination over ACTIVE employees (no offset, no full roster load).
 * @yields {object[]} employee docs for one page (length 1..batchSize; last may be partial)
 */
export async function* iterateActiveEmployeeBatches(Employee, batchSize) {
  const size = resolvePayrollEmployeeBatchSize(batchSize);
  let afterId = null;

  for (;;) {
    const filter = afterId
      ? { status: "ACTIVE", _id: { $gt: afterId } }
      : { status: "ACTIVE" };

    const batch = await Employee.find(filter)
      .select(EMPLOYEE_PAYROLL_SELECT)
      .sort({ _id: 1 })
      .limit(size)
      .lean();

    if (!batch.length) {
      break;
    }

    yield batch;
    afterId = batch[batch.length - 1]._id;

    if (batch.length < size) {
      break;
    }
  }
}

/**
 * Same effective-revision selection as the pre-batching path:
 * latest revision with effectiveFromDate <= periodEndDate, else revisions[0].
 */
export function selectEffectiveCompensationRevision(compRecord, periodEndDate) {
  if (!compRecord || !Array.isArray(compRecord.revisions) || compRecord.revisions.length === 0) {
    return null;
  }
  const validRevs = compRecord.revisions
    .filter((r) => new Date(r.effectiveFromDate) <= periodEndDate)
    .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

  if (validRevs.length > 0) {
    return validRevs[0];
  }
  return compRecord.revisions[0];
}

function processEmployeeBatchRecords({
  activeEmployees,
  compMap,
  leaveInfoByEmpAndDate,
  attendanceByEmpAndDate,
  employeesWithAttendance,
  offerSalaryByEmail,
  calendarDayTypes,
  policy,
  periodEndDate,
  periodStartDate,
  daysInMonth,
  totalWorkingDays,
  totalWeekendDays,
  totalHolidayDays,
  month,
  year,
  monthStr,
  currencyCode,
  currencySymbol,
  deductLopForUnpaidLeave,
}) {
  const employeeRecords = [];
  const validationIssues = [];
  let batchGross = 0;
  let batchDeductions = 0;
  let batchEmployer = 0;
  let batchNet = 0;

  for (const emp of activeEmployees) {
    const empIdStr = String(emp._id);
    const compRecord = compMap.get(empIdStr);
    const effectiveRevision = selectEffectiveCompensationRevision(compRecord, periodEndDate);

    let monthlyCtc = 0;
    if (effectiveRevision) {
      monthlyCtc = parseFloat(effectiveRevision.monthlyCostToCompany?.toString() || 0);
    } else {
      const legacySalary = parseFloat(
        String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0)
      );
      if (!isNaN(legacySalary) && legacySalary > 0) {
        monthlyCtc = legacySalary;
      }
    }

    if (!monthlyCtc || isNaN(monthlyCtc) || monthlyCtc <= 0) {
      const emailKey = String(emp.email || "").trim().toLowerCase();
      const offerSalary = parseFloat(String(offerSalaryByEmail.get(emailKey) || 0));
      if (!isNaN(offerSalary) && offerSalary > 0) {
        monthlyCtc = offerSalary;
      }
    }

    if (!monthlyCtc || isNaN(monthlyCtc) || monthlyCtc <= 0) {
      validationIssues.push({
        employeeId: emp._id,
        employeeCode: emp.employeeCode || "N/A",
        fullName: emp.fullName,
        issue:
          "No monthly CTC is configured. Open the employee profile and add compensation before including them in payroll.",
      });
      continue;
    }

    let presentDays = 0;
    let paidLeaveDays = 0;
    let lossOfPayDays = 0;
    const empHadAnyPunches = employeesWithAttendance.has(empIdStr);

    for (const day of calendarDayTypes) {
      const dStr = day.dateStr;

      const leaveInfo = leaveInfoByEmpAndDate.get(`${empIdStr}_${dStr}`);
      if (leaveInfo) {
        if (leaveInfo.isUnpaidLeave) {
          lossOfPayDays++;
        } else {
          paidLeaveDays++;
        }
        continue;
      }

      if (day.isWorkingDay) {
        const att = attendanceByEmpAndDate.get(`${empIdStr}_${dStr}`);
        if (att) {
          if (
            att.checkIn ||
            att.status === "PRESENT" ||
            att.status === "CHECKED_IN" ||
            att.status === "CHECKED_OUT"
          ) {
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
        } else if (empHadAnyPunches && deductLopForUnpaidLeave) {
          lossOfPayDays++;
        } else {
          presentDays++;
        }
      }
    }

    const payableDays = Math.max(0, daysInMonth - lossOfPayDays);
    const prorationRatio = daysInMonth > 0 ? payableDays / daysInMonth : 1;

    const compComponents = effectiveRevision?.salaryComponents || {};

    let basic = compComponents.basicSalary ? parseFloat(compComponents.basicSalary.toString()) : 0;
    let hra = compComponents.houseRentAllowance
      ? parseFloat(compComponents.houseRentAllowance.toString())
      : 0;
    let conveyance = compComponents.conveyanceAllowance
      ? parseFloat(compComponents.conveyanceAllowance.toString())
      : 0;
    let special = compComponents.specialAllowance
      ? parseFloat(compComponents.specialAllowance.toString())
      : 0;

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

    const proratedBasic = Math.round(basic * prorationRatio);
    const proratedHra = Math.round(hra * prorationRatio);
    const proratedConveyance = Math.round(conveyance * prorationRatio);
    const proratedSpecial = Math.round(special * prorationRatio);

    const grossEarnings = proratedBasic + proratedHra + proratedConveyance + proratedSpecial;

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
      otherDeductions = Math.round(
        parseFloat(compComponents.otherDeductions.toString()) * prorationRatio
      );
    }

    const totalDeductions = epfDeduction + otherDeductions;
    const employerPf = epfDeduction;
    const totalEmployerContributions = employerPf;
    const netPayable = Math.max(0, grossEarnings - totalDeductions);

    const payslipNumber = `PAY-${year}${monthStr}-${
      emp.employeeCode || String(emp._id).slice(-6).toUpperCase()
    }`;

    const earnings = [
      { name: "Basic Salary", code: "BASIC", amount: proratedBasic, isTaxable: true },
      { name: "House Rent Allowance (HRA)", code: "HRA", amount: proratedHra, isTaxable: true },
    ];
    if (proratedConveyance > 0) {
      earnings.push({
        name: "Conveyance Allowance",
        code: "CONVEYANCE",
        amount: proratedConveyance,
        isTaxable: false,
      });
    }
    if (proratedSpecial > 0) {
      earnings.push({
        name: "Special Allowance",
        code: "SPECIAL",
        amount: proratedSpecial,
        isTaxable: true,
      });
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
      employerContributions.push({
        name: "Employer Provident Fund",
        code: "PF_EMPLOYER",
        amount: employerPf,
      });
    }

    batchGross += grossEarnings;
    batchDeductions += totalDeductions;
    batchEmployer += totalEmployerContributions;
    batchNet += netPayable;

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

  return {
    employeeRecords,
    validationIssues,
    batchGross,
    batchDeductions,
    batchEmployer,
    batchNet,
  };
}

/**
 * Calculates payroll for a company tenant and period.
 *
 * @param {Object} options
 * @param {Object} options.models - Tenant database models
 * @param {Object} options.company - Authenticated company context
 * @param {number} options.periodMonth - Month number 1..12
 * @param {number} options.periodYear - Year (e.g. 2026)
 * @param {number} [options.employeeBatchSize] - F50-C override for ACTIVE page size
 * @param {function} [options.onEmployeeBatch] - optional test/observability hook
 * @returns {Promise<Object>} Calculation result with cycleSummary, employeeRecords, and validationIssues
 */
export async function calculatePayrollCycle({
  models,
  company,
  periodMonth,
  periodYear,
  employeeBatchSize,
  onEmployeeBatch,
}) {
  const {
    Employee,
    EmployeeCompensation,
    Attendance,
    LeaveRequest,
    CompanyHrPolicy,
    OfferLetter,
  } = models;

  const month = parseInt(periodMonth, 10);
  const year = parseInt(periodYear, 10);

  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid payroll month: ${periodMonth}`);
  }
  if (isNaN(year) || year < 2020 || year > 2100) {
    throw new Error(`Invalid payroll year: ${periodYear}`);
  }

  const batchSize = resolvePayrollEmployeeBatchSize(employeeBatchSize);

  // 1. Period Dates
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStr = String(month).padStart(2, "0");
  const periodStartDate = new Date(`${year}-${monthStr}-01T00:00:00.000Z`);
  const periodEndDate = new Date(
    `${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`
  );
  const monthPrefix = `${year}-${monthStr}`;

  // 2. Fetch Active HR Policy once — shared snapshot for every employee batch
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

  const holidayDateMap = new Map();
  for (const h of policyHolidays) {
    if (h.date) {
      const dStr = toDateString(h.date);
      if (dStr.startsWith(monthPrefix)) {
        holidayDateMap.set(dStr, h.name || "Holiday");
      }
    }
  }

  let totalWorkingDays = 0;
  let totalWeekendDays = 0;
  let totalHolidayDays = 0;

  const calendarDayTypes = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${monthStr}-${String(d).padStart(2, "0")}`;
    const dateObj = new Date(`${dStr}T12:00:00.000Z`);
    const dayOfWeek = dateObj.getDay();

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

  // Accumulated outputs (O(N) — required for F50-A/B/F write contract).
  const employeeRecords = [];
  const validationIssues = [];
  let cycleTotalGross = 0;
  let cycleTotalDeductions = 0;
  let cycleTotalEmployerContributions = 0;
  let cycleTotalNetPay = 0;
  let batchIndex = 0;

  // 3–4. F50-C: page ACTIVE employees; load related docs only for the current page.
  for await (const activeEmployees of iterateActiveEmployeeBatches(Employee, batchSize)) {
    const employeeIds = activeEmployees.map((e) => e._id);
    const employeeEmails = activeEmployees
      .map((e) => String(e.email || "").trim().toLowerCase())
      .filter(Boolean);

    if (typeof onEmployeeBatch === "function") {
      onEmployeeBatch({
        batchIndex,
        batchSize: activeEmployees.length,
        configuredBatchSize: batchSize,
        employeeIds: employeeIds.map((id) => String(id)),
      });
    }
    batchIndex += 1;

    const [compensations, leaves, attendances, acceptedOffers] = await Promise.all([
      EmployeeCompensation.find({ employeeId: { $in: employeeIds } })
        .select(COMPENSATION_PAYROLL_SELECT)
        .lean(),
      LeaveRequest.find({
        employeeId: { $in: employeeIds },
        status: "APPROVED",
        fromDate: { $lte: periodEndDate },
        toDate: { $gte: periodStartDate },
      })
        .select("employeeId fromDate toDate leaveTypeCode isPaid")
        .lean(),
      Attendance.find({
        employeeId: { $in: employeeIds },
        date: {
          $gte: `${monthPrefix}-01`,
          $lte: `${monthPrefix}-31`,
        },
      })
        .select("employeeId date checkIn status")
        .lean(),
      OfferLetter && employeeEmails.length > 0
        ? OfferLetter.find({
            "candidate.email": { $in: employeeEmails },
            status: "ACCEPTED",
            monthlySalary: { $gt: 0 },
          })
            .select("candidate.email monthlySalary")
            .lean()
        : Promise.resolve([]),
    ]);

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

    const leaveInfoByEmpAndDate = buildLeaveInfoByEmpAndDate(leavesByEmp, calendarDayTypes);

    const attendanceByEmpAndDate = new Map();
    const employeesWithAttendance = buildEmployeesWithAttendanceSet(attendances);
    for (const a of attendances) {
      const empIdStr = String(a.employeeId);
      attendanceByEmpAndDate.set(`${empIdStr}_${a.date}`, a);
    }

    const offerSalaryByEmail = buildOfferSalaryByEmailMap(acceptedOffers);

    const batchResult = processEmployeeBatchRecords({
      activeEmployees,
      compMap,
      leaveInfoByEmpAndDate,
      attendanceByEmpAndDate,
      employeesWithAttendance,
      offerSalaryByEmail,
      calendarDayTypes,
      policy,
      periodEndDate,
      periodStartDate,
      daysInMonth,
      totalWorkingDays,
      totalWeekendDays,
      totalHolidayDays,
      month,
      year,
      monthStr,
      currencyCode,
      currencySymbol,
      deductLopForUnpaidLeave,
    });

    for (const rec of batchResult.employeeRecords) {
      employeeRecords.push(rec);
    }
    for (const issue of batchResult.validationIssues) {
      validationIssues.push(issue);
    }
    cycleTotalGross += batchResult.batchGross;
    cycleTotalDeductions += batchResult.batchDeductions;
    cycleTotalEmployerContributions += batchResult.batchEmployer;
    cycleTotalNetPay += batchResult.batchNet;

    // Batch-local maps/arrays go out of scope here (eligible for GC).
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

import { USER_ROLES } from "../models/User.js";
import { getCompanyBusinessDate } from "../services/attendanceService.js";
import {
  applyLegacyAttendanceLogFallback,
  buildCompanyAssetsSummary,
  buildCompensationMap,
  buildWorkforcePayrollAndProjects,
  countPresentAndLateFromAttendance,
  loadDashboardEmployeeFacts,
} from "../services/adminDashboardMetrics.js";
import { addCivilDays, parseCivilDate, formatCivilDate, weekdaySunday0 } from "../utils/companyTime.js";
import {
  filterPayslipsByScope,
  hasHrPermission,
  mergeEmployeeIdScopeFilter,
  mergeEmployeeScopeFilter,
  shapePayrollCycleForHrAccess,
} from "../services/hrAccessEnforcementService.js";
import { HR_SCOPE_MODES } from "../constants/hrAccessCatalog.js";

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function getTimeInTimezone(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return formatter.format(new Date(date));
  } catch {
    const d = new Date(date);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

function toDateString(date) {
  if (!date) return "";
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
    return date.trim().slice(0, 10);
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the dashboard focus date used by summary cards and attendance trends.
 * Explicit ?date= wins. Otherwise clamp to the selected month/year so browsing a
 * past month ends the 7D/30D series on that month's last day (not wall-clock today).
 */
function resolveDashboardTargetDate(query, todayStr) {
  if (query?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(query.date))) {
    return String(query.date);
  }
  const year = parseInt(query?.year, 10);
  const month = parseInt(query?.month, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return todayStr;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = formatCivilDate(year, month, 1);
  const monthEnd = formatCivilDate(year, month, daysInMonth);
  if (todayStr < monthStart) return monthStart;
  if (todayStr > monthEnd) return monthEnd;
  return todayStr;
}

/**
 * Aggregate one civil day's attendance counts from preloaded maps.
 * Used for the month calendar and for rolling 7D/30D trend series that may
 * cross month boundaries (the previous bug returned zeros for those days).
 */
function buildAttendanceDayStats({
  dateStr,
  todayStr,
  targetDate,
  activeCount,
  weekendRules,
  holidayDateMap,
  attendanceByDateMap,
  leaveCountByDate,
  companyTimezone,
  lateThresholdMinutes,
}) {
  const parts = parseCivilDate(dateStr);
  const dayOfWeek = parts
    ? weekdaySunday0(parts.year, parts.month, parts.day)
    : new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  const isToday = dateStr === targetDate;
  const isFuture = dateStr > todayStr;

  let isWeekend = false;
  if (dayOfWeek === 0 && weekendRules.sundayOff) isWeekend = true;
  else if (dayOfWeek === 6 && weekendRules.saturdayOff) isWeekend = true;

  const holidayName = holidayDateMap.get(dateStr) || null;
  const isHoliday = Boolean(holidayName);

  const dayRecords = attendanceByDateMap.get(dateStr) || [];
  let dayPresent = 0;
  let dayLate = 0;
  for (const rec of dayRecords) {
    if (rec.checkIn || rec.status === "PRESENT" || rec.status === "CHECKED_IN" || rec.status === "CHECKED_OUT") {
      dayPresent++;
      if (rec.checkIn) {
        const localCheckIn = getTimeInTimezone(rec.checkIn, companyTimezone);
        const m = parseTimeToMinutes(localCheckIn);
        if (m !== null && m > lateThresholdMinutes) dayLate++;
      }
    }
  }

  const dayLeaveCount = leaveCountByDate.get(dateStr)?.size || 0;
  const dayAbsent =
    !isFuture && !isWeekend && !isHoliday
      ? Math.max(0, activeCount - dayPresent - dayLeaveCount)
      : 0;

  return {
    day: parts?.day || Number(dateStr.slice(8, 10)),
    date: dateStr,
    dayOfWeek,
    isToday,
    isFuture,
    isWeekend,
    isHoliday,
    holidayName,
    presentCount: dayPresent,
    absentCount: dayAbsent,
    lateCount: dayLate,
    leaveCount: dayLeaveCount,
  };
}

export async function getAdminOverview(req, res, next) {
  try {
    const { User, Employee } = req.auth.models;
    const hrAdminCount = await User.countDocuments({ role: USER_ROLES.HR_ADMIN });

    // Employee operational visibility follows HR scope (User counts alone can overstate).
    let employeeCount;
    if (Employee) {
      employeeCount = await Employee.countDocuments(
        mergeEmployeeScopeFilter(req.hrAccess, { status: "ACTIVE" })
      );
    } else {
      employeeCount = await User.countDocuments({ role: USER_ROLES.EMPLOYEE });
    }

    res.json({
      companyName: req.auth.company.companyName,
      slug: req.auth.company.slug,
      hrAdminCount,
      employeeCount,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/dashboard
 * Aggregates all live dashboard metrics for the authenticated company's HR Admin workspace.
 * Accepts query params: ?date=YYYY-MM-DD&month=1..12&year=YYYY&department=ALL
 */
export async function getAdminDashboard(req, res, next) {
  try {
    const {
      Employee,
      Attendance,
      LeaveRequest,
      OfferLetter,
      EmployeeCompensation,
      CompanyHrPolicy,
      PayrollCycle,
      Payslip,
    } = req.auth.models;

    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);
    const targetDate = resolveDashboardTargetDate(req.query, todayStr);

    const [tYearStr, tMonthStr, tDayStr] = targetDate.split("-");
    const targetYear = parseInt(req.query.year || tYearStr, 10);
    const targetMonth = parseInt(req.query.month || tMonthStr, 10);
    const departmentFilter = req.query.department || "ALL";
    const isCustomHr =
      req.hrAccess?.enforced &&
      req.auth?.user?.role === USER_ROLES.HR_ADMIN &&
      req.hrAccess.configured &&
      req.hrAccess.scopeMode === HR_SCOPE_MODES.CUSTOM;
    const hiringVisible = hasHrPermission(req.hrAccess, "hiring.view");
    const payrollVisible = hasHrPermission(req.hrAccess, "payroll.view");
    const leaveVisible = hasHrPermission(req.hrAccess, "leave.view");
    const attendanceVisible = hasHrPermission(req.hrAccess, "attendance.view");

    // 1. Fetch active HR Policy for attendance & payroll rules
    const targetDateObj = new Date(`${targetDate}T23:59:59.999Z`);
    let activePolicy = null;
    if (CompanyHrPolicy) {
      activePolicy = await CompanyHrPolicy.findOne({
        effectiveFromDate: { $lte: targetDateObj },
      })
        .sort({ effectiveFromDate: -1 })
        .lean();

      if (!activePolicy) {
        activePolicy = await CompanyHrPolicy.findOne({})
          .sort({ effectiveFromDate: -1 })
          .lean();
      }
    }

    const officeStartTime = activePolicy?.attendanceRules?.officeStartTime || "09:30";
    const gracePeriodMinutes = activePolicy?.attendanceRules?.gracePeriodMinutes ?? 15;
    const startMinutes = parseTimeToMinutes(officeStartTime) ?? 570; // 09:30
    const lateThresholdMinutes = startMinutes + gracePeriodMinutes;

    const currencySymbol = activePolicy?.payrollRules?.currencySymbol || "₹";
    const weekendRules = activePolicy?.weekendRules || {
      saturdayOff: true,
      sundayOff: true,
      alternateSaturdaysOff: false,
    };
    const policyHolidays = activePolicy?.holidays || [];

    // 2. Fetch Active Employees (and collect all departments for dropdown)
    // Apply HR employee scope before aggregates so limited HR cannot see company-wide metrics.
    const empBaseFilter = mergeEmployeeScopeFilter(req.hrAccess, { status: "ACTIVE" });
    const empQueryFilter = { ...empBaseFilter };
    if (departmentFilter && departmentFilter !== "ALL") {
      // Preserve existing department filter while keeping scope ($and when needed)
      const deptClause = { "job.department": departmentFilter };
      if (empQueryFilter.$and) {
        empQueryFilter.$and = [...empQueryFilter.$and, deptClause];
      } else if (empQueryFilter.$or || Object.keys(empQueryFilter).some((k) => k !== "status")) {
        const { status, ...rest } = empQueryFilter;
        Object.keys(rest).forEach((k) => delete empQueryFilter[k]);
        empQueryFilter.status = status || "ACTIVE";
        empQueryFilter.$and = [rest, deptClause];
      } else {
        empQueryFilter["job.department"] = departmentFilter;
      }
    }

    // F37: lean employee facts only (no roster PII / attendanceLogs / avatars).
    const [activeEmployees, allDistinctDepartments] = await Promise.all([
      loadDashboardEmployeeFacts(Employee, empQueryFilter),
      Employee.distinct("job.department", empBaseFilter),
    ]);

    const activeEmployeeIds = activeEmployees.map((e) => e._id);
    const activeCount = activeEmployees.length;

    // 3. Attendance for targetDate — count from Attendance rows, not by walking every employee.
    const attendanceRecordsToday = await Attendance.find({
      date: targetDate,
      employeeId: { $in: activeEmployeeIds },
    })
      .select("employeeId checkIn status")
      .lean();

    const attendanceCounted = countPresentAndLateFromAttendance({
      attendanceRecords: attendanceRecordsToday,
      companyTimezone,
      lateThresholdMinutes,
      getTimeInTimezone,
      parseTimeToMinutes,
    });
    let todayPresent = attendanceCounted.todayPresent;
    let todayLate = attendanceCounted.todayLate;
    const presentIds = attendanceCounted.presentIds;

    const missingAttendanceIds = activeEmployeeIds.filter((id) => !presentIds.has(String(id)));
    if (missingAttendanceIds.length > 0) {
      const legacy = await applyLegacyAttendanceLogFallback({
        Employee,
        candidateEmployeeIds: missingAttendanceIds,
        targetDate,
        lateThresholdMinutes,
        parseTimeToMinutes,
        presentIds,
      });
      todayPresent += legacy.todayPresent;
      todayLate += legacy.todayLate;
    }

    // 4. On Leave Today
    const targetDateStart = new Date(`${targetDate}T00:00:00.000Z`);
    const targetDateEnd = new Date(`${targetDate}T23:59:59.999Z`);

    const leavesToday = await LeaveRequest.find({
      employeeId: { $in: activeEmployeeIds },
      status: "APPROVED",
      fromDate: { $lte: targetDateEnd },
      toDate: { $gte: targetDateStart },
    })
      .select("employeeId")
      .lean();

    const onLeaveEmployeeIds = new Set(leavesToday.map((l) => String(l.employeeId)));
    const onLeaveCount = onLeaveEmployeeIds.size;

    // 5. Today Absent
    const todayAbsent = Math.max(0, activeCount - todayPresent - onLeaveCount);

    // 6. Monthly Payroll Calculation (latest revision for active employees)
    const compensationRecords = await EmployeeCompensation.find({
      employeeId: { $in: activeEmployeeIds },
    })
      .select("employeeId revisions")
      .lean();
    const compMap = buildCompensationMap(compensationRecords, targetDateEnd);
    const {
      totalMonthlyPayroll,
      payrollAllocation,
      workforceDepartments,
      projectTeams,
    } = buildWorkforcePayrollAndProjects(activeEmployees, compMap);

    // 7. Recruitment Funnel (from OfferLetter)
    let recruitmentFunnel = {
      offersGenerated: 0,
      accepted: 0,
      acceptedPct: 0,
      pending: 0,
      pendingPct: 0,
      declined: 0,
      declinedPct: 0,
      draft: 0,
      acceptanceRate: "0.0",
    };

    if (OfferLetter && hiringVisible) {
      const offerCounts = await OfferLetter.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);
      const countByStatus = Object.fromEntries(
        offerCounts.map((row) => [row._id || "UNKNOWN", row.count])
      );
      const totalOffers = offerCounts.reduce((sum, row) => sum + row.count, 0);
      const acceptedCount = countByStatus.ACCEPTED || 0;
      const pendingCount = countByStatus.SENT || 0;
      const declinedCount = countByStatus.REJECTED || 0;
      const draftCount = countByStatus.DRAFT || 0;
      const decidedCount = acceptedCount + declinedCount;

      recruitmentFunnel = {
        offersGenerated: totalOffers,
        accepted: acceptedCount,
        acceptedPct: totalOffers > 0 ? Math.round((acceptedCount / totalOffers) * 1000) / 10 : 0,
        pending: pendingCount,
        pendingPct: totalOffers > 0 ? Math.round((pendingCount / totalOffers) * 1000) / 10 : 0,
        declined: declinedCount,
        declinedPct: totalOffers > 0 ? Math.round((declinedCount / totalOffers) * 1000) / 10 : 0,
        draft: draftCount,
        acceptanceRate: decidedCount > 0
          ? ((acceptedCount / decidedCount) * 100).toFixed(1)
          : (totalOffers > 0 ? ((acceptedCount / totalOffers) * 100).toFixed(1) : "0.0"),
      };
    }

    // 8. Attendance Calendar for targetYear & targetMonth (+ 30-day lookback for trends)
    const monthStr = String(targetMonth).padStart(2, "0");
    const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const firstDayWeekday = new Date(Date.UTC(targetYear, targetMonth - 1, 1)).getUTCDay(); // 0 = Sun
    const monthPrefix = `${targetYear}-${monthStr}`;
    const monthStartStr = `${monthPrefix}-01`;
    const monthEndStr = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;
    const monthStart = new Date(`${monthStartStr}T00:00:00.000Z`);
    const monthEnd = new Date(`${monthEndStr}T23:59:59.999Z`);

    const targetCivilForRange = parseCivilDate(targetDate);
    const lookbackCivil = addCivilDays(
      targetCivilForRange.year,
      targetCivilForRange.month,
      targetCivilForRange.day,
      -29
    );
    const lookbackStr = formatCivilDate(lookbackCivil.year, lookbackCivil.month, lookbackCivil.day);
    const attendanceRangeStart = lookbackStr < monthStartStr ? lookbackStr : monthStartStr;
    const attendanceRangeEnd = monthEndStr > targetDate ? monthEndStr : targetDate;

    const rangeStartDate = new Date(`${attendanceRangeStart}T00:00:00.000Z`);
    const rangeEndDate = new Date(`${attendanceRangeEnd}T23:59:59.999Z`);

    const [monthAttendanceRecords, monthLeaves] = await Promise.all([
      Attendance.find({
        date: {
          $gte: attendanceRangeStart,
          $lte: attendanceRangeEnd,
        },
        employeeId: { $in: activeEmployeeIds },
      })
        .select("date employeeId checkIn status")
        .lean(),
      LeaveRequest.find({
        employeeId: { $in: activeEmployeeIds },
        status: "APPROVED",
        fromDate: { $lte: rangeEndDate },
        toDate: { $gte: rangeStartDate },
      })
        .select("employeeId fromDate toDate")
        .lean(),
    ]);

    const attendanceByDateMap = new Map();
    for (const record of monthAttendanceRecords) {
      if (!attendanceByDateMap.has(record.date)) {
        attendanceByDateMap.set(record.date, []);
      }
      attendanceByDateMap.get(record.date).push(record);
    }

    // Precompute leave counts per day across the full queried range (may cross months)
    const leaveCountByDate = new Map();
    for (const leave of monthLeaves) {
      const fStr = toDateString(leave.fromDate);
      const tStr = toDateString(leave.toDate);
      if (!fStr || !tStr) continue;
      const start = fStr < attendanceRangeStart ? attendanceRangeStart : fStr;
      const end = tStr > attendanceRangeEnd ? attendanceRangeEnd : tStr;
      const startParts = parseCivilDate(start);
      const endParts = parseCivilDate(end);
      if (!startParts || !endParts) continue;
      let cursor = { ...startParts };
      while (formatCivilDate(cursor.year, cursor.month, cursor.day) <= end) {
        const dateStr = formatCivilDate(cursor.year, cursor.month, cursor.day);
        if (!leaveCountByDate.has(dateStr)) leaveCountByDate.set(dateStr, new Set());
        leaveCountByDate.get(dateStr).add(String(leave.employeeId));
        cursor = addCivilDays(cursor.year, cursor.month, cursor.day, 1);
      }
    }

    // Holiday map for the full queried range (not only selected month)
    const holidayDateMap = new Map();
    for (const h of policyHolidays) {
      if (h.date) {
        const dStr = toDateString(h.date);
        if (dStr >= attendanceRangeStart && dStr <= attendanceRangeEnd) {
          holidayDateMap.set(dStr, h.name || "Holiday");
        }
      }
    }

    const dayStatsArgs = {
      todayStr,
      targetDate,
      activeCount,
      weekendRules,
      holidayDateMap,
      attendanceByDateMap,
      leaveCountByDate,
      companyTimezone,
      lateThresholdMinutes,
    };

    const calendarDays = [];
    let monthTotalPresentDays = 0;
    let monthTotalAbsentDays = 0;
    let monthTotalLateDays = 0;
    let monthTotalLeaveDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${targetYear}-${monthStr}-${String(day).padStart(2, "0")}`;
      const stats = buildAttendanceDayStats({ ...dayStatsArgs, dateStr });
      if (!stats.isFuture && !stats.isWeekend && !stats.isHoliday) {
        monthTotalPresentDays += stats.presentCount;
        monthTotalAbsentDays += stats.absentCount;
        monthTotalLateDays += stats.lateCount;
        monthTotalLeaveDays += stats.leaveCount;
      }
      calendarDays.push(stats);
    }

    // 9. Recent Leaves (latest 10)
    const recentLeavesDocs = await LeaveRequest.find(mergeEmployeeIdScopeFilter(req.hrAccess, {}))
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("employeeId", "fullName employeeCode email avatar job")
      .lean();

    const recentLeaves = recentLeavesDocs.map((l) => {
      const emp = l.employeeId || {};
      return {
        id: l._id,
        employeeId: emp._id || l.employeeId || null,
        employeeName: emp.fullName || "Team Member",
        employeeCode: emp.employeeCode || "",
        department: emp.job?.department || "",
        avatar: emp.avatar || "",
        leaveType: l.leaveTypeCode || "Leave",
        fromDate: toDateString(l.fromDate),
        toDate: toDateString(l.toDate),
        daysCount: l.daysCount || 1,
        status: l.status || "PENDING",
        reason: l.reason || "",
        createdAt: l.createdAt,
      };
    });

    // 10. Monthly Attendance Mix (Donut)
    const attendanceMix = {
      present: monthTotalPresentDays,
      absent: monthTotalAbsentDays,
      late: monthTotalLateDays,
      leave: monthTotalLeaveDays,
      monthName: new Date(targetYear, targetMonth - 1, 1).toLocaleString("en-US", { month: "long" }),
      year: targetYear,
    };

    // 11. Salary expenses by processed payroll cycles (not projected CTC)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const processedPayrollStatuses = ["FINALIZED", "PARTIALLY_PAID", "PAID"];
    const processedCycles = !isCustomHr && PayrollCycle
      ? await PayrollCycle.find({
          periodYear: targetYear,
          status: { $in: processedPayrollStatuses },
        })
          .select("periodMonth totalNetPayable totalNetSalary status")
          .lean()
      : [];

    const cycleTotalsByMonth = new Map();
    if (isCustomHr && PayrollCycle && Payslip) {
      const cycleDocs = await PayrollCycle.find({
        periodYear: targetYear,
        status: { $in: processedPayrollStatuses },
      })
        .select("_id periodMonth")
        .lean();
      for (const cycle of cycleDocs) {
        const monthNumber = Number(cycle.periodMonth);
        if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) continue;
        const rows = await Payslip.find({
          payrollCycleId: cycle._id,
          employeeId: { $in: activeEmployeeIds },
        })
          .select("employeeId netPayable netSalary")
          .lean();
        const scoped = filterPayslipsByScope(req.hrAccess, rows);
        let add = 0;
        for (const payslip of scoped) {
          add += Number(payslip.netPayable ?? payslip.netSalary ?? 0) || 0;
        }
        cycleTotalsByMonth.set(monthNumber, (cycleTotalsByMonth.get(monthNumber) || 0) + add);
      }
    } else {
      for (const cycle of processedCycles) {
        const monthNumber = Number(cycle.periodMonth);
        if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) continue;
        const amount = Number(cycle.totalNetPayable || cycle.totalNetSalary || 0);
        cycleTotalsByMonth.set(monthNumber, (cycleTotalsByMonth.get(monthNumber) || 0) + (Number.isFinite(amount) ? amount : 0));
      }
    }

    const salaryExpenses = monthNames.map((name, idx) => {
      const monthNumber = idx + 1;
      const hasCycle = cycleTotalsByMonth.has(monthNumber);
      return {
        month: name,
        monthNumber,
        amount: hasCycle ? Number(cycleTotalsByMonth.get(monthNumber) || 0) : 0,
        hasCycle,
      };
    });

    // 12. Attendance Overview trends ending at targetDate (cross-month safe)
    const targetCivil = parseCivilDate(targetDate);
    const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    function buildTrendSeries(dayCount) {
      const series = [];
      for (let i = dayCount - 1; i >= 0; i--) {
        const d = addCivilDays(targetCivil.year, targetCivil.month, targetCivil.day, -i);
        const dateStr = formatCivilDate(d.year, d.month, d.day);
        const stats = buildAttendanceDayStats({ ...dayStatsArgs, dateStr });
        series.push({
          date: dateStr,
          label: `${weekdayNames[stats.dayOfWeek]} ${stats.day}`,
          dayOfWeek: stats.dayOfWeek,
          isToday: stats.isToday,
          isWeekend: stats.isWeekend,
          isHoliday: stats.isHoliday,
          isFuture: stats.isFuture,
          present: stats.presentCount,
          presentCount: stats.presentCount,
          absent: stats.absentCount,
          absentCount: stats.absentCount,
          late: stats.lateCount,
          lateCount: stats.lateCount,
          onLeave: stats.leaveCount,
          leaveCount: stats.leaveCount,
        });
      }
      return series;
    }

    const weeklyOverview = buildTrendSeries(7);
    const thirtyDayOverview = buildTrendSeries(30);

    // 13. Company Assets (assignments collection + lean legacy assignedAssets on facts)
    const assignedEmpIds = new Set();
    if (req.auth.models.CompanyAsset) {
      const activeAssignments = await req.auth.models.CompanyAsset.find(
        {
          status: "ASSIGNED",
          "currentAssignment.employeeId": { $in: activeEmployeeIds },
        },
        "currentAssignment.employeeId"
      ).lean();
      for (const a of activeAssignments) {
        if (a.currentAssignment?.employeeId) {
          assignedEmpIds.add(String(a.currentAssignment.employeeId));
        }
      }
    }
    const companyAssets = buildCompanyAssetsSummary(activeEmployees, assignedEmpIds);

    // 14–15. Payroll allocation, workforce departments, project teams — from lean facts (F37)

    // 16. Real Payroll Cycle Summary & Payroll Action Centre
    let payrollCycleSummary = {
      status: "NOT_STARTED",
      statusLabel: "Not Started",
      periodMonth: targetMonth,
      periodYear: targetYear,
      isFinalized: false,
      totalNetSalary: 0,
      totalGrossSalary: 0,
      totalPaidAmount: 0,
      paymentStatus: "UNPAID",
      exists: false,
      cycleId: null,
      employeeCount: 0,
      eligibleEmployeeCount: activeCount,
      employeesAwaitingProcessing: activeCount,
      pendingAction: "Initialize payroll register for this cycle",
      isPaymentPending: false,
      pendingPaymentAmount: 0,
      paidEmployeesCount: 0,
      totalEmployeesCount: 0,
    };

    let lastCompletedCycle = null;

    if (PayrollCycle) {
      let cycle = await PayrollCycle.findOne({
        periodMonth: targetMonth,
        periodYear: targetYear,
      }).lean();

      if (!cycle) {
        cycle = await PayrollCycle.findOne({})
          .sort({ periodYear: -1, periodMonth: -1 })
          .lean();
      }

      // Query the last genuinely completed cycle (PAID)
      const lastCompletedDoc = await PayrollCycle.findOne({
        status: "PAID",
      })
        .sort({ periodYear: -1, periodMonth: -1 })
        .lean();

      if (lastCompletedDoc) {
        const lastPaidPayments = lastCompletedDoc.payments || [];
        const lastPaymentRecord = lastPaidPayments[lastPaidPayments.length - 1];
        lastCompletedCycle = {
          periodMonth: lastCompletedDoc.periodMonth,
          periodYear: lastCompletedDoc.periodYear,
          totalNetSalary: lastCompletedDoc.totalNetPayable || lastCompletedDoc.totalNetSalary || 0,
          totalPaidAmount: lastCompletedDoc.totalPaidAmount || 0,
          employeeCount: lastCompletedDoc.employeeCount || 0,
          paymentDate: lastPaymentRecord?.paymentDate ? toDateString(lastPaymentRecord.paymentDate) : null,
          paymentMethod: lastPaymentRecord?.paymentMethod || "Direct Deposit",
        };
      }

      if (cycle) {
        const statusMap = {
          DRAFT: "Draft",
          CALCULATED: "Calculated",
          FINALIZED: "Finalized",
          PARTIALLY_PAID: "Partially Paid",
          PAID: "Paid",
          CANCELLED: "Cancelled",
        };

        const totalNet = cycle.totalNetPayable || cycle.totalNetSalary || 0;
        const totalGross = cycle.totalGrossEarnings || cycle.totalGrossSalary || 0;
        const totalPaid = cycle.totalPaidAmount || 0;
        const cycleEmpCount = cycle.employeeCount || (Array.isArray(cycle.employees) ? cycle.employees.length : 0);
        const awaitingCount = Math.max(0, activeCount - cycleEmpCount);

        let pendingAction = "All actions complete";
        let isPaymentPending = false;
        let pendingPaymentAmount = 0;

        if (cycle.status === "DRAFT") {
          pendingAction = "Calculate draft payslips and apply attendance deductions";
        } else if (cycle.status === "CALCULATED") {
          pendingAction = "Review salary register and finalize payroll cycle";
        } else if (cycle.status === "FINALIZED") {
          pendingAction = "Record payouts and salary disbursements";
          isPaymentPending = true;
          pendingPaymentAmount = Math.max(0, totalNet - totalPaid);
        } else if (cycle.status === "PARTIALLY_PAID") {
          pendingAction = "Complete remaining employee disbursements";
          isPaymentPending = true;
          pendingPaymentAmount = Math.max(0, totalNet - totalPaid);
        } else if (cycle.status === "PAID") {
          pendingAction = "All salary disbursements recorded for this cycle";
        }

        const paidCount = cycle.employees?.filter((e) => e.paymentStatus === "PAID").length || 0;
        const totalEmployeesCount = cycle.employees?.length || cycleEmpCount;

        payrollCycleSummary = {
          status: cycle.status || "DRAFT",
          statusLabel: statusMap[cycle.status] || cycle.status || "Draft",
          periodMonth: cycle.periodMonth,
          periodYear: cycle.periodYear,
          isFinalized: Boolean(cycle.isFinalized),
          totalNetSalary: totalNet,
          totalGrossSalary: totalGross,
          totalPaidAmount: totalPaid,
          paymentStatus: cycle.paymentStatus || (cycle.status === "PAID" ? "PAID" : "UNPAID"),
          exists: true,
          cycleId: String(cycle._id),
          employeeCount: cycleEmpCount,
          eligibleEmployeeCount: activeCount,
          employeesAwaitingProcessing: awaitingCount,
          pendingAction,
          isPaymentPending,
          pendingPaymentAmount,
          paidEmployeesCount: paidCount,
          totalEmployeesCount,
        };
      }

      // CUSTOM-scoped HR: never expose company-wide payroll salary totals / counts
      const hrAccess = req.hrAccess;
      if (isCustomHr) {
        async function scopedPayslipsForCycle(cycleDoc) {
          if (!cycleDoc?._id || !Payslip) return [];
          // F37: scope payslips to dashboard employee ids before in-memory HR filter.
          const rows = await Payslip.find({
            payrollCycleId: cycleDoc._id,
            employeeId: { $in: activeEmployeeIds },
          }).lean();
          return filterPayslipsByScope(hrAccess, rows);
        }

        if (cycle && payrollCycleSummary.exists) {
          const scopedPayslips = await scopedPayslipsForCycle(cycle);
          const shaped = shapePayrollCycleForHrAccess(hrAccess, cycle, scopedPayslips);
          const scopedPaidCount = scopedPayslips.filter(
            (p) => String(p.paymentStatus || "").toUpperCase() === "PAID"
          ).length;
          const scopedEmpCount = shaped.employeeCount ?? scopedPayslips.length;
          const scopedNet = shaped.totalNetPayable ?? shaped.totalNetSalary;
          const scopedGross = shaped.totalGrossEarnings;
          payrollCycleSummary = {
            ...payrollCycleSummary,
            totalNetSalary: scopedNet,
            totalGrossSalary: scopedGross,
            totalPaidAmount: null,
            employeeCount: scopedEmpCount,
            eligibleEmployeeCount: activeCount,
            employeesAwaitingProcessing: Math.max(0, activeCount - scopedEmpCount),
            pendingPaymentAmount:
              payrollCycleSummary.isPaymentPending && scopedNet != null
                ? Math.max(0, Number(scopedNet) || 0)
                : payrollCycleSummary.isPaymentPending
                  ? null
                  : 0,
            paidEmployeesCount: scopedPaidCount,
            totalEmployeesCount: scopedEmpCount,
            _aggregatesRestricted: true,
          };
        }

        if (lastCompletedCycle && lastCompletedDoc) {
          const scopedPaidPayslips = await scopedPayslipsForCycle(lastCompletedDoc);
          const shapedLast = shapePayrollCycleForHrAccess(
            hrAccess,
            lastCompletedDoc,
            scopedPaidPayslips
          );
          lastCompletedCycle = {
            ...lastCompletedCycle,
            totalNetSalary: shapedLast.totalNetPayable ?? shapedLast.totalNetSalary,
            totalPaidAmount: null,
            employeeCount: shapedLast.employeeCount ?? scopedPaidPayslips.length,
            _aggregatesRestricted: true,
          };
        }
      } else if (
        hrAccess?.enforced &&
        req.auth?.user?.role === USER_ROLES.HR_ADMIN &&
        !hrAccess.configured
      ) {
        // Fail closed: redact salary aggregates when access is not configured
        if (payrollCycleSummary.exists) {
          payrollCycleSummary = {
            ...payrollCycleSummary,
            totalNetSalary: null,
            totalGrossSalary: null,
            totalPaidAmount: null,
            employeeCount: 0,
            eligibleEmployeeCount: 0,
            employeesAwaitingProcessing: 0,
            pendingPaymentAmount: null,
            paidEmployeesCount: 0,
            totalEmployeesCount: 0,
            _aggregatesRestricted: true,
          };
        }
        if (lastCompletedCycle) {
          lastCompletedCycle = {
            ...lastCompletedCycle,
            totalNetSalary: null,
            totalPaidAmount: null,
            employeeCount: 0,
            _aggregatesRestricted: true,
          };
        }
      }
    }

    const payrollActionCentre = {
      currentCycle: payrollCycleSummary,
      lastCompletedCycle,
      hasPendingAction: payrollCycleSummary.status !== "PAID" && payrollCycleSummary.status !== "CANCELLED",
      pendingAction: payrollCycleSummary.pendingAction,
      isPaymentPending: payrollCycleSummary.isPaymentPending,
      pendingPaymentAmount: payrollCycleSummary.pendingPaymentAmount,
      employeesAwaitingProcessing: payrollCycleSummary.employeesAwaitingProcessing,
    };

    // 17. Recent Offer Letters (latest 5)
    let recentOffers = [];
    if (OfferLetter && hiringVisible) {
      const recentOfferDocs = await OfferLetter.find({})
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(5)
        .lean();
      recentOffers = recentOfferDocs.map((o) => ({
        id: o._id,
        candidateName: hiringVisible ? o.candidate?.fullName || "Candidate" : null,
        candidateEmail: hiringVisible ? o.candidate?.email || "" : null,
        position: o.position || "Role",
        department: o.department || "",
        status: o.status || "DRAFT",
        monthlySalary: hiringVisible ? o.monthlySalary || 0 : null,
        updatedAt: o.updatedAt || o.createdAt,
      }));
    }
    if (!hiringVisible) {
      recruitmentFunnel = { restricted: true };
    }

    // 18. Upcoming Holidays (next 5 from today onwards)
    const upcomingHolidays = (policyHolidays || [])
      .filter((h) => h.date && toDateString(h.date) >= todayStr)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5)
      .map((h) => ({
        name: h.name || "Holiday",
        date: toDateString(h.date),
        isPaid: Boolean(h.isPaid),
      }));

    const [pendingLeaveRequests, monthlyExits] = await Promise.all([
      LeaveRequest.countDocuments(
        mergeEmployeeIdScopeFilter(req.hrAccess, { status: "PENDING" })
      ),
      Employee.countDocuments(
        mergeEmployeeScopeFilter(req.hrAccess, {
          status: { $ne: "ACTIVE" },
          updatedAt: { $gte: monthStart, $lte: monthEnd },
        })
      ),
    ]);

    // 19. Assemble Final Dashboard Payload
    res.status(200).json({
      success: true,
      meta: {
        companyName: req.auth.company.companyName,
        timezone: companyTimezone,
        todayDate: todayStr,
        selectedDate: targetDate,
        selectedMonth: targetMonth,
        selectedYear: targetYear,
        monthName: new Date(targetYear, targetMonth - 1, 1).toLocaleString("en-US", { month: "long" }),
        currencySymbol,
        activeDepartment: departmentFilter,
        departments: allDistinctDepartments.filter(Boolean),
        officeStartTime,
        gracePeriodMinutes,
      },
      summary: {
        activeEmployees: activeCount,
        todayPresent: attendanceVisible ? todayPresent : null,
        todayAbsent: attendanceVisible ? todayAbsent : null,
        todayLate: attendanceVisible ? todayLate : null,
        onLeave: leaveVisible ? onLeaveCount : null,
        monthlyPayroll: payrollVisible ? totalMonthlyPayroll : null,
        isPayrollEstimate: payrollVisible ? true : null,
        payrollStatus: payrollVisible ? payrollCycleSummary.statusLabel : null,
        payrollCycle: payrollVisible ? payrollCycleSummary : { restricted: true },
        pendingLeaveRequests: leaveVisible ? pendingLeaveRequests : null,
        pendingOfferResponses: hiringVisible ? recruitmentFunnel.pending || 0 : null,
        monthlyExits,
      },
      insightMetrics: {
        lateArrivalsToday: attendanceVisible ? todayLate : null,
        pendingLeaveRequests: leaveVisible ? pendingLeaveRequests : null,
        pendingOfferResponses: hiringVisible ? recruitmentFunnel.pending || 0 : null,
        monthlyExits,
      },
      payrollCycleSummary: payrollVisible ? payrollCycleSummary : { restricted: true },
      payrollActionCentre: payrollVisible ? payrollActionCentre : { restricted: true },
      lastCompletedCycle: payrollVisible ? lastCompletedCycle : null,
      recruitmentFunnel,
      attendanceCalendar: attendanceVisible
        ? {
            month: targetMonth,
            year: targetYear,
            firstDayWeekday,
            daysInMonth,
            days: calendarDays,
          }
        : { restricted: true },
      recentLeaves: leaveVisible ? recentLeaves : { restricted: true },
      recentOffers,
      upcomingHolidays,
      monthlyAttendanceMix: attendanceVisible
        ? leaveVisible
          ? attendanceMix
          : { ...attendanceMix, leave: null }
        : { restricted: true },
      salaryExpenses: payrollVisible
        ? {
            year: targetYear,
            currencySymbol,
            months: salaryExpenses,
          }
        : { restricted: true },
      attendanceOverview: attendanceVisible
        ? {
            period: "This Week",
            endDate: targetDate,
            days: weeklyOverview,
            week: weeklyOverview,
            thirtyDays: thirtyDayOverview,
            activeEmployees: activeCount,
          }
        : { restricted: true },
      companyAssets,
      workforce: {
        departments: workforceDepartments,
      },
      payrollAllocation: payrollVisible
        ? {
            totalMonthly: totalMonthlyPayroll,
            departments: payrollAllocation,
          }
        : { restricted: true },
      projectTeams,
    });
  } catch (error) {
    next(error);
  }
}

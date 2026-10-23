import { USER_ROLES } from "../models/User.js";
import { getCompanyBusinessDate } from "../services/attendanceService.js";

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
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getAdminOverview(req, res, next) {
  try {
    const { User } = req.auth.models;
    const [hrAdminCount, employeeCount] = await Promise.all([
      User.countDocuments({ role: USER_ROLES.HR_ADMIN }),
      User.countDocuments({ role: USER_ROLES.EMPLOYEE }),
    ]);

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
    } = req.auth.models;

    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);
    const targetDate = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayStr;

    const [tYearStr, tMonthStr, tDayStr] = targetDate.split("-");
    const targetYear = parseInt(req.query.year || tYearStr, 10);
    const targetMonth = parseInt(req.query.month || tMonthStr, 10);
    const departmentFilter = req.query.department || "ALL";

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
    const empBaseFilter = { status: "ACTIVE" };
    const empQueryFilter = { ...empBaseFilter };
    if (departmentFilter && departmentFilter !== "ALL") {
      empQueryFilter["job.department"] = departmentFilter;
    }

    const [activeEmployees, allDistinctDepartments] = await Promise.all([
      Employee.find(empQueryFilter)
        .select("_id employeeCode fullName email job avatar status customFields dateOfBirth")
        .lean(),
      Employee.distinct("job.department", empBaseFilter),
    ]);

    const activeEmployeeIds = activeEmployees.map((e) => e._id);
    const activeCount = activeEmployees.length;

    // 3. Attendance for targetDate
    const attendanceRecordsToday = await Attendance.find({
      date: targetDate,
      employeeId: { $in: activeEmployeeIds },
    }).lean();

    const attendanceMapToday = new Map();
    for (const att of attendanceRecordsToday) {
      attendanceMapToday.set(String(att.employeeId), att);
    }

    let todayPresent = 0;
    let todayLate = 0;

    for (const emp of activeEmployees) {
      const empIdStr = String(emp._id);
      const att = attendanceMapToday.get(empIdStr);
      if (att) {
        if (att.checkIn || att.status === "CHECKED_IN" || att.status === "CHECKED_OUT" || att.status === "PRESENT") {
          todayPresent++;
          if (att.checkIn) {
            const checkInLocalTime = getTimeInTimezone(att.checkIn, companyTimezone);
            const checkInMins = parseTimeToMinutes(checkInLocalTime);
            if (checkInMins !== null && checkInMins > lateThresholdMinutes) {
              todayLate++;
            }
          }
        }
      } else {
        // Fallback to legacy customFields if present
        const legacyLogs = emp.customFields?.attendanceLogs || [];
        const todayLog = legacyLogs.find((l) => l.date === targetDate);
        if (todayLog && (todayLog.checkIn || todayLog.status === "PRESENT")) {
          todayPresent++;
          if (todayLog.checkIn) {
            const checkInMins = parseTimeToMinutes(todayLog.checkIn);
            if (checkInMins !== null && checkInMins > lateThresholdMinutes) {
              todayLate++;
            }
          }
        }
      }
    }

    // 4. On Leave Today
    const targetDateStart = new Date(`${targetDate}T00:00:00.000Z`);
    const targetDateEnd = new Date(`${targetDate}T23:59:59.999Z`);

    const leavesToday = await LeaveRequest.find({
      employeeId: { $in: activeEmployeeIds },
      status: "APPROVED",
      fromDate: { $lte: targetDateEnd },
      toDate: { $gte: targetDateStart },
    }).lean();

    const onLeaveEmployeeIds = new Set(leavesToday.map((l) => String(l.employeeId)));
    const onLeaveCount = onLeaveEmployeeIds.size;

    // 5. Today Absent
    const todayAbsent = Math.max(0, activeCount - todayPresent - onLeaveCount);

    // 6. Monthly Payroll Calculation (latest revision for active employees)
    let totalMonthlyPayroll = 0;
    const compensationRecords = await EmployeeCompensation.find({
      employeeId: { $in: activeEmployeeIds },
    }).lean();

    const compMap = new Map();
    for (const comp of compensationRecords) {
      // Find latest revision effective on or before targetDate
      const revisions = (comp.revisions || []).filter(
        (r) => new Date(r.effectiveFromDate) <= targetDateEnd
      );
      if (revisions.length > 0) {
        revisions.sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));
        const latest = revisions[0];
        const val = parseFloat(String(latest.monthlyCostToCompany || 0));
        if (!isNaN(val)) {
          compMap.set(String(comp.employeeId), val);
        }
      }
    }

    for (const emp of activeEmployees) {
      const empIdStr = String(emp._id);
      const val = compMap.get(empIdStr);
      if (val !== undefined) {
        totalMonthlyPayroll += val;
      } else {
        const customSalary = parseFloat(
          String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0)
        );
        if (!isNaN(customSalary)) {
          totalMonthlyPayroll += customSalary;
        }
      }
    }

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

    if (OfferLetter) {
      const allOffers = await OfferLetter.find({}).lean();
      const totalOffers = allOffers.length;
      const acceptedCount = allOffers.filter((o) => o.status === "ACCEPTED").length;
      const pendingCount = allOffers.filter((o) => o.status === "SENT").length;
      const declinedCount = allOffers.filter((o) => o.status === "REJECTED").length;
      const draftCount = allOffers.filter((o) => o.status === "DRAFT").length;
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

    // 8. Attendance Calendar for targetYear & targetMonth
    const monthStr = String(targetMonth).padStart(2, "0");
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const firstDayWeekday = new Date(targetYear, targetMonth - 1, 1).getDay(); // 0 = Sun
    const monthPrefix = `${targetYear}-${monthStr}`;

    const monthAttendanceRecords = await Attendance.find({
      date: { $regex: `^${monthPrefix}` },
      employeeId: { $in: activeEmployeeIds },
    }).lean();

    const attendanceByDateMap = new Map();
    for (const record of monthAttendanceRecords) {
      if (!attendanceByDateMap.has(record.date)) {
        attendanceByDateMap.set(record.date, []);
      }
      attendanceByDateMap.get(record.date).push(record);
    }

    // Leaves in this month
    const monthStart = new Date(`${monthPrefix}-01T00:00:00.000Z`);
    const monthEnd = new Date(`${monthPrefix}-${String(daysInMonth).padStart(2, "0")}T23:59:59.999Z`);
    const monthLeaves = await LeaveRequest.find({
      employeeId: { $in: activeEmployeeIds },
      status: "APPROVED",
      fromDate: { $lte: monthEnd },
      toDate: { $gte: monthStart },
    }).lean();

    // Holiday map
    const holidayDateMap = new Map();
    for (const h of policyHolidays) {
      if (h.date) {
        const dStr = toDateString(h.date);
        if (dStr.startsWith(monthPrefix)) {
          holidayDateMap.set(dStr, h.name || "Holiday");
        }
      }
    }

    const calendarDays = [];
    let monthTotalPresentDays = 0;
    let monthTotalAbsentDays = 0;
    let monthTotalLateDays = 0;
    let monthTotalLeaveDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${targetYear}-${monthStr}-${String(day).padStart(2, "0")}`;
      const dayDate = new Date(`${dateStr}T12:00:00.000Z`);
      const dayOfWeek = dayDate.getDay();
      const isToday = dateStr === targetDate;
      const isFuture = dateStr > todayStr;

      let isWeekend = false;
      if (dayOfWeek === 0 && weekendRules.sundayOff) {
        isWeekend = true;
      } else if (dayOfWeek === 6 && weekendRules.saturdayOff) {
        isWeekend = true;
      }

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
            if (m !== null && m > lateThresholdMinutes) {
              dayLate++;
            }
          }
        }
      }

      const dayLeaves = monthLeaves.filter((l) => {
        const fStr = toDateString(l.fromDate);
        const tStr = toDateString(l.toDate);
        return dateStr >= fStr && dateStr <= tStr;
      });
      const dayLeaveCount = new Set(dayLeaves.map((l) => String(l.employeeId))).size;
      const dayAbsent = !isFuture && !isWeekend && !isHoliday
        ? Math.max(0, activeCount - dayPresent - dayLeaveCount)
        : 0;

      if (!isFuture && !isWeekend && !isHoliday) {
        monthTotalPresentDays += dayPresent;
        monthTotalAbsentDays += dayAbsent;
        monthTotalLateDays += dayLate;
        monthTotalLeaveDays += dayLeaveCount;
      }

      calendarDays.push({
        day,
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
      });
    }

    // 9. Recent Leaves (latest 10)
    const recentLeavesDocs = await LeaveRequest.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("employeeId", "fullName employeeCode email avatar job")
      .lean();

    const recentLeaves = recentLeavesDocs.map((l) => {
      const emp = l.employeeId || {};
      return {
        id: l._id,
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

    // 11. Salary Expenses over the Year (Jan - Dec)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const salaryExpenses = monthNames.map((name, idx) => {
      const mNum = idx + 1;
      const endOfM = new Date(targetYear, mNum, 0, 23, 59, 59, 999);
      let monthlyTotal = 0;

      for (const emp of activeEmployees) {
        const empIdStr = String(emp._id);
        const comp = compensationRecords.find((c) => String(c.employeeId) === empIdStr);
        if (comp && comp.revisions?.length > 0) {
          const revs = comp.revisions.filter((r) => new Date(r.effectiveFromDate) <= endOfM);
          if (revs.length > 0) {
            revs.sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));
            const val = parseFloat(String(revs[0].monthlyCostToCompany || 0));
            if (!isNaN(val)) monthlyTotal += val;
          }
        } else {
          const sal = parseFloat(String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0));
          if (!isNaN(sal)) monthlyTotal += sal;
        }
      }

      return {
        month: name,
        monthNumber: mNum,
        amount: monthlyTotal,
      };
    });

    // 12. Attendance Overview (Current Week Trend: 7 days ending at targetDate)
    const weeklyOverview = [];
    const targetDt = new Date(`${targetDate}T12:00:00.000Z`);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(targetDt);
      d.setDate(d.getDate() - i);
      const dateStr = toDateString(d);
      const dayLabel = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }); // e.g. "Sat 17"

      const dayCal = calendarDays.find((cd) => cd.date === dateStr);
      if (dayCal) {
        weeklyOverview.push({
          date: dateStr,
          label: dayLabel,
          present: dayCal.presentCount,
          absent: dayCal.absentCount,
          late: dayCal.lateCount,
        });
      } else {
        weeklyOverview.push({
          date: dateStr,
          label: dayLabel,
          present: 0,
          absent: 0,
          late: 0,
        });
      }
    }

    // 13. Company Assets
    let employeesWithAssets = 0;
    const assignedEmpIds = new Set();
    if (req.auth.models.CompanyAsset) {
      const activeAssignments = await req.auth.models.CompanyAsset.find(
        { status: "ASSIGNED", "currentAssignment.employeeId": { $ne: null } },
        "currentAssignment.employeeId"
      ).lean();
      for (const a of activeAssignments) {
        if (a.currentAssignment?.employeeId) {
          assignedEmpIds.add(String(a.currentAssignment.employeeId));
        }
      }
    }

    for (const emp of activeEmployees) {
      const assets = emp.customFields?.assignedAssets;
      const hasLegacy = Array.isArray(assets) && assets.length > 0;
      if (assignedEmpIds.has(String(emp._id)) || hasLegacy) {
        employeesWithAssets++;
      }
    }
    const employeesWithoutAssets = Math.max(0, activeCount - employeesWithAssets);
    const companyAssets = {
      totalEmployees: activeCount,
      employeesWithAssets,
      employeesWithAssetsPct: activeCount > 0 ? Math.round((employeesWithAssets / activeCount) * 100) : 0,
      employeesWithoutAssets,
      employeesWithoutAssetsPct: activeCount > 0 ? Math.round((employeesWithoutAssets / activeCount) * 100) : 0,
    };

    // 14. Payroll Allocation (Department-wise)
    const deptSalaryMap = new Map();
    for (const emp of activeEmployees) {
      const dept = emp.job?.department || "General / Unassigned";
      const empIdStr = String(emp._id);
      const sal = compMap.get(empIdStr) || parseFloat(String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0)) || 0;
      deptSalaryMap.set(dept, (deptSalaryMap.get(dept) || 0) + sal);
    }

    const payrollAllocation = [];
    for (const [department, cost] of deptSalaryMap.entries()) {
      const pct = totalMonthlyPayroll > 0 ? Math.round((cost / totalMonthlyPayroll) * 100) : 0;
      payrollAllocation.push({
        department,
        cost,
        percentage: pct,
      });
    }
    payrollAllocation.sort((a, b) => b.cost - a.cost);

    // 15. Project Teams
    const projectTypeCountMap = {
      MANDATE: 0,
      RETAIL: 0,
      INTERNAL: 0,
      BENCH: 0,
    };
    const projectNameMap = new Map();
    let totalEmployeesWithProjects = 0;

    for (const emp of activeEmployees) {
      const p = emp.job?.project;
      if (p) {
        if (p.projectType && projectTypeCountMap[p.projectType] !== undefined) {
          projectTypeCountMap[p.projectType]++;
          totalEmployeesWithProjects++;
        }
        if (p.projectName && p.projectName.trim()) {
          const pName = p.projectName.trim();
          projectNameMap.set(pName, (projectNameMap.get(pName) || 0) + 1);
        }
      }
    }

    const projectTeams = {
      mandate: {
        count: projectTypeCountMap.MANDATE,
        pct: totalEmployeesWithProjects > 0 ? Math.round((projectTypeCountMap.MANDATE / totalEmployeesWithProjects) * 100) : 0,
      },
      retail: {
        count: projectTypeCountMap.RETAIL,
        pct: totalEmployeesWithProjects > 0 ? Math.round((projectTypeCountMap.RETAIL / totalEmployeesWithProjects) * 100) : 0,
      },
      topStaffed: Array.from(projectNameMap.entries())
        .map(([name, members]) => ({ name, members }))
        .sort((a, b) => b.members - a.members)
        .slice(0, 5),
    };

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
    if (OfferLetter) {
      const recentOfferDocs = await OfferLetter.find({})
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(5)
        .lean();
      recentOffers = recentOfferDocs.map((o) => ({
        id: o._id,
        candidateName: o.candidate?.fullName || "Candidate",
        candidateEmail: o.candidate?.email || "",
        position: o.position || "Role",
        department: o.department || "",
        status: o.status || "DRAFT",
        monthlySalary: o.monthlySalary || 0,
        updatedAt: o.updatedAt || o.createdAt,
      }));
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
        todayPresent,
        todayAbsent,
        todayLate,
        onLeave: onLeaveCount,
        monthlyPayroll: totalMonthlyPayroll,
        isPayrollEstimate: true,
        payrollStatus: payrollCycleSummary.statusLabel,
        payrollCycle: payrollCycleSummary,
      },
      payrollCycleSummary,
      payrollActionCentre,
      lastCompletedCycle,
      recruitmentFunnel,
      attendanceCalendar: {
        month: targetMonth,
        year: targetYear,
        firstDayWeekday,
        daysInMonth,
        days: calendarDays,
      },
      recentLeaves,
      recentOffers,
      upcomingHolidays,
      monthlyAttendanceMix: attendanceMix,
      salaryExpenses: {
        year: targetYear,
        currencySymbol,
        months: salaryExpenses,
      },
      attendanceOverview: {
        period: "This Week",
        days: weeklyOverview,
      },
      companyAssets,
      payrollAllocation: {
        totalMonthly: totalMonthlyPayroll,
        departments: payrollAllocation,
      },
      projectTeams,
    });
  } catch (error) {
    next(error);
  }
}

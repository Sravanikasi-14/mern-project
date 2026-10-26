import mongoose from "mongoose";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getCompanyBusinessDate } from "./attendanceService.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { ONBOARDING_STATUSES } from "../models/User.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";

/**
 * Gemini Function Declarations for HR Analyst real-time tools.
 * Conforms to @google/genai specification using OpenAPI 3.0 types.
 */
export const HR_ANALYST_FUNCTION_DECLARATIONS = [
  {
    name: "analyzeAttendance",
    description:
      "Analyzes real-time company attendance records for today or a specific date. Retrieves presence counts, late arrivals (past office start + grace period), absences, employees on approved leave, department-level absence rates, recurring irregularities (multi-day patterns), and previous week comparisons.",
    parameters: {
      type: "OBJECT",
      properties: {
        targetDate: {
          type: "STRING",
          description:
            "Target business date in YYYY-MM-DD format, or 'today'. Defaults to today in the company timezone.",
        },
        comparePreviousWeek: {
          type: "BOOLEAN",
          description:
            "Set to true to compare attendance against the same weekday from the previous week.",
        },
        checkIrregularities: {
          type: "BOOLEAN",
          description:
            "Set to true to analyze the past 5-7 working days for repeat late arrivals or recurring unexcused absences.",
        },
        department: {
          type: "STRING",
          description:
            "Optional department name filter (e.g. 'Engineering', 'Marketing') or 'ALL'.",
        },
      },
    },
  },
  {
    name: "analyzeEmployeesAndOnboarding",
    description:
      "Analyzes employee directory completeness, missing statutory profile details (bank account, emergency contact, PAN tax details), active headcount by department, and candidate onboarding progression/blockers.",
    parameters: {
      type: "OBJECT",
      properties: {
        focusArea: {
          type: "STRING",
          description:
            "Filter area: 'ALL', 'PROFILES' (incomplete employee data), 'ONBOARDING' (candidate onboarding submissions), or 'HEADCOUNT'.",
        },
      },
    },
  },
  {
    name: "analyzeLeaves",
    description:
      "Analyzes employee leave requests: pending approvals, urgent applications (next 72 hours), department-level overlapping leave date conflicts that risk team understaffing, and recent leave trends.",
    parameters: {
      type: "OBJECT",
      properties: {
        includeOverlaps: {
          type: "BOOLEAN",
          description:
            "Set to true to check if multiple employees in the same team have requested leaves on overlapping dates.",
        },
        urgentOnly: {
          type: "BOOLEAN",
          description:
            "Set to true to focus only on pending leaves starting within the next 3 days.",
        },
        department: {
          type: "STRING",
          description: "Optional department filter or 'ALL'.",
        },
      },
    },
  },
  {
    name: "analyzePayrollReadiness",
    description:
      "Analyzes payroll cycle status, register calculation issues, active employees lacking compensation setup, payment disbursement readiness, and historical compensation changes across pay periods.",
    parameters: {
      type: "OBJECT",
      properties: {
        compareHistoricalCycles: {
          type: "BOOLEAN",
          description:
            "Set to true to compare the current cycle with previous finalized cycles.",
        },
      },
    },
  },
  {
    name: "analyzeRecruitmentAndOffers",
    description:
      "Analyzes the hiring and recruitment pipeline: offer letter funnel (drafts, sent, accepted, rejected, expired), acceptance rates, and candidate onboarding bottlenecks.",
    parameters: {
      type: "OBJECT",
      properties: {
        checkBottlenecks: {
          type: "BOOLEAN",
          description:
            "Set to true to identify candidates stuck in review or draft stages for extended periods.",
        },
      },
    },
  },
  {
    name: "getCrossModuleOverview",
    description:
      "Retrieves an aggregated real-time operational health check across attendance, leave approvals, payroll readiness, candidate onboarding, and overdue tasks. Used for broad questions or risk assessments.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

/**
 * Normalizes YYYY-MM-DD date string with company timezone.
 */
function resolveDateString(dateInput, companyTimezone = "Asia/Kolkata") {
  if (!dateInput || dateInput.toLowerCase() === "today") {
    return getCompanyBusinessDate(new Date(), companyTimezone);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  const d = new Date(dateInput);
  if (!isNaN(d.getTime())) {
    return getCompanyBusinessDate(d, companyTimezone);
  }
  return getCompanyBusinessDate(new Date(), companyTimezone);
}

/**
 * Tool 1: Attendance Analysis
 */
async function runAttendanceAnalysis({
  models,
  company,
  targetDate,
  comparePreviousWeek = false,
  checkIrregularities = false,
  department,
}) {
  const { Attendance, Employee, CompanyHrPolicy, LeaveRequest } = models;
  const companyTimezone = company?.config?.timezone || "Asia/Kolkata";
  const dateStr = resolveDateString(targetDate, companyTimezone);

  // 1. Fetch Policy
  const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
  const officeStartTime = policy?.attendanceRules?.officeStartTime || "09:30";
  const gracePeriodMinutes = policy?.attendanceRules?.gracePeriodMinutes ?? 15;
  const [startH, startM] = officeStartTime.split(":").map(Number);
  const lateCutoffMinutes = (startH || 9) * 60 + (startM || 30) + gracePeriodMinutes;

  // 2. Fetch Active Employees
  const empFilter = { status: { $ne: "TERMINATED" } };
  if (department && department !== "ALL") {
    empFilter["job.department"] = department;
  }

  const employees = await Employee.find(empFilter)
    .select("_id employeeCode fullName email job status")
    .lean();

  const totalEmployees = employees.length;
  const employeeMap = new Map();
  for (const emp of employees) {
    employeeMap.set(String(emp._id), emp);
  }

  // 3. Fetch Attendance records for date
  const attendanceRecords = await Attendance.find({
    date: dateStr,
    employeeId: { $in: Array.from(employeeMap.keys()) },
  }).lean();

  const attendanceMap = new Map();
  for (const att of attendanceRecords) {
    attendanceMap.set(String(att.employeeId), att);
  }

  // 4. Fetch Approved Leaves for date
  const targetDateObj = new Date(dateStr + "T00:00:00.000Z");
  const approvedLeaves = await LeaveRequest.find({
    status: LEAVE_STATUSES.APPROVED,
    fromDate: { $lte: targetDateObj },
    toDate: { $gte: targetDateObj },
    employeeId: { $in: Array.from(employeeMap.keys()) },
  }).lean();

  const onLeaveEmpIdSet = new Set(approvedLeaves.map((l) => String(l.employeeId)));

  // 5. Categorize each employee
  let presentCount = 0;
  let checkedInCount = 0;
  let checkedOutCount = 0;
  const lateArrivals = [];
  const absentEmployees = [];
  const onLeaveEmployees = [];
  const departmentStats = {};

  for (const emp of employees) {
    const empId = String(emp._id);
    const dept = emp.job?.department || "Unassigned";

    if (!departmentStats[dept]) {
      departmentStats[dept] = { total: 0, present: 0, absent: 0, late: 0, onLeave: 0 };
    }
    departmentStats[dept].total++;

    const att = attendanceMap.get(empId);
    const isOnLeave = onLeaveEmpIdSet.has(empId) || att?.status === "ON_LEAVE";

    if (isOnLeave) {
      const leaveRecord = approvedLeaves.find((l) => String(l.employeeId) === empId);
      departmentStats[dept].onLeave++;
      onLeaveEmployees.push({
        fullName: emp.fullName,
        employeeCode: emp.employeeCode,
        department: dept,
        leaveType: leaveRecord?.leaveTypeCode || "APPROVED_LEAVE",
      });
      continue;
    }

    if (att && att.checkIn) {
      presentCount++;
      departmentStats[dept].present++;

      if (att.checkOut) {
        checkedOutCount++;
      } else {
        checkedInCount++;
      }

      // Check Late Arrival
      const checkInDate = new Date(att.checkIn);
      // Format checkin time in company timezone
      const checkInLocalStr = checkInDate.toLocaleTimeString("en-US", {
        timeZone: companyTimezone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      const [inH, inM] = checkInLocalStr.split(":").map(Number);
      const inMins = inH * 60 + inM;

      if (inMins > lateCutoffMinutes) {
        const minutesLate = inMins - ((startH || 9) * 60 + (startM || 30));
        departmentStats[dept].late++;
        lateArrivals.push({
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: dept,
          checkInTime: checkInLocalStr,
          minutesLate,
        });
      }
    } else {
      // Absent (no check-in and not on approved leave)
      departmentStats[dept].absent++;
      absentEmployees.push({
        fullName: emp.fullName,
        employeeCode: emp.employeeCode,
        department: dept,
      });
    }
  }

  const attendanceRate =
    totalEmployees > 0 ? Number(((presentCount / totalEmployees) * 100).toFixed(1)) : 0;

  // Department breakdown sorted by highest absence rate
  const departmentBreakdown = Object.entries(departmentStats).map(([dept, stats]) => {
    const rate = stats.total > 0 ? Number(((stats.present / stats.total) * 100).toFixed(1)) : 0;
    const absenceRate =
      stats.total > 0 ? Number(((stats.absent / stats.total) * 100).toFixed(1)) : 0;
    return {
      department: dept,
      total: stats.total,
      present: stats.present,
      absent: stats.absent,
      late: stats.late,
      onLeave: stats.onLeave,
      attendanceRate: rate,
      absenceRate,
    };
  }).sort((a, b) => b.absenceRate - a.absenceRate);

  const result = {
    date: dateStr,
    timezone: companyTimezone,
    policySummary: {
      officeStartTime,
      gracePeriodMinutes,
      officialCutoff: `${officeStartTime} (+${gracePeriodMinutes}m grace)`,
    },
    summary: {
      totalEmployees,
      presentCount,
      checkedInCount,
      checkedOutCount,
      absentCount: absentEmployees.length,
      lateArrivalCount: lateArrivals.length,
      onLeaveCount: onLeaveEmployees.length,
      attendanceRate: `${attendanceRate}%`,
    },
    lateArrivals: lateArrivals.slice(0, 15),
    absentEmployees: absentEmployees.slice(0, 15),
    onLeaveEmployees,
    departmentBreakdown,
  };

  // 6. Check Recurring Irregularities (past 7 calendar days)
  if (checkIrregularities) {
    const targetDt = new Date(dateStr + "T00:00:00.000Z");
    const sevenDaysAgoDt = new Date(targetDt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startRangeStr = getCompanyBusinessDate(sevenDaysAgoDt, companyTimezone);

    const pastRecords = await Attendance.find({
      date: { $gte: startRangeStr, $lte: dateStr },
      employeeId: { $in: Array.from(employeeMap.keys()) },
    }).lean();

    const empIrregularityMap = new Map();
    for (const rec of pastRecords) {
      const empId = String(rec.employeeId);
      if (!empIrregularityMap.has(empId)) {
        empIrregularityMap.set(empId, { lateCount: 0, absentDates: [] });
      }
      const data = empIrregularityMap.get(empId);
      if (rec.checkIn) {
        const d = new Date(rec.checkIn);
        const [h, m] = d.toLocaleTimeString("en-US", {
          timeZone: companyTimezone,
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }).split(":").map(Number);
        if (h * 60 + m > lateCutoffMinutes) {
          data.lateCount++;
        }
      }
    }

    const recurringIrregularities = [];
    for (const [empId, data] of empIrregularityMap.entries()) {
      if (data.lateCount >= 2) {
        const emp = employeeMap.get(empId);
        if (emp) {
          recurringIrregularities.push({
            fullName: emp.fullName,
            employeeCode: emp.employeeCode,
            department: emp.job?.department || "Unassigned",
            lateArrivalsThisWeek: data.lateCount,
            issue: `Repeated late arrival (${data.lateCount} occurrences in past week)`,
          });
        }
      }
    }
    result.recurringIrregularities = recurringIrregularities;
  }

  // 7. Compare with Previous Week (same day 7 days ago)
  if (comparePreviousWeek) {
    const targetDt = new Date(dateStr + "T00:00:00.000Z");
    const prevWeekDt = new Date(targetDt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevDateStr = getCompanyBusinessDate(prevWeekDt, companyTimezone);

    const prevAttendance = await Attendance.find({
      date: prevDateStr,
      employeeId: { $in: Array.from(employeeMap.keys()) },
      checkIn: { $exists: true, $ne: null },
    }).countDocuments();

    const prevRate =
      totalEmployees > 0 ? Number(((prevAttendance / totalEmployees) * 100).toFixed(1)) : 0;
    const diff = Number((attendanceRate - prevRate).toFixed(1));

    result.previousWeekComparison = {
      currentDate: dateStr,
      previousDate: prevDateStr,
      currentAttendanceRate: `${attendanceRate}%`,
      previousWeekAttendanceRate: `${prevRate}%`,
      percentageChange: `${diff >= 0 ? "+" : ""}${diff}%`,
      trend: diff > 0 ? "IMPROVED" : diff < 0 ? "DECLINED" : "STABLE",
    };
  }

  return result;
}

/**
 * Tool 2: Employee and Onboarding Analysis
 */
async function runEmployeesAndOnboardingAnalysis({ models, focusArea = "ALL" }) {
  const { Employee, User } = models;

  const result = {};

  // 1. Employee Directory & Profiles
  if (focusArea === "ALL" || focusArea === "PROFILES" || focusArea === "HEADCOUNT") {
    const activeEmployees = await Employee.find({ status: "ACTIVE" })
      .select("employeeCode fullName email job bankDetails emergencyContact taxDetails invitation createdAt")
      .lean();

    const totalActive = activeEmployees.length;
    const departmentHeadcount = {};
    const missingBankDetails = [];
    const missingEmergencyContacts = [];
    const missingTaxDetails = [];
    const pendingInvitations = [];

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let newJoinersLast30Days = 0;

    for (const emp of activeEmployees) {
      const dept = emp.job?.department || "Unassigned";
      departmentHeadcount[dept] = (departmentHeadcount[dept] || 0) + 1;

      if (emp.createdAt && new Date(emp.createdAt) >= thirtyDaysAgo) {
        newJoinersLast30Days++;
      }

      const hasBank = Boolean(emp.bankDetails?.accountNumber && emp.bankDetails?.ifscCode);
      const hasEmergency = Boolean(emp.emergencyContact?.phone && emp.emergencyContact?.name);
      const hasTax = Boolean(emp.taxDetails?.panNumber);
      const hasPendingInv = emp.invitation?.status === "PENDING" || emp.invitation?.status === "EXPIRED";

      if (!hasBank) {
        missingBankDetails.push({
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: dept,
        });
      }
      if (!hasEmergency) {
        missingEmergencyContacts.push({
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: dept,
        });
      }
      if (!hasTax) {
        missingTaxDetails.push({
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: dept,
        });
      }
      if (hasPendingInv) {
        pendingInvitations.push({
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          invitationStatus: emp.invitation?.status,
        });
      }
    }

    result.employeeDirectory = {
      totalActiveEmployees: totalActive,
      newJoinersLast30Days,
      departmentHeadcount,
      profileCompleteness: {
        totalIncomplete: new Set([
          ...missingBankDetails.map((e) => e.employeeCode),
          ...missingEmergencyContacts.map((e) => e.employeeCode),
          ...missingTaxDetails.map((e) => e.employeeCode),
          ...pendingInvitations.map((e) => e.employeeCode),
        ]).size,
        missingBankCount: missingBankDetails.length,
        missingEmergencyContactCount: missingEmergencyContacts.length,
        missingPanTaxCount: missingTaxDetails.length,
        pendingInvitationsCount: pendingInvitations.length,
        missingBankEmployees: missingBankDetails.slice(0, 10),
        missingPanEmployees: missingTaxDetails.slice(0, 10),
        pendingInvitations: pendingInvitations.slice(0, 10),
      },
    };
  }

  // 2. Candidate Onboarding Pipeline
  if (focusArea === "ALL" || focusArea === "ONBOARDING") {
    const candidateUsers = await User.find({
      "onboarding.status": { $exists: true, $ne: null },
    })
      .select("email onboarding")
      .lean();

    const statusCounts = {
      DRAFT: 0,
      SUBMITTED: 0,
      CHANGES_REQUESTED: 0,
      APPROVED: 0,
      REJECTED: 0,
    };

    const pendingSubmissions = [];
    const now = Date.now();

    for (const u of candidateUsers) {
      const st = u.onboarding?.status || "DRAFT";
      if (statusCounts[st] !== undefined) {
        statusCounts[st]++;
      }

      if (st === ONBOARDING_STATUSES.SUBMITTED) {
        const submittedAt = u.onboarding?.submittedAt ? new Date(u.onboarding.submittedAt) : null;
        const daysWaiting = submittedAt
          ? Math.floor((now - submittedAt.getTime()) / (24 * 60 * 60 * 1000))
          : 0;

        pendingSubmissions.push({
          candidateName:
            u.onboarding?.personalDetails?.fullName ||
            u.onboarding?.candidate?.fullName ||
            u.email,
          email: u.email,
          position: u.onboarding?.position || "Candidate",
          daysAwaitingReview: daysWaiting,
          requiresUrgentReview: daysWaiting >= 2,
        });
      }
    }

    result.candidateOnboarding = {
      totalInPipeline: candidateUsers.length,
      funnel: statusCounts,
      awaitingHrReviewCount: statusCounts.SUBMITTED,
      pendingReviewList: pendingSubmissions.sort(
        (a, b) => b.daysAwaitingReview - a.daysAwaitingReview
      ),
      draftCount: statusCounts.DRAFT,
      changesRequestedCount: statusCounts.CHANGES_REQUESTED,
    };
  }

  return result;
}

/**
 * Tool 3: Leave Analysis & Team Overlaps
 */
async function runLeaveAnalysis({ models, includeOverlaps = true, urgentOnly = false, department }) {
  const { LeaveRequest, Employee } = models;
  const now = new Date();
  const threeDaysAhead = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const query = { status: LEAVE_STATUSES.PENDING };
  if (urgentOnly) {
    query.fromDate = { $lte: threeDaysAhead };
  }

  const pendingLeaves = await LeaveRequest.find(query)
    .populate("employeeId", "fullName employeeCode job email")
    .sort({ fromDate: 1 })
    .lean();

  const formattedPending = [];
  const urgentCount = pendingLeaves.filter((l) => new Date(l.fromDate) <= threeDaysAhead).length;

  for (const l of pendingLeaves) {
    const emp = l.employeeId;
    const dept = emp?.job?.department || "Unassigned";
    if (department && department !== "ALL" && dept !== department) {
      continue;
    }

    const isUrgent = new Date(l.fromDate) <= threeDaysAhead;
    formattedPending.push({
      leaveId: l._id,
      employeeName: emp?.fullName || "Employee",
      employeeCode: emp?.employeeCode || "--",
      department: dept,
      leaveType: l.leaveTypeCode,
      fromDate: new Date(l.fromDate).toISOString().slice(0, 10),
      toDate: new Date(l.toDate).toISOString().slice(0, 10),
      daysCount: l.daysCount || 1,
      reason: l.reason || "",
      isUrgent,
    });
  }

  const result = {
    totalPendingLeaves: pendingLeaves.length,
    urgentLeavesNext72Hours: urgentCount,
    pendingLeavesList: formattedPending.slice(0, 15),
  };

  // Check Overlapping Leaves within the same team/department
  if (includeOverlaps) {
    // Look at upcoming leaves in the next 30 days
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcomingLeaves = await LeaveRequest.find({
      status: { $in: [LEAVE_STATUSES.PENDING, LEAVE_STATUSES.APPROVED] },
      fromDate: { $lte: thirtyDaysAhead },
      toDate: { $gte: now },
    })
      .populate("employeeId", "fullName employeeCode job")
      .lean();

    const deptLeavesMap = {};
    for (const l of upcomingLeaves) {
      const dept = l.employeeId?.job?.department || "General";
      if (!deptLeavesMap[dept]) deptLeavesMap[dept] = [];
      deptLeavesMap[dept].push({
        id: l._id,
        name: l.employeeId?.fullName,
        from: new Date(l.fromDate).getTime(),
        to: new Date(l.toDate).getTime(),
        fromStr: new Date(l.fromDate).toISOString().slice(0, 10),
        toStr: new Date(l.toDate).toISOString().slice(0, 10),
        status: l.status,
      });
    }

    const overlaps = [];
    for (const [dept, list] of Object.entries(deptLeavesMap)) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const l1 = list[i];
          const l2 = list[j];
          if (l1.name === l2.name) continue; // same person multiple leaves

          // Overlap check: max(start1, start2) <= min(end1, end2)
          if (Math.max(l1.from, l2.from) <= Math.min(l1.to, l2.to)) {
            const overlapStart = new Date(Math.max(l1.from, l2.from)).toISOString().slice(0, 10);
            const overlapEnd = new Date(Math.min(l1.to, l2.to)).toISOString().slice(0, 10);
            overlaps.push({
              department: dept,
              employees: [l1.name, l2.name],
              overlappingDates: `${overlapStart} to ${overlapEnd}`,
              risk: "STAFFING_CONFLICT",
            });
          }
        }
      }
    }
    result.overlappingTeamLeaves = overlaps.slice(0, 8);
    result.hasTeamLeaveConflicts = overlaps.length > 0;
  }

  return result;
}

/**
 * Tool 4: Payroll Readiness & Validation Analysis
 */
async function runPayrollReadinessAnalysis({ models, compareHistoricalCycles = false }) {
  const { PayrollCycle, Employee, EmployeeCompensation } = models;

  // 1. Check Active staff without compensation configuration
  const [activeStaffCount, compEmployeeIds] = await Promise.all([
    Employee.countDocuments({ status: "ACTIVE" }),
    EmployeeCompensation.distinct("employeeId"),
  ]);

  const activeStaffWithoutComp = await Employee.find({
    status: "ACTIVE",
    _id: { $nin: compEmployeeIds },
  })
    .select("employeeCode fullName job.department")
    .lean();

  // 2. Fetch Latest Payroll Cycle
  const latestCycle = await PayrollCycle.findOne({})
    .sort({ periodYear: -1, periodMonth: -1 })
    .lean();

  const blockers = [];
  const warnings = [];

  if (!latestCycle) {
    blockers.push("No payroll cycle has been initiated yet.");
  } else {
    if (latestCycle.validationIssues?.length > 0) {
      blockers.push(
        `${latestCycle.validationIssues.length} register calculation issue(s) detected in the current cycle.`
      );
    }

    if (activeStaffWithoutComp.length > 0) {
      blockers.push(
        `${activeStaffWithoutComp.length} active employee(s) have no salary compensation structure configured.`
      );
    }

    if (latestCycle.status === "FINALIZED" && latestCycle.paymentStatus !== "PAID") {
      warnings.push(
        `Finalized cycle (${latestCycle.periodMonth}/${latestCycle.periodYear}) is awaiting disbursement recording (Status: ${latestCycle.paymentStatus}).`
      );
    }
  }

  const isReadyToProcess = blockers.length === 0;

  const result = {
    readinessStatus: isReadyToProcess ? "READY" : "BLOCKED",
    readinessVerdict: isReadyToProcess
      ? "Payroll is verified and ready for processing."
      : "Payroll processing is blocked by outstanding setup or register issues.",
    blockers,
    warnings,
    currentCycle: latestCycle
      ? {
          period: `${latestCycle.periodMonth}/${latestCycle.periodYear}`,
          status: latestCycle.status,
          paymentStatus: latestCycle.paymentStatus,
          employeeCount: latestCycle.employeeCount,
          totalGrossEarnings: latestCycle.totalGrossEarnings,
          totalNetPayable: latestCycle.totalNetPayable,
          validationIssuesCount: latestCycle.validationIssues?.length || 0,
          validationIssues: (latestCycle.validationIssues || []).slice(0, 5),
        }
      : null,
    unconfiguredStaffCount: activeStaffWithoutComp.length,
    unconfiguredStaff: activeStaffWithoutComp.slice(0, 8),
  };

  if (compareHistoricalCycles) {
    const historical = await PayrollCycle.find({ status: { $in: ["FINALIZED", "PAID"] } })
      .sort({ periodYear: -1, periodMonth: -1 })
      .limit(4)
      .select("periodMonth periodYear totalGrossEarnings totalNetPayable employeeCount paymentStatus")
      .lean();

    result.historicalCycles = historical.map((c) => ({
      period: `${c.periodMonth}/${c.periodYear}`,
      totalNetPayable: c.totalNetPayable,
      totalGrossEarnings: c.totalGrossEarnings,
      employeeCount: c.employeeCount,
      paymentStatus: c.paymentStatus,
    }));
  }

  return result;
}

/**
 * Tool 5: Recruitment and Offer Letter Analysis
 */
async function runRecruitmentAndOffersAnalysis({ models, checkBottlenecks = true }) {
  const { OfferLetter, User } = models;

  const offers = await OfferLetter.find({})
    .select("candidate position department status emailDelivery issuedAt createdAt")
    .lean();

  const funnel = {
    DRAFT: 0,
    SENT: 0,
    ACCEPTED: 0,
    REJECTED: 0,
    TOTAL: offers.length,
  };

  const bottlenecks = [];
  const now = Date.now();

  for (const offer of offers) {
    if (funnel[offer.status] !== undefined) {
      funnel[offer.status]++;
    }

    if (checkBottlenecks && offer.status === OFFER_LETTER_STATUSES.SENT) {
      const sentTime = offer.emailDelivery?.sentAt
        ? new Date(offer.emailDelivery.sentAt).getTime()
        : offer.issuedAt
        ? new Date(offer.issuedAt).getTime()
        : offer.createdAt
        ? new Date(offer.createdAt).getTime()
        : null;
      if (sentTime) {
        const daysPending = Math.floor((now - sentTime) / (24 * 60 * 60 * 1000));
        if (daysPending >= 3) {
          bottlenecks.push({
            candidateName: offer.candidate?.fullName,
            email: offer.candidate?.email,
            position: offer.position,
            department: offer.department,
            daysWaitingResponse: daysPending,
            issue: `Offer sent ${daysPending} days ago without candidate response.`,
          });
        }
      }
    }
  }

  const completed = funnel.ACCEPTED + funnel.REJECTED;
  const acceptanceRate = completed > 0 ? Number(((funnel.ACCEPTED / completed) * 100).toFixed(1)) : 0;

  return {
    funnel: {
      ...funnel,
      acceptanceRate: `${acceptanceRate}%`,
    },
    bottlenecks: bottlenecks.sort((a, b) => b.daysWaitingResponse - a.daysWaitingResponse).slice(0, 10),
  };
}

/**
 * Tool 6: Cross-Module Operational Overview
 */
async function runCrossModuleOverview({ models, company }) {
  const [attendance, onboarding, leaves, payroll, hiring] = await Promise.all([
    runAttendanceAnalysis({ models, company, targetDate: "today" }),
    runEmployeesAndOnboardingAnalysis({ models, focusArea: "ALL" }),
    runLeaveAnalysis({ models, includeOverlaps: true }),
    runPayrollReadinessAnalysis({ models }),
    runRecruitmentAndOffersAnalysis({ models, checkBottlenecks: true }),
  ]);

  const operationalRisks = [];
  const recommendedActions = [];

  // Attendance Risk
  const attRate = parseFloat(attendance.summary.attendanceRate) || 0;
  if (attRate < 80) {
    operationalRisks.push(`Low attendance today (${attendance.summary.attendanceRate}). ${attendance.summary.absentCount} employee(s) absent.`);
    recommendedActions.push("Review Attendance Overview to identify affected departments and regularize missing logs.");
  }

  // Late arrivals
  if (attendance.summary.lateArrivalCount >= 3) {
    operationalRisks.push(`${attendance.summary.lateArrivalCount} employee(s) arrived past the official grace cutoff today.`);
    recommendedActions.push("Check Attendance logs for shift punctuality patterns.");
  }

  // Leave conflicts
  if (leaves.hasTeamLeaveConflicts) {
    operationalRisks.push(`Overlapping leaves detected in ${leaves.overlappingTeamLeaves.length} department(s), posing team understaffing risks.`);
    recommendedActions.push("Review Leave Management to resolve overlapping leave dates.");
  }

  // Payroll blockers
  if (payroll.readinessStatus === "BLOCKED") {
    operationalRisks.push(`Payroll is blocked: ${payroll.blockers.join("; ")}.`);
    recommendedActions.push("Open Payroll Action Centre to configure missing compensation structures and resolve register errors.");
  }

  // Onboarding reviews
  if (onboarding.candidateOnboarding?.awaitingHrReviewCount > 0) {
    operationalRisks.push(`${onboarding.candidateOnboarding.awaitingHrReviewCount} candidate onboarding submission(s) awaiting HR review.`);
    recommendedActions.push("Open Candidate Onboarding Review to approve candidates and provision employee accounts.");
  }

  return {
    asOfDate: attendance.date,
    healthOverview: {
      attendanceRate: attendance.summary.attendanceRate,
      activeStaffCount: onboarding.employeeDirectory?.totalActiveEmployees || 0,
      pendingLeaveRequests: leaves.totalPendingLeaves,
      payrollStatus: payroll.readinessStatus,
      candidateSubmissionsPending: onboarding.candidateOnboarding?.awaitingHrReviewCount || 0,
      offersAcceptedCount: hiring.funnel.ACCEPTED,
    },
    operationalRisks,
    recommendedActions,
    deepDivesAvailable: [
      "Attendance Analysis (who is late/absent, department rates, weekly comparison)",
      "Employee Profile Completeness (missing bank/PAN/emergency contacts)",
      "Leave Analysis & Team Overlaps (pending leaves, staffing conflicts)",
      "Payroll Readiness & Validation Issues",
      "Recruitment & Offer Funnel",
    ],
  };
}

/**
 * Master dispatcher for HR Analyst Tools.
 * Enforces tenant boundary through authenticated models and role checks.
 */
export async function executeHrAnalystTool(toolName, args = {}, { models, company, user }) {
  if (!models || !user) {
    throw new Error("Unauthorized tool execution: missing tenant context or user credentials.");
  }

  // Strict Role Check: Company-wide analytical tools require HR_ADMIN
  if (user.role !== "HR_ADMIN") {
    return {
      error: "ACCESS_DENIED",
      message:
        "Company-wide analytical intelligence is restricted to HR Administrators. Please ask questions concerning your personal profile, leaves, tasks, or impact points.",
    };
  }

  switch (toolName) {
    case "analyzeAttendance":
      return await runAttendanceAnalysis({
        models,
        company,
        targetDate: args.targetDate,
        comparePreviousWeek: args.comparePreviousWeek,
        checkIrregularities: args.checkIrregularities,
        department: args.department,
      });

    case "analyzeEmployeesAndOnboarding":
      return await runEmployeesAndOnboardingAnalysis({
        models,
        focusArea: args.focusArea,
      });

    case "analyzeLeaves":
      return await runLeaveAnalysis({
        models,
        includeOverlaps: args.includeOverlaps,
        urgentOnly: args.urgentOnly,
        department: args.department,
      });

    case "analyzePayrollReadiness":
      return await runPayrollReadinessAnalysis({
        models,
        compareHistoricalCycles: args.compareHistoricalCycles,
      });

    case "analyzeRecruitmentAndOffers":
      return await runRecruitmentAndOffersAnalysis({
        models,
        checkBottlenecks: args.checkBottlenecks,
      });

    case "getCrossModuleOverview":
      return await runCrossModuleOverview({ models, company });

    default:
      return {
        error: "UNKNOWN_TOOL",
        message: `Tool '${toolName}' is not an authorized HRMS analytical tool.`,
      };
  }
}

/**
 * Fallback formatter for generating real-time, deterministic structured analysis
 * when Gemini API quota is exhausted (429) or unavailable.
 * Ensures HR Admin receives real-time live answers without disruption.
 */
export function formatDeterministicAnalysis(toolName, data, userMessage = "") {
  if (data?.error) {
    return `### HR Analysis Notice\n\n${data.message || data.error}`;
  }

  switch (toolName) {
    case "analyzeAttendance": {
      const s = data.summary;
      const lateList = (data.lateArrivals || [])
        .map((l) => `- **${l.fullName}** (${l.department}): checked in at ${l.checkInTime} (${l.minutesLate}m late)`)
        .join("\n");
      const absentList = (data.absentEmployees || [])
        .map((a) => `- **${a.fullName}** (${a.department})`)
        .join("\n");
      const onLeaveList = (data.onLeaveEmployees || [])
        .map((o) => `- **${o.fullName}** (${o.department}): on ${o.leaveType}`)
        .join("\n");

      let compText = "";
      if (data.previousWeekComparison) {
        const c = data.previousWeekComparison;
        compText = `\n\n### Previous Week Comparison:\n- Same day last week (${c.previousDate}): **${c.previousWeekAttendanceRate}**\n- Trend: **${c.trend}** (${c.percentageChange})`;
      }

      let irregText = "";
      if (data.recurringIrregularities?.length > 0) {
        irregText = `\n\n### Recurring Attendance Irregularities:\n` +
          data.recurringIrregularities.map((i) => `- **${i.fullName}** (${i.department}): ${i.issue}`).join("\n");
      }

      return `### Real-Time Attendance Analysis (${data.date})

- **Overall Attendance Rate:** **${s.attendanceRate}** (${s.presentCount} of ${s.totalEmployees} employees present)
- **Currently Checked In:** ${s.checkedInCount}
- **Completed Shift (Checked Out):** ${s.checkedOutCount}
- **Late Arrivals (past ${data.policySummary.officialCutoff}):** ${s.lateArrivalCount}
- **Absences:** ${s.absentCount}
- **Approved Leave:** ${s.onLeaveCount}

${lateList ? `### Late Arrivals:\n${lateList}\n` : ""}
${absentList ? `### Absent Employees:\n${absentList}\n` : ""}
${onLeaveList ? `### Employees on Approved Leave:\n${onLeaveList}\n` : ""}
${irregText}
${compText}

### Recommended Actions:
1. Review the [Attendance Overview](file:///admin/attendance) to evaluate shift regularizations.
2. Confirm if absent employees have unsubmitted leave requests.`;
    }

    case "analyzeEmployeesAndOnboarding": {
      const dir = data.employeeDirectory;
      const onb = data.candidateOnboarding;
      let text = `### Real-Time Employee & Onboarding Analysis\n\n`;

      if (dir) {
        text += `- **Total Active Employees:** ${dir.totalActiveEmployees}\n`;
        text += `- **New Hires (Last 30 Days):** ${dir.newJoinersLast30Days}\n`;
        text += `- **Incomplete Profiles:** ${dir.profileCompleteness.totalIncomplete} employee(s) need attention\n`;
        text += `  - Missing Bank Details: ${dir.profileCompleteness.missingBankCount}\n`;
        text += `  - Missing Emergency Contacts: ${dir.profileCompleteness.missingEmergencyContactCount}\n`;
        text += `  - Missing PAN / Tax Records: ${dir.profileCompleteness.missingPanTaxCount}\n\n`;
      }

      if (onb) {
        text += `### Candidate Onboarding Pipeline:\n`;
        text += `- **Awaiting HR Review:** **${onb.awaitingHrReviewCount}**\n`;
        text += `- **In Draft Progress:** ${onb.draftCount}\n`;
        text += `- **Changes Requested:** ${onb.changesRequestedCount}\n\n`;

        if (onb.pendingReviewList?.length > 0) {
          text += `### Pending Reviews:\n` +
            onb.pendingReviewList
              .map((p) => `- **${p.candidateName}** (${p.position}) — waiting ${p.daysAwaitingReview} day(s)${p.requiresUrgentReview ? " ⚠️ (Action needed)" : ""}`)
              .join("\n") + "\n\n";
        }
      }

      text += `### Recommended Actions:\n`;
      text += `1. Review candidate submissions in [Candidate Onboarding](file:///admin/onboarding) to unblock joining.\n`;
      text += `2. Request missing statutory records from employees via [Employee Directory](file:///admin).`;
      return text;
    }

    case "analyzeLeaves": {
      let text = `### Real-Time Leave Analysis\n\n`;
      text += `- **Pending Leave Requests:** **${data.totalPendingLeaves}**\n`;
      text += `- **Urgent (Starting in Next 72 Hours):** ${data.urgentLeavesNext72Hours}\n\n`;

      if (data.pendingLeavesList?.length > 0) {
        text += `### Pending Applications:\n` +
          data.pendingLeavesList
            .map((l) => `- **${l.employeeName}** (${l.department}): ${l.leaveType} from ${l.fromDate} to ${l.toDate} (${l.daysCount}d)${l.isUrgent ? " ⚠️ **Urgent**" : ""}`)
            .join("\n") + "\n\n";
      }

      if (data.hasTeamLeaveConflicts) {
        text += `### ⚠️ Team Understaffing Risk (Overlapping Leaves):\n` +
          data.overlappingTeamLeaves
            .map((o) => `- **${o.department} Team**: ${o.employees.join(" & ")} have overlapping leave (${o.overlappingDates})`)
            .join("\n") + "\n\n";
      }

      text += `### Recommended Actions:\n`;
      text += `1. Process pending applications in [Leave Management](file:///admin/leave) to prevent project scheduling conflicts.`;
      return text;
    }

    case "analyzePayrollReadiness": {
      const isReady = data.readinessStatus === "READY";
      let text = `### Real-Time Payroll Readiness Analysis\n\n`;
      text += `- **Readiness Status:** **${data.readinessStatus}** (${data.readinessVerdict})\n`;
      if (data.currentCycle) {
        text += `- **Current Period:** ${data.currentCycle.period} (Status: ${data.currentCycle.status}, Payment: ${data.currentCycle.paymentStatus})\n`;
        text += `- **Staff Included:** ${data.currentCycle.employeeCount}\n`;
      }

      if (data.blockers?.length > 0) {
        text += `\n### 🚫 Blockers to Resolve:\n` +
          data.blockers.map((b) => `- ${b}`).join("\n") + "\n";
      }

      if (data.warnings?.length > 0) {
        text += `\n### ⚠️ Attention Required:\n` +
          data.warnings.map((w) => `- ${w}`).join("\n") + "\n";
      }

      text += `\n### Recommended Actions:\n`;
      text += `1. Navigate to the [Payroll Action Centre](file:///admin/payroll) to configure compensation and resolve register items.`;
      return text;
    }

    case "analyzeRecruitmentAndOffers": {
      const f = data.funnel;
      let text = `### Real-Time Recruitment & Offer Analysis\n\n`;
      text += `- **Total Offers Issued:** ${f.TOTAL}\n`;
      text += `- **Accepted:** **${f.ACCEPTED}** (Acceptance Rate: **${f.acceptanceRate}**)\n`;
      text += `- **Sent (Awaiting Candidate Decision):** ${f.SENT}\n`;
      text += `- **Declined / Rejected:** ${f.REJECTED}\n`;
      text += `- **Drafts in Preparation:** ${f.DRAFT}\n\n`;

      if (data.bottlenecks?.length > 0) {
        text += `### Bottlenecks / Stalled Offers:\n` +
          data.bottlenecks
            .map((b) => `- **${b.candidateName}** (${b.position}, ${b.department}) — ${b.issue}`)
            .join("\n") + "\n\n";
      }

      text += `### Recommended Actions:\n`;
      text += `1. Follow up with pending candidates in [Offer Letters](file:///admin/offers).\n`;
      text += `2. Check [Candidate Onboarding](file:///admin/onboarding) for newly accepted candidates.`;
      return text;
    }

    case "getCrossModuleOverview": {
      const h = data.healthOverview;
      let text = `### HRMS Cross-Module Operational Health Check (${data.asOfDate})\n\n`;
      text += `- **Today's Attendance Rate:** **${h.attendanceRate}**\n`;
      text += `- **Active Workforce:** ${h.activeStaffCount} employees\n`;
      text += `- **Pending Leave Applications:** ${h.pendingLeaveRequests}\n`;
      text += `- **Payroll Readiness:** **${h.payrollStatus}**\n`;
      text += `- **Pending Candidate Onboardings:** ${h.candidateSubmissionsPending}\n`;
      text += `- **Offers Accepted:** ${h.offersAcceptedCount}\n\n`;

      if (data.operationalRisks?.length > 0) {
        text += `### Operational Risks Identified:\n` +
          data.operationalRisks.map((r) => `- ⚠️ ${r}`).join("\n") + "\n\n";
      }

      if (data.recommendedActions?.length > 0) {
        text += `### Recommended Next Steps:\n` +
          data.recommendedActions.map((a, idx) => `${idx + 1}. ${a}`).join("\n");
      }
      return text;
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}

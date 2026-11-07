import { USER_ROLES } from "../models/User.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { ASSET_STATUSES } from "../models/CompanyAsset.js";
import { getCompanyBusinessDate } from "./attendanceService.js";
import { addCivilDays, parseCivilDate, formatCivilDate, weekdaySunday0 } from "../utils/companyTime.js";

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

function isPresentAttendance(att) {
  if (!att) return false;
  return Boolean(
    att.checkIn ||
      att.status === "CHECKED_IN" ||
      att.status === "CHECKED_OUT" ||
      att.status === "PRESENT"
  );
}

function isLateCheckIn(checkIn, companyTimezone, lateThresholdMinutes) {
  if (!checkIn) return false;
  const checkInLocalTime = getTimeInTimezone(checkIn, companyTimezone);
  const checkInMins = parseTimeToMinutes(checkInLocalTime);
  return checkInMins !== null && checkInMins > lateThresholdMinutes;
}

function countsFromAggregate(rows) {
  const map = Object.create(null);
  for (const row of rows || []) {
    const key = row._id == null || row._id === "" ? "UNKNOWN" : String(row._id);
    map[key] = row.count || 0;
  }
  return map;
}

function safeCurrencySymbol(policy) {
  return policy?.payrollRules?.currencySymbol || "₹";
}

const ACTIVITY_LABELS = Object.freeze({
  EMPLOYEE_CREATED: "Employee created",
  EMPLOYEE_UPDATED: "Employee updated",
  STATUS_CHANGED: "Employee status changed",
  INVITATION_SENT: "Invitation sent",
  INVITATION_RESENT: "Invitation resent",
  ONBOARDING_COMPLETED: "Onboarding completed",
  LEAVE_REQUESTED: "Leave requested",
  LEAVE_APPROVED: "Leave approved",
  LEAVE_REJECTED: "Leave rejected",
  OFFER_LETTER_CREATED: "Offer created",
  OFFER_LETTER_SENT: "Offer sent",
  OFFER_LETTER_SIGNED: "Offer signed",
  OFFER_LETTER_DECLINED: "Offer declined",
  OFFER_LETTER_WITHDRAWN: "Offer withdrawn",
  ONBOARDING_APPROVED: "Onboarding approved",
  ACCOUNT_ACTIVATED: "Account activated",
  HR_POLICY_CREATED: "HR policy created",
  HR_POLICY_UPDATED: "HR policy updated",
  PAYROLL_FINALIZED: "Payroll finalized",
  PAYROLL_PAYMENT_RECORDED: "Payroll payment recorded",
  COMPANY_ASSET_CREATED: "Asset created",
  COMPANY_ASSET_ASSIGNED: "Asset assigned",
  COMPANY_ASSET_RETURNED: "Asset returned",
  HR_ADMIN_INVITED: "HR Admin invited",
  HR_ADMIN_INVITE_RESENT: "HR Admin invitation resent",
  HR_ADMIN_INVITE_REVOKED: "HR Admin invitation revoked",
  HR_ADMIN_INVITE_ACCEPTED: "HR Admin invitation accepted",
  HR_ADMIN_ACTIVATED: "HR Admin activated",
  HR_ADMIN_DEACTIVATED: "HR Admin deactivated",
});

const ACTIVITY_ACTIONS = Object.keys(ACTIVITY_LABELS);

/**
 * Aggregate company-wide oversight metrics for Company Admin.
 * Tenant context comes exclusively from authenticated company models.
 * Returns aggregates only — no bank details, salary line items, or full collections.
 */
export async function buildCompanyAdminDashboard({ company, models }) {
  const {
    User,
    Employee,
    Attendance,
    LeaveRequest,
    OfferLetter,
    PayrollCycle,
    CompanyAsset,
    CompanyHrPolicy,
    Department,
    AuditLog,
  } = models;

  const companyTimezone = company?.config?.timezone || "Asia/Kolkata";
  const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);
  const todayStart = new Date(`${todayStr}T00:00:00.000Z`);
  const todayEnd = new Date(`${todayStr}T23:59:59.999Z`);

  let activePolicy = null;
  if (CompanyHrPolicy) {
    activePolicy = await CompanyHrPolicy.findOne({
      effectiveFromDate: { $lte: todayEnd },
    })
      .sort({ effectiveFromDate: -1 })
      .select("attendanceRules payrollRules")
      .lean();
    if (!activePolicy) {
      activePolicy = await CompanyHrPolicy.findOne({})
        .sort({ effectiveFromDate: -1 })
        .select("attendanceRules payrollRules")
        .lean();
    }
  }

  const officeStartTime = activePolicy?.attendanceRules?.officeStartTime || "09:30";
  const gracePeriodMinutes = activePolicy?.attendanceRules?.gracePeriodMinutes ?? 15;
  const startMinutes = parseTimeToMinutes(officeStartTime) ?? 570;
  const lateThresholdMinutes = startMinutes + gracePeriodMinutes;
  const currencySymbol = safeCurrencySymbol(activePolicy);

  const [
    activeEmployeeCount,
    totalEmployeeCount,
    hrAdminCount,
    departmentCount,
    statusBreakdownRows,
    departmentBreakdownRows,
    recentEmployees,
    leaveStatusRows,
    offerStatusRows,
    assetStatusRows,
    latestPayrollCycle,
    recentOffers,
    recentActivityDocs,
    workforceTrendCount,
  ] = await Promise.all([
    Employee.countDocuments({ status: "ACTIVE" }),
    Employee.countDocuments({}),
    User.countDocuments({ role: USER_ROLES.HR_ADMIN, isActive: true }),
    Department
      ? Department.countDocuments({ isActive: true })
      : Employee.distinct("job.department", { status: "ACTIVE" }).then((d) =>
          d.filter((name) => Boolean(name && String(name).trim())).length
        ),
    Employee.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Employee.aggregate([
      { $match: { status: "ACTIVE" } },
      {
        $group: {
          _id: {
            $cond: [
              {
                $or: [
                  { $eq: ["$job.department", null] },
                  { $eq: ["$job.department", ""] },
                ],
              },
              "Unassigned",
              "$job.department",
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
    ]),
    Employee.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select("fullName employeeCode status job.department createdAt")
      .lean(),
    LeaveRequest
      ? LeaveRequest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      : Promise.resolve([]),
    OfferLetter
      ? OfferLetter.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      : Promise.resolve(null),
    CompanyAsset
      ? CompanyAsset.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      : Promise.resolve(null),
    PayrollCycle
      ? PayrollCycle.findOne({})
          .sort({ periodYear: -1, periodMonth: -1, updatedAt: -1 })
          .select(
            "periodMonth periodYear periodStartDate periodEndDate status paymentStatus employeeCount totalGrossEarnings totalNetPayable totalPaidAmount updatedAt"
          )
          .lean()
      : Promise.resolve(null),
    OfferLetter
      ? OfferLetter.find({})
          .sort({ updatedAt: -1 })
          .limit(6)
          .select("candidate.fullName status position department updatedAt createdAt")
          .lean()
      : Promise.resolve([]),
    AuditLog
      ? AuditLog.find({ action: { $in: ACTIVITY_ACTIONS } })
          .sort({ timestamp: -1 })
          .limit(15)
          .select("action actorRole actorEmail targetType timestamp")
          .lean()
      : Promise.resolve([]),
    Employee.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  const activeEmployeeIds = (
    await Employee.find({ status: "ACTIVE" }).select("_id").lean()
  ).map((e) => e._id);

  // Attendance today — same presence/late rules as HR Admin dashboard (Attendance collection first).
  let presentToday = 0;
  let lateToday = 0;
  let onLeaveToday = 0;
  let absentToday = 0;
  const attendanceTrend = [];
  let attendanceAvailable = true;

  if (!Attendance || !LeaveRequest) {
    attendanceAvailable = false;
  } else {
    const trendCivil = parseCivilDate(todayStr);
    const trendDates = [];
    for (let i = 6; i >= 0; i--) {
      const d = addCivilDays(trendCivil.year, trendCivil.month, trendCivil.day, -i);
      trendDates.push(formatCivilDate(d.year, d.month, d.day));
    }
    const trendStart = trendDates[0];
    const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const [attendanceToday, attendanceWeek, leavesToday, leavesWeek] = await Promise.all([
      Attendance.find({
        date: todayStr,
        employeeId: { $in: activeEmployeeIds },
      })
        .select("employeeId checkIn status")
        .lean(),
      Attendance.find({
        date: { $gte: trendStart, $lte: todayStr },
        employeeId: { $in: activeEmployeeIds },
      })
        .select("date employeeId checkIn status")
        .lean(),
      LeaveRequest.find({
        employeeId: { $in: activeEmployeeIds },
        status: LEAVE_STATUSES.APPROVED,
        fromDate: { $lte: todayEnd },
        toDate: { $gte: todayStart },
      })
        .select("employeeId")
        .lean(),
      LeaveRequest.find({
        employeeId: { $in: activeEmployeeIds },
        status: LEAVE_STATUSES.APPROVED,
        fromDate: { $lte: todayEnd },
        toDate: { $gte: new Date(`${trendStart}T00:00:00.000Z`) },
      })
        .select("employeeId fromDate toDate")
        .lean(),
    ]);

    const presentIds = new Set();
    const lateIds = new Set();
    for (const att of attendanceToday) {
      if (!isPresentAttendance(att)) continue;
      const id = String(att.employeeId);
      presentIds.add(id);
      if (isLateCheckIn(att.checkIn, companyTimezone, lateThresholdMinutes)) {
        lateIds.add(id);
      }
    }

    // Legacy attendanceLogs fallback for employees with no Attendance row (same rule as HR Admin).
    const missingIds = activeEmployeeIds.filter((id) => !presentIds.has(String(id)));
    if (missingIds.length > 0) {
      const legacyEmps = await Employee.find({ _id: { $in: missingIds } })
        .select("_id customFields.attendanceLogs")
        .lean();
      for (const emp of legacyEmps) {
        const logs = emp.customFields?.attendanceLogs || [];
        const todayLog = logs.find((l) => l.date === todayStr);
        if (todayLog && (todayLog.checkIn || todayLog.status === "PRESENT")) {
          presentIds.add(String(emp._id));
          const mins = parseTimeToMinutes(todayLog.checkIn);
          if (mins !== null && mins > lateThresholdMinutes) {
            lateIds.add(String(emp._id));
          }
        }
      }
    }

    const onLeaveIds = new Set(leavesToday.map((l) => String(l.employeeId)));
    presentToday = presentIds.size;
    lateToday = lateIds.size;
    onLeaveToday = onLeaveIds.size;
    absentToday = Math.max(0, activeEmployeeCount - presentToday - onLeaveToday);

    const byDate = new Map();
    for (const rec of attendanceWeek) {
      if (!byDate.has(rec.date)) byDate.set(rec.date, []);
      byDate.get(rec.date).push(rec);
    }

    for (const dateStr of trendDates) {
      const civil = parseCivilDate(dateStr);
      const dayRecords = byDate.get(dateStr) || [];
      let present = 0;
      let late = 0;
      for (const rec of dayRecords) {
        if (!isPresentAttendance(rec)) continue;
        present++;
        if (isLateCheckIn(rec.checkIn, companyTimezone, lateThresholdMinutes)) late++;
      }
      const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
      const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);
      const leaveSet = new Set();
      for (const leave of leavesWeek) {
        const from = new Date(leave.fromDate);
        const to = new Date(leave.toDate);
        if (from <= dayEnd && to >= dayStart) {
          leaveSet.add(String(leave.employeeId));
        }
      }
      const isFuture = dateStr > todayStr;
      const leaveCount = leaveSet.size;
      const absent = isFuture
        ? 0
        : Math.max(0, activeEmployeeCount - present - leaveCount);

      attendanceTrend.push({
        date: dateStr,
        label: `${weekdayNames[weekdaySunday0(civil.year, civil.month, civil.day)]} ${civil.day}`,
        present,
        absent,
        late,
        onLeave: leaveCount,
      });
    }
  }

  const statusCounts = countsFromAggregate(statusBreakdownRows);
  const leaveCounts = countsFromAggregate(leaveStatusRows);
  const offerCounts = offerStatusRows == null ? null : countsFromAggregate(offerStatusRows);
  const assetCounts = assetStatusRows == null ? null : countsFromAggregate(assetStatusRows);

  const hiringAvailable = offerCounts != null;
  const openPositions = hiringAvailable
    ? (offerCounts[OFFER_LETTER_STATUSES.DRAFT] || 0) +
      (offerCounts[OFFER_LETTER_STATUSES.SENT] || 0)
    : null;
  const activeCandidates = hiringAvailable
    ? offerCounts[OFFER_LETTER_STATUSES.SENT] || 0
    : null;

  const assetsAvailable = assetCounts != null;
  const totalAssets = assetsAvailable
    ? Object.values(assetCounts).reduce((sum, n) => sum + n, 0)
    : null;

  const payrollAvailable = Boolean(PayrollCycle);
  let payrollOverview = {
    available: payrollAvailable,
    hasCycle: false,
    periodMonth: null,
    periodYear: null,
    periodLabel: null,
    status: null,
    paymentStatus: null,
    employeeCount: null,
    totalNetPayable: null,
    totalPaidAmount: null,
    currencySymbol,
  };

  if (payrollAvailable && latestPayrollCycle) {
    const monthNames = [
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
    const m = Number(latestPayrollCycle.periodMonth);
    const y = Number(latestPayrollCycle.periodYear);
    payrollOverview = {
      available: true,
      hasCycle: true,
      periodMonth: m,
      periodYear: y,
      periodLabel:
        Number.isInteger(m) && Number.isInteger(y) && m >= 1 && m <= 12
          ? `${monthNames[m - 1]} ${y}`
          : null,
      status: latestPayrollCycle.status || null,
      paymentStatus: latestPayrollCycle.paymentStatus || null,
      employeeCount: latestPayrollCycle.employeeCount ?? 0,
      // Aggregate cycle totals only — never individual salary or bank details.
      totalNetPayable:
        latestPayrollCycle.totalNetPayable != null
          ? Number(latestPayrollCycle.totalNetPayable)
          : null,
      totalPaidAmount:
        latestPayrollCycle.totalPaidAmount != null
          ? Number(latestPayrollCycle.totalPaidAmount)
          : null,
      currencySymbol,
    };
  }

  const additionsLast30Days = workforceTrendCount;
  const workforceTrends =
    additionsLast30Days > 0 || totalEmployeeCount > 0
      ? {
          available: true,
          additionsLast30Days,
        }
      : {
          available: false,
          additionsLast30Days: 0,
        };

  return {
    generatedAt: new Date().toISOString(),
    businessDate: todayStr,
    timezone: companyTimezone,
    company: {
      companyName: company.companyName || "",
      slug: company.slug || "",
      displayName: company.branding?.displayName || company.companyName || "",
      hasLogo: Boolean(company.branding?.logoUrl),
    },
    overview: {
      activeEmployeeCount,
      totalEmployeeCount,
      departmentCount,
      activeHrAdminCount: hrAdminCount,
    },
    workforce: {
      byDepartment: departmentBreakdownRows.map((row) => ({
        name: row._id || "Unassigned",
        count: row.count || 0,
      })),
      byStatus: Object.entries(statusCounts).map(([status, count]) => ({
        status,
        count,
      })),
      recentAdditions: recentEmployees.map((emp) => ({
        id: String(emp._id),
        fullName: emp.fullName || "Team member",
        employeeCode: emp.employeeCode || "",
        department: emp.job?.department || "",
        status: emp.status || "",
        createdAt: emp.createdAt || null,
      })),
      trends: workforceTrends,
    },
    attendance: {
      available: attendanceAvailable,
      businessDate: todayStr,
      presentToday: attendanceAvailable ? presentToday : null,
      absentToday: attendanceAvailable ? absentToday : null,
      lateToday: attendanceAvailable ? lateToday : null,
      onLeaveToday: attendanceAvailable ? onLeaveToday : null,
      trend: attendanceAvailable ? attendanceTrend : [],
    },
    leave: {
      available: Boolean(LeaveRequest),
      pending: leaveCounts[LEAVE_STATUSES.PENDING] || 0,
      approved: leaveCounts[LEAVE_STATUSES.APPROVED] || 0,
      rejected: leaveCounts[LEAVE_STATUSES.REJECTED] || 0,
      total:
        (leaveCounts[LEAVE_STATUSES.PENDING] || 0) +
        (leaveCounts[LEAVE_STATUSES.APPROVED] || 0) +
        (leaveCounts[LEAVE_STATUSES.REJECTED] || 0),
    },
    payroll: payrollOverview,
    hiring: {
      available: hiringAvailable,
      openPositions,
      activeCandidates,
      pipeline: hiringAvailable
        ? {
            draft: offerCounts[OFFER_LETTER_STATUSES.DRAFT] || 0,
            sent: offerCounts[OFFER_LETTER_STATUSES.SENT] || 0,
            accepted: offerCounts[OFFER_LETTER_STATUSES.ACCEPTED] || 0,
            rejected: offerCounts[OFFER_LETTER_STATUSES.REJECTED] || 0,
            withdrawn: offerCounts[OFFER_LETTER_STATUSES.WITHDRAWN] || 0,
          }
        : null,
      recentActivity: (recentOffers || []).map((offer) => ({
        id: String(offer._id),
        candidateName: offer.candidate?.fullName || "Candidate",
        jobTitle: offer.position || "",
        department: offer.department || "",
        status: offer.status || "",
        updatedAt: offer.updatedAt || offer.createdAt || null,
      })),
    },
    assets: {
      available: assetsAvailable,
      total: totalAssets,
      assigned: assetsAvailable ? assetCounts[ASSET_STATUSES.ASSIGNED] || 0 : null,
      availableCount: assetsAvailable ? assetCounts[ASSET_STATUSES.AVAILABLE] || 0 : null,
      underMaintenance: assetsAvailable
        ? assetCounts[ASSET_STATUSES.UNDER_MAINTENANCE] || 0
        : null,
      retired: assetsAvailable ? assetCounts[ASSET_STATUSES.RETIRED] || 0 : null,
      lost: assetsAvailable ? assetCounts[ASSET_STATUSES.LOST] || 0 : null,
    },
    recentActivity: (recentActivityDocs || []).map((doc) => ({
      id: String(doc._id),
      action: doc.action,
      label: ACTIVITY_LABELS[doc.action] || doc.action,
      actorRole: doc.actorRole || "",
      // Email only — no change payloads / PII fields from audit.changes
      actorEmail: doc.actorEmail || "",
      targetType: doc.targetType || "",
      timestamp: doc.timestamp || doc.createdAt || null,
    })),
    quickAccess: [
      { key: "people", label: "People Management", status: "upcoming" },
      { key: "organization", label: "Organization", status: "upcoming" },
      { key: "attendance", label: "Attendance", status: "upcoming" },
      { key: "leave", label: "Leave", status: "upcoming" },
      { key: "hiring", label: "Hiring", status: "upcoming" },
      { key: "payroll", label: "Payroll", status: "upcoming" },
      { key: "assets", label: "Assets", status: "upcoming" },
      { key: "reports", label: "Reports", status: "upcoming" },
      { key: "settings", label: "Company Settings", status: "upcoming" },
      { key: "hr-management", label: "HR Management", status: "available", to: "/company/hr-management" },
    ],
  };
}

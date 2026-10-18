import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";

/**
 * Normalizes a Date or date string to YYYY-MM-DD string
 */
export function toDateString(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

/**
 * Parse YYYY-MM-DD string or Date into start of day UTC Date
 */
export function parseDateOnly(d) {
  const str = toDateString(d);
  if (!str) return null;
  const [y, m, day] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
}

/**
 * Calculates working leave days between fromDate and toDate using company policy
 */
export function calculateLeaveDays(fromDate, toDate, policy) {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);

  if (!start || !end || start > end) {
    return { workingDays: 0, calendarDays: 0 };
  }

  const holidaySet = new Set(
    (policy?.holidays || []).map((h) => toDateString(h.date))
  );

  const weekendRules = policy?.weekendRules || { saturdayOff: true, sundayOff: true };

  let workingDays = 0;
  let calendarDays = 0;

  const current = new Date(start);
  while (current <= end) {
    calendarDays++;
    const dayOfWeek = current.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const dateStr = current.toISOString().split("T")[0];

    const isWeekend =
      (dayOfWeek === 0 && weekendRules.sundayOff) ||
      (dayOfWeek === 6 && weekendRules.saturdayOff);

    const isHoliday = holidaySet.has(dateStr);

    if (!isWeekend && !isHoliday) {
      workingDays++;
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  // If a leave spans only weekend/holiday days, duration defaults to 1 or workingDays
  const effectiveDays = workingDays > 0 ? workingDays : calendarDays;

  return { workingDays: effectiveDays, calendarDays };
}

/**
 * Check if the employee has any PENDING or APPROVED requests overlapping [fromDate, toDate]
 */
export async function hasOverlappingLeave(LeaveRequest, employeeId, fromDate, toDate, excludeRequestId = null) {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);

  const query = {
    employeeId,
    status: { $in: ["PENDING", "APPROVED"] },
    fromDate: { $lte: end },
    toDate: { $gte: start },
  };

  if (excludeRequestId) {
    query._id = { $ne: excludeRequestId };
  }

  const existing = await LeaveRequest.findOne(query).lean();
  return existing;
}

/**
 * Calculates live leave balance for an employee based on company policy and approved leave history
 */
export async function calculateEmployeeLeaveBalances(employee, policy, LeaveRequest) {
  const currentYear = new Date().getUTCFullYear();
  const startMonth = (policy?.leaveRules?.leaveYearStartMonth || 1) - 1; // 0-indexed
  const startOfYear = new Date(Date.UTC(currentYear, startMonth, 1));
  const endOfYear = new Date(Date.UTC(currentYear + 1, startMonth, 0, 23, 59, 59, 999));

  // Fetch all approved requests in the leave year
  const approvedRequests = await LeaveRequest.find({
    employeeId: employee._id,
    status: "APPROVED",
    fromDate: { $gte: startOfYear, $lte: endOfYear },
  }).lean();

  // Fetch pending requests to show pending count/days
  const pendingRequests = await LeaveRequest.find({
    employeeId: employee._id,
    status: "PENDING",
    fromDate: { $gte: startOfYear, $lte: endOfYear },
  }).lean();

  const approvedDaysByType = {};
  for (const req of approvedRequests) {
    const code = req.leaveTypeCode.toUpperCase();
    approvedDaysByType[code] = (approvedDaysByType[code] || 0) + (req.daysCount || 1);
  }

  const pendingDaysByType = {};
  for (const req of pendingRequests) {
    const code = req.leaveTypeCode.toUpperCase();
    pendingDaysByType[code] = (pendingDaysByType[code] || 0) + (req.daysCount || 1);
  }

  const balancesByKey = {};
  const detailedBalances = [];

  const leaveTypes = policy?.leaveTypes || [];
  for (const lt of leaveTypes) {
    if (!lt.isActive) continue;
    const code = lt.code.toUpperCase();
    const entitlement = lt.yearlyDays || 0;
    const used = approvedDaysByType[code] || 0;
    const pending = pendingDaysByType[code] || 0;
    const balance = Math.max(0, entitlement - used);

    balancesByKey[code.toLowerCase()] = balance;
    detailedBalances.push({
      code,
      name: lt.name,
      yearlyDays: entitlement,
      used,
      pending,
      available: balance,
    });
  }

  // Ensure default casual/sick/earned keys always exist
  if (balancesByKey.casual === undefined) balancesByKey.casual = 8;
  if (balancesByKey.sick === undefined) balancesByKey.sick = 6;
  if (balancesByKey.earned === undefined) balancesByKey.earned = 12;

  return {
    balance: balancesByKey,
    detailed: detailedBalances,
  };
}

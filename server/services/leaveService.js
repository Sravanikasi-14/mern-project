import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Normalizes a Date or date string to YYYY-MM-DD string
 */
export function toDateString(d) {
  if (!d) return "";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    return d.trim();
  }
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
 * Parses "HH:mm" time string to total minutes from midnight (0..1439)
 */
export function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const match = timeStr.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
}

/**
 * Converts total minutes from midnight to "HH:mm" string
 */
export function minutesToTimeString(totalMinutes) {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Returns current date and time parts in the specified company timezone
 */
export function getCompanyCurrentDateTime(timezone = "Asia/Kolkata", now = new Date()) {
  const tz = (timezone && typeof timezone === "string") ? timezone.trim() : "";
  if (!tz) {
    throw new HttpError(422, "Company timezone is not configured. Please contact HR or Platform Admin.");
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find((p) => p.type === type)?.value;
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    let hour = parseInt(getPart("hour"), 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(getPart("minute"), 10);
    const second = parseInt(getPart("second"), 10);

    const dateStr = `${year}-${month}-${day}`;
    return {
      dateStr,
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour,
      minute,
      second,
      currentMinutes: hour * 60 + minute,
      currentTimeString: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  } catch {
    throw new HttpError(422, `Configured company timezone '${tz}' is invalid. Please contact HR.`);
  }
}

/**
 * Returns next day's date string YYYY-MM-DD
 */
export function getTomorrowDateString(todayDateStr) {
  const [y, m, d] = todayDateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().split("T")[0];
}

/**
 * Determines date eligibility and cutoff for leave applications based on company HR policy
 */
export function getLeaveDateRestrictions(policy, timezone = "Asia/Kolkata", now = new Date()) {
  const officeStartTime = policy?.attendanceRules?.officeStartTime;
  if (!officeStartTime || typeof officeStartTime !== "string") {
    throw new HttpError(
      422,
      "Company attendance policy error: officeStartTime is not configured. Please contact HR."
    );
  }

  const officeMinutes = parseTimeToMinutes(officeStartTime);
  if (officeMinutes === null) {
    throw new HttpError(
      422,
      `Company attendance policy error: officeStartTime '${officeStartTime}' is invalid (expected HH:mm format). Please contact HR.`
    );
  }

  const companyNow = getCompanyCurrentDateTime(timezone, now);
  // Cutoff time = officeStartTime minus 60 minutes
  const cutoffMinutes = officeMinutes - 60;
  const cutoffTimeString = minutesToTimeString(cutoffMinutes);

  // Today is selectable ONLY until the cutoff time (strictly before cutoff)
  const isTodayEligible = companyNow.currentMinutes < cutoffMinutes;
  const tomorrowStr = getTomorrowDateString(companyNow.dateStr);
  const earliestEligibleDate = isTodayEligible ? companyNow.dateStr : tomorrowStr;

  return {
    timezone,
    todayStr: companyNow.dateStr,
    tomorrowStr,
    officeStartTime,
    cutoffTime: cutoffTimeString,
    cutoffMinutes,
    currentMinutes: companyNow.currentMinutes,
    currentTimeString: companyNow.currentTimeString,
    isTodayEligible,
    earliestEligibleDate,
  };
}

/**
 * Authoritatively validates leave request dates against past-date and same-day cutoff rules
 */
export function validateLeaveDates(fromDate, toDate, policy, timezone = "Asia/Kolkata", now = new Date()) {
  const fromStr = toDateString(fromDate);
  const toStr = toDateString(toDate);

  if (!fromStr || !toStr) {
    throw new HttpError(400, "Start date and end date are required and must be valid dates.");
  }

  if (fromStr > toStr) {
    throw new HttpError(400, "Start date cannot be after end date.");
  }

  const restrictions = getLeaveDateRestrictions(policy, timezone, now);

  // Rule 1: All dates before today must be rejected
  if (fromStr < restrictions.todayStr || toStr < restrictions.todayStr) {
    throw new HttpError(400, "Leave cannot be applied for past dates.");
  }

  // Rule 3 & 4: Same-day requests at or after the cutoff time must be rejected
  if (!restrictions.isTodayEligible) {
    if (fromStr === restrictions.todayStr || toStr === restrictions.todayStr) {
      throw new HttpError(
        400,
        `Same-day leave requests must be submitted at least 1 hour before office start time (${restrictions.officeStartTime}). The cutoff time for today was ${restrictions.cutoffTime} (${restrictions.timezone}). Only future dates starting from ${restrictions.tomorrowStr} are currently selectable.`
      );
    }
  }

  // Rule 5: Ensure start date is not before earliest eligible date
  if (fromStr < restrictions.earliestEligibleDate) {
    throw new HttpError(
      400,
      `The selected start date ${fromStr} is no longer eligible. Earliest selectable date is ${restrictions.earliestEligibleDate}.`
    );
  }

  return {
    fromStr,
    toStr,
    start: parseDateOnly(fromStr),
    end: parseDateOnly(toStr),
    restrictions,
  };
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

import { HttpError } from "../utils/httpError.js";
import { ATTENDANCE_SESSION_STATUSES } from "../models/Attendance.js";

/** Max inclusive civil days for admin attendance range / history queries. */
export const MAX_ATTENDANCE_RANGE_DAYS = 62;

/** Hard cap when rangeRecords are returned without pagination. */
export const MAX_RANGE_RECORDS_UNBOUNDED = 500;

/** Default page size for paginated range / history lists. */
export const DEFAULT_RANGE_PAGE_SIZE = 25;

/** Employee fields needed for attendance tables and map markers (no customFields). */
export const ADMIN_ATTENDANCE_EMPLOYEE_SELECT =
  "_id employeeCode fullName email job.department job.jobTitle avatar status";

/** Attendance day fields for overview / open-punch resolution (no verification payloads). */
export const ADMIN_ATTENDANCE_DAY_SELECT = [
  "_id",
  "employeeId",
  "date",
  "status",
  "checkIn",
  "checkOut",
  "checkInLocation",
  "checkOutLocation",
  "workingHours",
  "durationMinutes",
  "openSessionId",
  "sessions._id",
  "sessions.status",
  "sessions.sessionType",
  "sessions.checkIn",
  "sessions.checkOut",
  "sessions.checkInLocation",
  "sessions.checkOutLocation",
  "sessions.durationMinutes",
  "sessions.checkInGeofence",
  "sessions.checkOutGeofence",
  "sessions.remoteWorkRequestId",
  "sessions.outsideRadius",
  "sessions.notes",
  "notes",
  "regularization",
].join(" ");

/** LiveTrackingSession fields for admin live/history (exclude breadcrumb arrays). */
export const ADMIN_TRACKING_SESSION_SELECT =
  "_id employeeId status startedAt expiresAt stoppedAt lastLocation deviceInfo";

export function civilDateKey(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "";
  return trimmed.slice(0, 10);
}

/** Inclusive day count between YYYY-MM-DD keys; 0 if invalid. */
export function inclusiveCivilDaySpan(startKey, endKey) {
  const start = civilDateKey(startKey);
  const end = civilDateKey(endKey);
  if (!start || !end || end < start) return 0;
  const a = Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10))
  );
  const b = Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10))
  );
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Ensures admin date ranges stay bounded. Throws HttpError(400) when too wide.
 * @returns {{ startKey: string, endKey: string, daySpan: number }}
 */
export function assertBoundedAttendanceRange(startDate, endDate, maxDays = MAX_ATTENDANCE_RANGE_DAYS) {
  const startKey = civilDateKey(startDate);
  const endKey = civilDateKey(endDate);
  if (!startKey || !endKey) {
    throw new HttpError(400, "startDate and endDate must be YYYY-MM-DD.");
  }
  if (endKey < startKey) {
    throw new HttpError(400, "endDate must be on or after startDate.");
  }
  const daySpan = inclusiveCivilDaySpan(startKey, endKey);
  if (daySpan > maxDays) {
    throw new HttpError(
      400,
      `Date range cannot exceed ${maxDays} days (requested ${daySpan}).`,
      { code: "ATTENDANCE_RANGE_TOO_WIDE", maxDays, daySpan }
    );
  }
  return { startKey, endKey, daySpan };
}

export function parsePagination(page, limit, { defaultLimit = DEFAULT_RANGE_PAGE_SIZE, maxLimit = 100 } = {}) {
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || defaultLimit));
  return {
    page: parsedPage,
    limit: parsedLimit,
    skip: (parsedPage - 1) * parsedLimit,
  };
}

export async function buildScopedEmployeeFilter({ department, hrAccess }) {
  let employeeFilter = { status: { $ne: "TERMINATED" } };
  if (department && department !== "ALL") {
    employeeFilter["job.department"] = department;
  }
  if (hrAccess) {
    const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
    employeeFilter = mergeEmployeeScopeFilter(hrAccess, employeeFilter);
  }
  return employeeFilter;
}

/**
 * Attendance rows that still have an open punch for a business date.
 * Prefer openSessionId / incomplete check-out over loading every employee first.
 */
export function openPunchAttendanceFilter(businessDate) {
  return {
    date: businessDate,
    $or: [
      { openSessionId: { $ne: null } },
      { checkIn: { $ne: null }, checkOut: null },
      { "sessions.status": ATTENDANCE_SESSION_STATUSES.ACTIVE },
    ],
  };
}

/**
 * Active (non-expired) live tracking sessions — company-scoped collection, no roster $in.
 */
export function activeTrackingSessionFilter(now = new Date()) {
  return {
    status: "ACTIVE",
    expiresAt: { $gt: now },
  };
}

/**
 * Load only legacy attendanceLogs for employees missing an Attendance row that day.
 */
export async function loadLegacyAttendanceLogsForMissing({
  Employee,
  employeeIds,
  targetDate,
}) {
  if (!Employee || !employeeIds?.length) return new Map();
  const rows = await Employee.find({ _id: { $in: employeeIds } })
    .select("_id customFields.attendanceLogs")
    .lean();
  const byId = new Map();
  for (const emp of rows) {
    const logs = emp.customFields?.attendanceLogs;
    if (!Array.isArray(logs) || !logs.length) continue;
    const todayLegacy = logs.find((l) => civilDateKey(l.date) === targetDate);
    if (todayLegacy) byId.set(String(emp._id), todayLegacy);
  }
  return byId;
}

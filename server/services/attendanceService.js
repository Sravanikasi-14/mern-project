import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getCompanyBusinessDate } from "../utils/companyTime.js";
import {
  CLIENT_PLATFORMS,
  isWebClientPlatform,
} from "../utils/clientPlatform.js";
import {
  ATTENDANCE_SESSION_STATUSES,
  ATTENDANCE_SESSION_TYPES,
  attendanceSessionsView,
} from "../models/Attendance.js";
import { formatWorkingHours } from "../utils/geo.js";
import {
  applyGeofenceDecision,
  getEmployeeWorkMode,
  loadAttendancePolicy,
  notifyAttendanceStakeholders,
  resolvePunchZone,
  evaluateActiveSessionLocation,
  consumeRemoteWorkApproval,
  releaseRemoteWorkApprovalConsumption,
} from "./attendanceLocationService.js";
export { getCompanyBusinessDate };

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 11000 || err.code === 11001));
}

function conflictActiveSession() {
  return new HttpError(409, "You already have an active attendance session. Punch out before starting another.");
}

function conflictPunchOut() {
  return new HttpError(409, "No active attendance session to punch out of (it may have already been closed).");
}

/**
 * True when the employee is currently punched in (check-in present, no check-out)
 * for the company business date. Uses Attendance first, then legacy customFields.
 */
export async function employeeHasActivePunchIn({
  models,
  employee,
  companyTimezone = "Asia/Kolkata",
}) {
  const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);
  const attendance = await models.Attendance?.findOne({
    employeeId: employee._id,
    date: todayStr,
  }).lean();

  if (attendance?.openSessionId) {
    return true;
  }
  const sessions = attendanceSessionsView(attendance);
  const open = sessions.find((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE || (s.checkIn && !s.checkOut));
  if (open) return true;
  if (attendance?.checkIn && !attendance?.checkOut) {
    return true;
  }
  if (attendance?.checkIn && attendance?.checkOut) {
    return false;
  }

  const logs = employee.customFields?.attendanceLogs || [];
  const todayLog = logs.find((l) => l.date === todayStr);
  if (todayLog?.checkIn && !todayLog?.checkOut) {
    return true;
  }
  return false;
}

/**
 * Stop all ACTIVE live-tracking sessions for an employee (idempotent).
 * Prefer this for punch-out / logout cleanup.
 */
export async function stopActiveLiveTrackingSessions({
  models,
  employee,
  reason = "",
}) {
  const { LiveTrackingSession } = models;
  if (!LiveTrackingSession || !employee?._id) {
    return { success: true, stoppedCount: 0, reason };
  }

  const stoppedAt = new Date();
  const result = await LiveTrackingSession.updateMany(
    { employeeId: employee._id, status: "ACTIVE" },
    { $set: { status: "STOPPED", stoppedAt } }
  );

  const stoppedCount =
    typeof result.modifiedCount === "number"
      ? result.modifiedCount
      : typeof result.nModified === "number"
        ? result.nModified
        : 0;

  return {
    success: true,
    stoppedCount,
    reason,
    message:
      stoppedCount > 0
        ? "Active live tracking session(s) stopped."
        : "No active tracking session to stop.",
  };
}

/**
 * Validates browser geolocation coordinates and metadata.
 * Ensures coordinates are valid finite numbers within geographical bounds,
 * and reported accuracy is positive.
 */
/**
 * Validates browser geolocation coordinates.
 * capturedAt is treated as untrusted client metadata — freshness is enforced
 * separately via assertLocationTimestampFresh against server time.
 */
export function validateLocationCoordinates(location) {
  if (!location || typeof location !== "object") {
    throw new HttpError(400, "Location data is required for attendance verification.");
  }

  const { latitude, longitude, accuracy } = location;

  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new HttpError(
      400,
      `Invalid latitude value '${latitude}'. Latitude must be a finite number between -90 and 90.`
    );
  }

  if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(
      400,
      `Invalid longitude value '${longitude}'. Longitude must be a finite number between -180 and 180.`
    );
  }

  if (accuracy !== undefined && accuracy !== null) {
    if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0) {
      throw new HttpError(
        400,
        `Invalid location accuracy '${accuracy}'. Accuracy must be a positive number in meters.`
      );
    }
  }

  let capturedAt = new Date();
  if (location.capturedAt != null && location.capturedAt !== "") {
    capturedAt = new Date(location.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new HttpError(400, "Invalid location capturedAt timestamp.");
    }
  }

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: typeof accuracy === "number" ? Number(accuracy.toFixed(1)) : null,
    capturedAt,
    address: typeof location.address === "string" ? location.address.trim().slice(0, 255) : "",
    /** True when client omitted capturedAt and server stamped "now". */
    capturedAtInferred: location.capturedAt == null || location.capturedAt === "",
  };
}

/**
 * Reject stale or far-future client location timestamps using server clock.
 * Missing capturedAt (inferred as now) is allowed; malformed already rejected upstream.
 */
export function assertLocationTimestampFresh(validatedLocation, policy, serverNow = new Date()) {
  if (!validatedLocation) return;
  if (validatedLocation.capturedAtInferred) return;

  const rules = policy?.locationRules || {};
  const maxAgeMs = Math.max(30, Number(rules.maxLocationAgeSeconds) || 180) * 1000;
  const maxFutureMs = Math.max(0, Number(rules.maxLocationFutureSkewSeconds) || 60) * 1000;
  const captured = validatedLocation.capturedAt instanceof Date
    ? validatedLocation.capturedAt
    : new Date(validatedLocation.capturedAt);
  if (Number.isNaN(captured.getTime())) {
    throw new HttpError(400, "Invalid location capturedAt timestamp.");
  }
  const deltaMs = serverNow.getTime() - captured.getTime();
  if (deltaMs > maxAgeMs) {
    throw new HttpError(
      400,
      `Location reading is stale (${Math.round(deltaMs / 1000)}s old). Refresh GPS and try again.`
    );
  }
  if (deltaMs < -maxFutureMs) {
    throw new HttpError(400, "Location timestamp is too far in the future. Check device clock and try again.");
  }
}

function recomputeDayTotals(attendance) {
  const sessions = Array.isArray(attendance.sessions) ? attendance.sessions : [];
  let totalMinutes = 0;
  for (const session of sessions) {
    if (session.checkIn && session.checkOut) {
      const mins = Math.max(
        0,
        Math.round((new Date(session.checkOut) - new Date(session.checkIn)) / 60000)
      );
      session.durationMinutes = mins;
      totalMinutes += mins;
    }
  }
  attendance.durationMinutes = totalMinutes;
  attendance.workingHours = totalMinutes > 0 ? formatWorkingHours(totalMinutes) : sessions.some((s) => s.checkIn && !s.checkOut) ? "In Progress" : "";
  const first = sessions[0];
  const lastCompleted = [...sessions].reverse().find((s) => s.checkOut) || null;
  const open = sessions.find((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE && !s.checkOut) || null;
  attendance.checkIn = first?.checkIn || attendance.checkIn || null;
  attendance.checkInLocation = first?.checkInLocation || attendance.checkInLocation || null;
  if (open) {
    attendance.checkOut = null;
    attendance.checkOutLocation = null;
    attendance.openSessionId = open._id;
  } else {
    attendance.checkOut = lastCompleted?.checkOut || null;
    attendance.checkOutLocation = lastCompleted?.checkOutLocation || null;
    attendance.openSessionId = null;
  }
  if (attendance.checkIn) {
    attendance.status = "PRESENT";
  }
}

/**
 * Records an employee punch-in event (starts a new session for the day).
 * Server timestamp is authoritative; client location timestamp is capture metadata.
 *
 * @param {object} options
 * @param {"OFFICE"|"REMOTE"} [options.sessionType]
 * @param {string} [options.remoteWorkRequestId] required for hybrid remote when policy demands approval
 */
/**
 * Atomically open a new ACTIVE session when openSessionId is null.
 * Handles first-of-day insert races via unique (employeeId, date) + retry.
 */
async function atomicallyOpenAttendanceSession({
  Attendance,
  employee,
  todayStr,
  sessionDoc,
  serverNow,
  validatedLocation,
}) {
  const sessionId = sessionDoc._id;
  const filterNoOpen = {
    employeeId: employee._id,
    date: todayStr,
    $or: [{ openSessionId: null }, { openSessionId: { $exists: false } }],
  };
  const updateOpen = {
    $push: { sessions: sessionDoc },
    $set: {
      openSessionId: sessionId,
      checkOut: null,
      checkOutLocation: null,
      workingHours: "In Progress",
      status: "PRESENT",
      schemaVersion: 2,
    },
  };

  // Migrate legacy completed single-pair days into sessions[] (best-effort).
  const legacyDay = await Attendance.findOne({
    employeeId: employee._id,
    date: todayStr,
    checkIn: { $ne: null },
    checkOut: { $ne: null },
    $or: [{ openSessionId: null }, { openSessionId: { $exists: false } }],
  }).lean();
  if (legacyDay && (!Array.isArray(legacyDay.sessions) || legacyDay.sessions.length === 0)) {
    await Attendance.updateOne(
      {
        _id: legacyDay._id,
        $or: [{ openSessionId: null }, { openSessionId: { $exists: false } }],
        $expr: { $eq: [{ $size: { $ifNull: ["$sessions", []] } }, 0] },
      },
      {
        $set: {
          sessions: [
            {
              _id: new mongoose.Types.ObjectId(),
              sessionType: ATTENDANCE_SESSION_TYPES.OFFICE,
              status: ATTENDANCE_SESSION_STATUSES.COMPLETED,
              checkIn: legacyDay.checkIn,
              checkOut: legacyDay.checkOut,
              checkInLocation: legacyDay.checkInLocation || null,
              checkOutLocation: legacyDay.checkOutLocation || null,
              durationMinutes: legacyDay.durationMinutes || 0,
              outsideRadius: false,
            },
          ],
        },
      }
    ).catch(() => {});
  }

  let attendance = await Attendance.findOneAndUpdate(filterNoOpen, updateOpen, { new: true });
  if (attendance) {
    if (!attendance.checkIn) {
      attendance = await Attendance.findOneAndUpdate(
        { _id: attendance._id, $or: [{ checkIn: null }, { checkIn: { $exists: false } }] },
        { $set: { checkIn: serverNow, checkInLocation: validatedLocation } },
        { new: true }
      ) || attendance;
    }
    return attendance;
  }

  const existing = await Attendance.findOne({ employeeId: employee._id, date: todayStr }).lean();
  if (existing?.openSessionId) {
    throw conflictActiveSession();
  }
  // Legacy open day without sessions/openSessionId
  if (existing?.checkIn && !existing?.checkOut && (!existing.sessions || existing.sessions.length === 0)) {
    throw conflictActiveSession();
  }

  try {
    return await Attendance.create({
      companyId: employee.companyId,
      employeeId: employee._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: serverNow,
      checkInLocation: validatedLocation,
      checkOut: null,
      workingHours: "In Progress",
      sessions: [sessionDoc],
      openSessionId: sessionId,
      schemaVersion: 2,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      attendance = await Attendance.findOneAndUpdate(filterNoOpen, updateOpen, { new: true });
      if (attendance) {
        if (!attendance.checkIn) {
          attendance = await Attendance.findOneAndUpdate(
            { _id: attendance._id, $or: [{ checkIn: null }, { checkIn: { $exists: false } }] },
            { $set: { checkIn: serverNow, checkInLocation: validatedLocation } },
            { new: true }
          ) || attendance;
        }
        return attendance;
      }
      throw conflictActiveSession();
    }
    throw err;
  }
}

export async function punchInEmployee({
  models,
  employee,
  location,
  requireLocation = false,
  companyTimezone = "Asia/Kolkata",
  sessionType = ATTENDANCE_SESSION_TYPES.OFFICE,
  remoteWorkRequestId = null,
}) {
  const { Attendance } = models;
  const policy = await loadAttendancePolicy(models);
  const normalizedSessionType =
    String(sessionType || ATTENDANCE_SESSION_TYPES.OFFICE).toUpperCase() === ATTENDANCE_SESSION_TYPES.REMOTE
      ? ATTENDANCE_SESSION_TYPES.REMOTE
      : ATTENDANCE_SESSION_TYPES.OFFICE;

  const serverNow = new Date();
  const todayStr = getCompanyBusinessDate(serverNow, companyTimezone);

  const resolved = await resolvePunchZone({
    models,
    employee,
    policy,
    sessionType: normalizedSessionType,
    workDate: todayStr,
    remoteWorkRequestId,
    companyTimezone,
    now: serverNow,
  });

  /**
   * GPS failure policy (final behavior):
   * - Mandatory geofence (enforce=true) always requires coordinates — WARN cannot bypass geofence.
   * - BLOCK: missing location when punch requires GPS → reject.
   * - WARN/OFF: missing location allowed only when geofence is not enforced and requireLocation is false.
   */
  const gpsFailurePolicy = String(policy?.locationRules?.gpsFailurePolicy || "BLOCK").toUpperCase();
  const needsLocation =
    requireLocation ||
    policy?.locationRules?.requireLocationForPunch !== false ||
    resolved.enforce ||
    (normalizedSessionType === ATTENDANCE_SESSION_TYPES.OFFICE && policy?.locationRules?.geofenceEnabled) ||
    normalizedSessionType === ATTENDANCE_SESSION_TYPES.REMOTE;

  let validatedLocation = null;
  if (!location) {
    if (resolved.enforce) {
      throw new HttpError(400, "Location coordinates are required for this attendance mode.");
    }
    if (needsLocation && gpsFailurePolicy === "BLOCK") {
      throw new HttpError(400, "Location is required to punch in.");
    }
  } else {
    validatedLocation = validateLocationCoordinates(location);
    assertLocationTimestampFresh(validatedLocation, policy, serverNow);
  }

  if (resolved.enforce && !validatedLocation) {
    throw new HttpError(400, "Location coordinates are required for this attendance mode.");
  }

  // Geofence before any persistence / approval consumption.
  let geofenceMeta = null;
  let exception = null;
  if (validatedLocation || resolved.enforce) {
    const decision = await applyGeofenceDecision({
      models,
      employee,
      policy,
      location: validatedLocation,
      zone: resolved.zone,
      enforce: resolved.enforce,
      attendanceId: null,
      sessionId: null,
      workDate: todayStr,
      sessionType: normalizedSessionType,
      phase: "PUNCH_IN",
    });
    geofenceMeta = decision.geofence;
    exception = decision.exception;
  }

  const sessionId = new mongoose.Types.ObjectId();
  const approvalId = resolved.zone?.remoteWorkRequestId || null;
  let approvalConsumed = false;

  if (resolved.requiresApprovalConsumption && approvalId) {
    await consumeRemoteWorkApproval({
      models,
      requestId: approvalId,
      employeeId: employee._id,
      workDate: todayStr,
      sessionId,
      attendanceId: null,
    });
    approvalConsumed = true;
  }

  const sessionDoc = {
    _id: sessionId,
    sessionType: normalizedSessionType,
    status: ATTENDANCE_SESSION_STATUSES.ACTIVE,
    checkIn: serverNow,
    checkOut: null,
    checkInLocation: validatedLocation,
    checkOutLocation: null,
    checkInGeofence: geofenceMeta,
    remoteWorkRequestId: approvalId,
    durationMinutes: 0,
    // Seed monitoring state from punch-in geofence so already-outside punches
    // do not re-fire LEFT on the first tracking update (return still works).
    outsideRadius: Boolean(geofenceMeta?.outside),
    lastOutsideAt: geofenceMeta?.outside ? serverNow : null,
  };

  let attendance;
  try {
    attendance = await atomicallyOpenAttendanceSession({
      Attendance,
      employee,
      todayStr,
      sessionDoc,
      serverNow,
      validatedLocation,
    });
  } catch (err) {
    if (approvalConsumed) {
      await releaseRemoteWorkApprovalConsumption({
        models,
        requestId: approvalId,
        sessionId,
      }).catch(() => {});
    }
    if (err instanceof HttpError) throw err;
    if (err?.name === "VersionError" || isDuplicateKeyError(err)) {
      throw conflictActiveSession();
    }
    throw err;
  }

  if (approvalConsumed && attendance?._id) {
    await models.RemoteWorkRequest.updateOne(
      { _id: approvalId, consumedBySessionId: sessionId },
      { $set: { consumedByAttendanceId: attendance._id } }
    ).catch(() => {});
  }

  if (exception && models.LocationException && sessionId) {
    exception.sessionId = sessionId;
    exception.attendanceId = attendance._id;
    await exception.save().catch(() => {});
  }

  const createdSession =
    attendance.sessions?.find((s) => String(s._id) === String(sessionId)) || sessionDoc;
  const isFirstSessionOfDay = (attendance.sessions || []).length <= 1;

  const customFields = employee.customFields || {};
  const attendanceLogs = [...(customFields.attendanceLogs || [])];
  const existingLogIndex = attendanceLogs.findIndex((log) => log.date === todayStr);
  const logEntry = {
    date: todayStr,
    checkIn: (attendance.checkIn || serverNow).toISOString(),
    checkOut: null,
    status: "PRESENT",
    workingHours: "In Progress",
    checkInLocation: attendance.checkInLocation || validatedLocation,
    sessionCount: attendance.sessions?.length || 1,
  };
  if (existingLogIndex >= 0) {
    attendanceLogs[existingLogIndex] = { ...attendanceLogs[existingLogIndex], ...logEntry };
  } else {
    attendanceLogs.push(logEntry);
  }
  employee.customFields = { ...customFields, attendanceLogs };
  employee.markModified("customFields");

  if (isFirstSessionOfDay) {
    if (!employee.attendance) {
      employee.attendance = {
        totalWorkingDays: 22,
        daysPresent: 1,
        leaveBalance: { casual: 8, sick: 6, earned: 12 },
      };
    } else {
      employee.attendance.daysPresent = (employee.attendance.daysPresent || 0) + 1;
    }
  }
  await employee.save();

  await notifyAttendanceStakeholders({
    models,
    employee,
    title: "Punch-in successful",
    message: `${employee.fullName || "Employee"} punched in (${normalizedSessionType.toLowerCase()} session).`,
    link: "/admin/attendance",
    metadata: { sessionId: String(sessionId), sessionType: normalizedSessionType },
  }).catch(() => {});

  return {
    success: true,
    message: "Punch-in recorded successfully.",
    workMode: getEmployeeWorkMode(employee),
    session: {
      id: String(sessionId),
      sessionType: normalizedSessionType,
      status: ATTENDANCE_SESSION_STATUSES.ACTIVE,
      checkInTime: serverNow.toISOString(),
      geofence: geofenceMeta,
      exceptionId: exception?._id ? String(exception._id) : null,
    },
    today: {
      date: todayStr,
      status: "CHECKED_IN",
      checkInTime: (attendance.checkIn || serverNow).toISOString(),
      checkOutTime: null,
      workingHours: "In Progress",
      sessionCount: attendance.sessions?.length || 1,
    },
    attendance: {
      id: attendance._id,
      date: todayStr,
      status: "CHECKED_IN",
      checkInTime: (attendance.checkIn || serverNow).toISOString(),
      checkInLocation: attendance.checkInLocation || validatedLocation,
      checkOutTime: null,
      workingHours: "In Progress",
      sessions: attendance.sessions,
      openSessionId: String(sessionId),
    },
  };
}

/**
 * Records an employee punch-out event (closes the active session only).
 */
export async function punchOutEmployee({
  models,
  employee,
  location,
  requireLocation = false,
  companyTimezone = "Asia/Kolkata",
}) {
  const { Attendance } = models;
  const policy = await loadAttendancePolicy(models);
  const serverNow = new Date();
  let validatedLocation = null;
  if (location || requireLocation || policy?.locationRules?.requireLocationForPunch !== false) {
    if (location) {
      validatedLocation = validateLocationCoordinates(location);
      assertLocationTimestampFresh(validatedLocation, policy, serverNow);
    }
  }
  const todayStr = getCompanyBusinessDate(serverNow, companyTimezone);

  let attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });

  // Fallback to employee customFields if Attendance record was not found
  const customFields = employee.customFields || {};
  const attendanceLogs = [...(customFields.attendanceLogs || [])];
  const existingLogIndex = attendanceLogs.findIndex((log) => log.date === todayStr);

  if (!attendance && existingLogIndex >= 0 && attendanceLogs[existingLogIndex].checkIn) {
    try {
      attendance = await Attendance.create({
        companyId: employee.companyId,
        employeeId: employee._id,
        date: todayStr,
        status: "PRESENT",
        checkIn: new Date(attendanceLogs[existingLogIndex].checkIn),
        sessions: [],
        schemaVersion: 2,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });
      } else {
        throw err;
      }
    }
  }

  if (!attendance || !attendance.checkIn) {
    throw new HttpError(400, "You must punch in before punching out.");
  }

  // Materialize legacy open single-pair into a session with openSessionId (atomic-ish).
  if (
    (!Array.isArray(attendance.sessions) || attendance.sessions.length === 0) &&
    attendance.checkIn &&
    !attendance.checkOut
  ) {
    const legacySessionId = new mongoose.Types.ObjectId();
    attendance = await Attendance.findOneAndUpdate(
      {
        _id: attendance._id,
        $expr: { $eq: [{ $size: { $ifNull: ["$sessions", []] } }, 0] },
        checkOut: null,
        $or: [{ openSessionId: null }, { openSessionId: { $exists: false } }],
      },
      {
        $set: {
          openSessionId: legacySessionId,
          sessions: [
            {
              _id: legacySessionId,
              sessionType: ATTENDANCE_SESSION_TYPES.OFFICE,
              status: ATTENDANCE_SESSION_STATUSES.ACTIVE,
              checkIn: attendance.checkIn,
              checkOut: null,
              checkInLocation: attendance.checkInLocation || null,
              durationMinutes: 0,
              outsideRadius: false,
            },
          ],
        },
      },
      { new: true }
    ) || (await Attendance.findById(attendance._id));
  }

  const openSessionId = attendance.openSessionId;
  const openSession =
    (attendance.sessions || []).find((s) => String(s._id) === String(openSessionId)) ||
    (attendance.sessions || []).find((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE && !s.checkOut);

  if (!openSession || !openSessionId) {
    throw new HttpError(400, "There is no active attendance session to punch out of.");
  }

  let geofenceMeta = null;
  let exception = null;
  if (validatedLocation) {
    const resolved = await resolvePunchZone({
      models,
      employee,
      policy,
      sessionType: openSession.sessionType || ATTENDANCE_SESSION_TYPES.OFFICE,
      workDate: todayStr,
      remoteWorkRequestId: openSession.remoteWorkRequestId,
      companyTimezone,
      now: serverNow,
      allowConsumedApproval: true,
    }).catch(() => ({ zone: null, enforce: false }));
    const decision = await applyGeofenceDecision({
      models,
      employee,
      policy,
      location: validatedLocation,
      zone: resolved.zone,
      enforce: Boolean(resolved.enforce && policy?.locationRules?.applyGeofenceOnPunchOut !== false),
      attendanceId: attendance._id,
      sessionId: openSession._id,
      workDate: todayStr,
      sessionType: openSession.sessionType || ATTENDANCE_SESSION_TYPES.OFFICE,
      phase: "PUNCH_OUT",
    });
    geofenceMeta = decision.geofence;
    exception = decision.exception;
  }

  const diffMs = Math.max(0, serverNow.getTime() - new Date(openSession.checkIn).getTime());
  const durationMinutes = Math.round(diffMs / 60000);

  // Atomic claim: only the holder of openSessionId can close it.
  const claimed = await Attendance.findOneAndUpdate(
    {
      _id: attendance._id,
      openSessionId,
    },
    {
      $set: {
        openSessionId: null,
        "sessions.$[s].checkOut": serverNow,
        "sessions.$[s].checkOutLocation": validatedLocation,
        "sessions.$[s].checkOutGeofence": geofenceMeta,
        "sessions.$[s].status": ATTENDANCE_SESSION_STATUSES.COMPLETED,
        "sessions.$[s].outsideRadius": false,
        "sessions.$[s].durationMinutes": durationMinutes,
      },
    },
    {
      arrayFilters: [{ "s._id": openSessionId, "s.checkOut": null }],
      new: true,
    }
  );

  if (!claimed) {
    throw conflictPunchOut();
  }

  attendance = claimed;
  recomputeDayTotals(attendance);
  attendance.markModified("sessions");
  try {
    await attendance.save();
  } catch (err) {
    if (err?.name === "VersionError") {
      // Totals may be slightly stale; reload and recompute once.
      const reloaded = await Attendance.findById(attendance._id);
      if (reloaded) {
        recomputeDayTotals(reloaded);
        reloaded.markModified("sessions");
        await reloaded.save();
        attendance = reloaded;
      }
    } else {
      throw err;
    }
  }

  const workingHours = attendance.workingHours || formatWorkingHours(attendance.durationMinutes);
  const closedSession =
    (attendance.sessions || []).find((s) => String(s._id) === String(openSessionId)) || openSession;

  if (existingLogIndex >= 0) {
    attendanceLogs[existingLogIndex] = {
      ...attendanceLogs[existingLogIndex],
      checkOut: serverNow.toISOString(),
      workingHours,
      checkOutLocation: validatedLocation,
      sessionCount: attendance.sessions.length,
      durationMinutes: attendance.durationMinutes,
    };
    employee.customFields = { ...customFields, attendanceLogs };
    employee.markModified("customFields");
    await employee.save();
  }

  let trackingStop = { success: true, stoppedCount: 0 };
  let trackingStopWarning = null;
  try {
    trackingStop = await stopActiveLiveTrackingSessions({
      models,
      employee,
      reason: "punch-out",
    });
  } catch (err) {
    console.error("[attendance] Failed to stop live tracking after punch-out:", err?.message || err);
    trackingStop = { success: false, stoppedCount: 0 };
    trackingStopWarning =
      "Punch-out was recorded, but stopping the live tracking session failed. Please stop tracking manually or contact support.";
  }

  await notifyAttendanceStakeholders({
    models,
    employee,
    title: "Punch-out completed",
    message: `${employee.fullName || "Employee"} punched out. Day total ${workingHours}.`,
    link: "/admin/attendance",
    metadata: { sessionId: String(openSessionId) },
  }).catch(() => {});

  return {
    success: true,
    message: "Punch-out recorded successfully.",
    trackingStopped: trackingStop.success !== false,
    trackingSessionsStopped: trackingStop.stoppedCount || 0,
    ...(trackingStopWarning ? { trackingStopWarning } : {}),
    session: {
      id: String(openSessionId),
      sessionType: closedSession.sessionType || openSession.sessionType,
      status: ATTENDANCE_SESSION_STATUSES.COMPLETED,
      checkInTime: new Date(closedSession.checkIn || openSession.checkIn).toISOString(),
      checkOutTime: serverNow.toISOString(),
      durationMinutes: closedSession.durationMinutes ?? durationMinutes,
      geofence: geofenceMeta,
      exceptionId: exception?._id ? String(exception._id) : null,
    },
    today: {
      date: todayStr,
      status: "CHECKED_OUT",
      checkInTime: attendance.checkIn.toISOString(),
      checkOutTime: serverNow.toISOString(),
      workingHours,
      sessionCount: attendance.sessions.length,
      durationMinutes: attendance.durationMinutes,
    },
    attendance: {
      id: attendance._id,
      date: todayStr,
      status: "CHECKED_OUT",
      checkInTime: attendance.checkIn.toISOString(),
      checkInLocation: attendance.checkInLocation,
      checkOutTime: serverNow.toISOString(),
      checkOutLocation: validatedLocation,
      workingHours,
      durationMinutes: attendance.durationMinutes,
      sessions: attendance.sessions,
      openSessionId: null,
    },
  };
}

/**
 * Returns today's attendance status for an employee.
 */
export async function getEmployeeAttendanceStatus({
  models,
  employee,
  companyTimezone = "Asia/Kolkata",
}) {
  const { Attendance } = models;
  const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);

  let attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });

  let todayStatus = "NOT_CHECKED_IN";
  let checkInTime = null;
  let checkOutTime = null;
  let checkInLocation = null;
  let checkOutLocation = null;
  let workingHours = "--";
  let sessions = [];
  let openSessionId = null;
  let hasActiveSession = false;

  if (attendance) {
    sessions = attendanceSessionsView(attendance).map((s) => ({
      id: String(s._id || ""),
      sessionType: s.sessionType || ATTENDANCE_SESSION_TYPES.OFFICE,
      status: s.status || (s.checkOut ? ATTENDANCE_SESSION_STATUSES.COMPLETED : ATTENDANCE_SESSION_STATUSES.ACTIVE),
      checkInTime: s.checkIn ? new Date(s.checkIn).toISOString() : null,
      checkOutTime: s.checkOut ? new Date(s.checkOut).toISOString() : null,
      durationMinutes: s.durationMinutes || 0,
      outsideRadius: Boolean(s.outsideRadius),
      remoteWorkRequestId: s.remoteWorkRequestId ? String(s.remoteWorkRequestId) : null,
    }));
    hasActiveSession = Boolean(
      attendance.openSessionId ||
        sessions.some((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE && !s.checkOutTime)
    );
    openSessionId = attendance.openSessionId ? String(attendance.openSessionId) : sessions.find((s) => !s.checkOutTime)?.id || null;
    checkInTime = attendance.checkIn ? attendance.checkIn.toISOString() : null;
    checkOutTime = hasActiveSession ? null : attendance.checkOut ? attendance.checkOut.toISOString() : null;
    checkInLocation = attendance.checkInLocation || null;
    checkOutLocation = attendance.checkOutLocation || null;

    if (hasActiveSession) {
      todayStatus = "CHECKED_IN";
      workingHours = "In Progress";
    } else if (attendance.checkIn && attendance.checkOut) {
      todayStatus = "CHECKED_OUT";
      workingHours = attendance.workingHours || "--";
    } else if (attendance.checkIn) {
      todayStatus = "CHECKED_IN";
      workingHours = "In Progress";
    } else if (attendance.status === "ON_LEAVE") {
      todayStatus = "ON_LEAVE";
    }
  } else {
    const logs = employee.customFields?.attendanceLogs || [];
    const todayLog = logs.find((l) => l.date === todayStr);
    if (todayLog) {
      checkInTime = todayLog.checkIn || null;
      checkOutTime = todayLog.checkOut || null;
      checkInLocation = todayLog.checkInLocation || null;
      checkOutLocation = todayLog.checkOutLocation || null;
      if (checkInTime && checkOutTime) {
        todayStatus = "CHECKED_OUT";
        workingHours = todayLog.workingHours || "--";
      } else if (checkInTime) {
        todayStatus = "CHECKED_IN";
        workingHours = "In Progress";
        hasActiveSession = true;
      }
    }
  }

  const workMode = getEmployeeWorkMode(employee);
  return {
    date: todayStr,
    status: todayStatus,
    checkInTime,
    checkOutTime,
    checkInLocation,
    checkOutLocation,
    workingHours,
    durationMinutes: attendance?.durationMinutes || 0,
    sessions,
    openSessionId,
    workMode,
    canPunchIn: !hasActiveSession && todayStatus !== "ON_LEAVE",
    canPunchOut: hasActiveSession || todayStatus === "CHECKED_IN",
    canRequestRemote: workMode === "HYBRID" || workMode === "WFH",
  };
}

function civilDateKey(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "";
  return trimmed.slice(0, 10);
}

function dateInRange(dateKey, startDate, endDate) {
  if (!dateKey) return false;
  const startKey = civilDateKey(startDate) || startDate;
  const endKey = civilDateKey(endDate) || endDate;
  if (startKey && dateKey < startKey) return false;
  if (endKey && dateKey > endKey) return false;
  return true;
}

function formatCollectionAttendance(record) {
  const sessions = attendanceSessionsView(record).map((s) => ({
    id: s._id ? String(s._id) : null,
    sessionType: s.sessionType || ATTENDANCE_SESSION_TYPES.OFFICE,
    status: s.status || (s.checkOut ? ATTENDANCE_SESSION_STATUSES.COMPLETED : ATTENDANCE_SESSION_STATUSES.ACTIVE),
    checkIn: s.checkIn || null,
    checkOut: s.checkOut || null,
    durationMinutes: s.durationMinutes || 0,
    checkInGeofence: s.checkInGeofence || null,
    checkOutGeofence: s.checkOutGeofence || null,
    remoteWorkRequestId: s.remoteWorkRequestId ? String(s.remoteWorkRequestId) : null,
    outsideRadius: Boolean(s.outsideRadius),
    notes: s.notes || "",
  }));
  const incompleteSessions = sessions.filter(
    (s) => s.status === ATTENDANCE_SESSION_STATUSES.INCOMPLETE || (s.checkIn && !s.checkOut)
  );
  return {
    _id: record._id,
    date: record.date,
    status: record.status,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    workingHours: record.workingHours || "--",
    durationMinutes: record.durationMinutes || 0,
    checkInLocation: record.checkInLocation || null,
    checkOutLocation: record.checkOutLocation || null,
    notes: record.notes || "",
    sessions,
    openSessionId: record.openSessionId ? String(record.openSessionId) : null,
    hasIncompleteSessions: incompleteSessions.length > 0,
    regularization: record.regularization || null,
  };
}

function formatLegacyAttendanceLog(log) {
  const date = civilDateKey(log?.date);
  return {
    _id: log._id || date,
    date,
    status: log.status || "PRESENT",
    checkIn: log.checkIn,
    checkOut: log.checkOut,
    workingHours: log.workingHours || "--",
    checkInLocation: log.checkInLocation || null,
    checkOutLocation: log.checkOutLocation || null,
  };
}

/**
 * Retrieves paginated attendance history for an employee with date filtering.
 * Prefers Attendance collection rows and fills missing dates from legacy
 * customFields.attendanceLogs without duplicating the same civil date.
 */
export async function getEmployeeAttendanceHistory({
  models,
  employee,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}) {
  const { Attendance } = models;

  const startKey = civilDateKey(startDate) || (typeof startDate === "string" ? startDate : "");
  const endKey = civilDateKey(endDate) || (typeof endDate === "string" ? endDate : "");

  const filter = { employeeId: employee._id };
  if (startKey && endKey) {
    filter.date = { $gte: startKey, $lte: endKey };
  } else if (startKey) {
    filter.date = { $gte: startKey };
  } else if (endKey) {
    filter.date = { $lte: endKey };
  }

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (parsedPage - 1) * parsedLimit;

  const customLogs = employee.customFields?.attendanceLogs || [];
  const hasLegacyLogs = Array.isArray(customLogs) && customLogs.length > 0;

  // Fast path: no legacy logs — paginate in Mongo instead of loading full history.
  if (!hasLegacyLogs && Attendance) {
    const [total, records] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
    ]);
    return {
      records: records.map((record) => formatCollectionAttendance(record)),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }

  const records = Attendance
    ? await Attendance.find(filter).sort({ date: -1, createdAt: -1 }).lean()
    : [];

  const byDate = new Map();
  for (const record of records) {
    const key = civilDateKey(record.date);
    if (!key || byDate.has(key)) continue;
    byDate.set(key, formatCollectionAttendance(record));
  }

  for (const log of customLogs) {
    const key = civilDateKey(log.date);
    if (!dateInRange(key, startKey, endKey)) continue;
    if (byDate.has(key)) continue;
    byDate.set(key, formatLegacyAttendanceLog(log));
  }

  const merged = [...byDate.values()].sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return 0;
  });

  const total = merged.length;
  const pageSlice = merged.slice(skip, skip + parsedLimit);

  return {
    records: pageSlice,
    pagination: {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit) || 1,
    },
  };
}

/**
 * Starts a time-bounded live tracking session for an employee.
 * Requires an active punch-in. Enforces allowWebTracking for web AuthSessions.
 */
export async function startLiveTrackingSession({
  models,
  employee,
  durationMinutes = 30,
  userAgent = "",
  clientPlatform = CLIENT_PLATFORMS.WEB,
  companyTimezone = "Asia/Kolkata",
}) {
  const { LiveTrackingSession, CompanyHrPolicy } = models;

  const checkedIn = await employeeHasActivePunchIn({
    models,
    employee,
    companyTimezone,
  });
  if (!checkedIn) {
    throw new HttpError(
      400,
      "Live tracking requires an active punch-in. Please punch in before starting tracking.",
      { code: "TRACKING_REQUIRES_PUNCH_IN" }
    );
  }

  if (CompanyHrPolicy) {
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    const allowWebTracking = policy?.locationRules?.allowWebTracking !== false;
    if (!allowWebTracking && isWebClientPlatform(clientPlatform)) {
      throw new HttpError(
        403,
        "Live tracking from the web application is disabled by company policy. Use the mobile app or contact HR.",
        { code: "WEB_TRACKING_DISABLED" }
      );
    }
  }

  // Clean up any existing active sessions (no duplicate ACTIVE rows)
  await LiveTrackingSession.updateMany(
    { employeeId: employee._id, status: "ACTIVE" },
    { $set: { status: "STOPPED", stoppedAt: new Date() } }
  );

  const duration = Math.min(Math.max(parseInt(durationMinutes, 10) || 30, 5), 120);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + duration * 60 * 1000);
  const platform = isWebClientPlatform(clientPlatform)
    ? CLIENT_PLATFORMS.WEB
    : clientPlatform;

  const session = new LiveTrackingSession({
    employeeId: employee._id,
    status: "ACTIVE",
    startedAt,
    expiresAt,
    deviceInfo: { userAgent, clientPlatform: platform },
  });

  await session.save();

  return {
    success: true,
    message: "Live tracking session started.",
    session: {
      id: session._id,
      status: "ACTIVE",
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      remainingMinutes: duration,
    },
  };
}

/**
 * Updates coordinates for an active live tracking session with rate throttling.
 */
export async function updateLiveTrackingLocation({
  models,
  employee,
  location,
  companyTimezone = "Asia/Kolkata",
}) {
  const { LiveTrackingSession } = models;
  const validatedLocation = validateLocationCoordinates(location);

  const session = await LiveTrackingSession.findOne({
    employeeId: employee._id,
    status: "ACTIVE",
  });

  if (!session) {
    throw new HttpError(400, "No active tracking session found. Please start a session first.");
  }

  const now = new Date();
  if (now > session.expiresAt) {
    session.status = "EXPIRED";
    session.stoppedAt = session.expiresAt;
    await session.save();
    throw new HttpError(400, "Live tracking session has expired. Please start a new session.");
  }

  // Refuse updates once punch-out has closed the attendance day (safety net).
  const stillCheckedIn = await employeeHasActivePunchIn({
    models,
    employee,
    companyTimezone,
  });
  if (!stillCheckedIn) {
    await stopActiveLiveTrackingSessions({
      models,
      employee,
      reason: "update-without-active-punch",
    });
    throw new HttpError(
      400,
      "Live tracking stopped because there is no active punch-in.",
      { code: "TRACKING_REQUIRES_PUNCH_IN" }
    );
  }

  // Throttle updates: sample if within 4 seconds of previous update
  if (session.lastLocation?.receivedAt) {
    const elapsedMs = now.getTime() - new Date(session.lastLocation.receivedAt).getTime();
    if (elapsedMs < 4000) {
      return {
        success: true,
        throttled: true,
        message: "Update received (throttled).",
        session: {
          id: session._id,
          status: "ACTIVE",
          expiresAt: session.expiresAt,
        },
      };
    }
  }

  const breadcrumb = {
    ...validatedLocation,
    receivedAt: now,
  };

  session.lastLocation = breadcrumb;
  session.breadcrumbs.push(breadcrumb);
  if (session.breadcrumbs.length > 50) {
    session.breadcrumbs.splice(0, session.breadcrumbs.length - 50);
  }

  await session.save();

  // Geofence monitoring for the open attendance session (deduped enter/exit events).
  let monitor = { changed: false };
  try {
    const todayStr = getCompanyBusinessDate(now, companyTimezone);
    const attendance = await models.Attendance.findOne({
      employeeId: employee._id,
      date: todayStr,
    });
    const open =
      attendance?.sessions?.find((s) => String(s._id) === String(attendance.openSessionId)) ||
      attendance?.sessions?.find((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE && !s.checkOut);
    if (attendance && open) {
      const policy = await loadAttendancePolicy(models);
      monitor = await evaluateActiveSessionLocation({
        models,
        employee,
        attendance,
        session: open,
        location: validatedLocation,
        policy,
      });
      if (monitor.changed) {
        attendance.markModified("sessions");
        await attendance.save();
      }
    }
  } catch (err) {
    console.warn("[attendance] monitoring evaluation skipped:", err?.message || err);
  }

  return {
    success: true,
    throttled: false,
    message: "Location update recorded.",
    monitor,
    session: {
      id: session._id,
      status: "ACTIVE",
      expiresAt: session.expiresAt,
      lastLocation: breadcrumb,
    },
  };
}

/**
 * Stops an active live tracking session (idempotent).
 */
export async function stopLiveTrackingSession({
  models,
  employee,
}) {
  const { LiveTrackingSession } = models;

  const session = await LiveTrackingSession.findOne({
    employeeId: employee._id,
    status: "ACTIVE",
  });

  if (!session) {
    return {
      success: true,
      message: "No active tracking session to stop.",
    };
  }

  const stoppedAt = new Date();
  // updateMany covers concurrent ACTIVE duplicates if any remain
  await LiveTrackingSession.updateMany(
    { employeeId: employee._id, status: "ACTIVE" },
    { $set: { status: "STOPPED", stoppedAt } }
  );

  return {
    success: true,
    message: "Live tracking session stopped.",
    session: {
      id: session._id,
      status: "STOPPED",
      stoppedAt,
    },
  };
}

/**
 * Returns current live tracking status for an employee.
 */
export async function getLiveTrackingStatus({
  models,
  employee,
}) {
  const { LiveTrackingSession } = models;

  const session = await LiveTrackingSession.findOne({
    employeeId: employee._id,
    status: "ACTIVE",
  });

  if (!session) {
    return {
      isTrackingActive: false,
      session: null,
    };
  }

  const now = new Date();
  if (now > session.expiresAt) {
    session.status = "EXPIRED";
    session.stoppedAt = session.expiresAt;
    await session.save();
    return {
      isTrackingActive: false,
      session: null,
    };
  }

  return {
    isTrackingActive: true,
    session: {
      id: session._id,
      status: "ACTIVE",
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      remainingMinutes: Math.max(0, Math.round((session.expiresAt.getTime() - now.getTime()) / 60000)),
      lastLocation: session.lastLocation,
    },
  };
}

/**
 * HR Admin Attendance Overview & Map Data:
 * Aggregates all employee attendance, punch locations, and active live tracking sessions
 * for a specific business date. Optional startDate/endDate also returns rangeRecords.
 */
export async function getAdminAttendanceOverview({
  models,
  companyTimezone = "Asia/Kolkata",
  date,
  startDate,
  endDate,
  department,
  hrAccess = null,
}) {
  const { Attendance, Employee, LiveTrackingSession } = models;
  const rangeStart = civilDateKey(startDate) || civilDateKey(date) || "";
  const rangeEnd = civilDateKey(endDate) || civilDateKey(date) || "";
  const targetDate =
    rangeEnd ||
    rangeStart ||
    date ||
    getCompanyBusinessDate(new Date(), companyTimezone);

  let employeeFilter = { status: { $ne: "TERMINATED" } };
  if (department && department !== "ALL") {
    employeeFilter["job.department"] = department;
  }
  if (hrAccess) {
    const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
    employeeFilter = mergeEmployeeScopeFilter(hrAccess, employeeFilter);
  }

  const employees = await Employee.find(employeeFilter)
    .select("_id employeeCode fullName email job avatar status customFields")
    .lean();

  const employeeIds = employees.map((e) => e._id);

  // Fetch Attendance records for the date
  const attendanceRecords = await Attendance.find({
    employeeId: { $in: employeeIds },
    date: targetDate,
  }).lean();

  const attendanceMap = new Map();
  for (const record of attendanceRecords) {
    attendanceMap.set(String(record.employeeId), record);
  }

  // Fetch active live tracking sessions
  const now = new Date();
  const activeSessions = await LiveTrackingSession.find({
    employeeId: { $in: employeeIds },
    status: "ACTIVE",
    expiresAt: { $gt: now },
  }).lean();

  const trackingMap = new Map();
  for (const session of activeSessions) {
    trackingMap.set(String(session.employeeId), session);
  }

  let presentCount = 0;
  let checkedInCount = 0;
  let checkedOutCount = 0;
  let liveTrackingCount = 0;
  let withLocationCount = 0;

  const employeeOverviews = employees.map((emp) => {
    const empIdStr = String(emp._id);
    const att = attendanceMap.get(empIdStr);
    const tracking = trackingMap.get(empIdStr);

    let status = "NOT_CHECKED_IN";
    let checkInTime = null;
    let checkOutTime = null;
    let checkInLocation = null;
    let checkOutLocation = null;
    let workingHours = "--";

    if (att) {
      checkInTime = att.checkIn ? new Date(att.checkIn).toISOString() : null;
      checkOutTime = att.checkOut ? new Date(att.checkOut).toISOString() : null;
      checkInLocation = att.checkInLocation || null;
      checkOutLocation = att.checkOutLocation || null;

      if (att.checkIn && att.checkOut) {
        status = "CHECKED_OUT";
        checkedOutCount++;
        presentCount++;
        workingHours = att.workingHours || "--";
      } else if (att.checkIn) {
        status = "CHECKED_IN";
        checkedInCount++;
        presentCount++;
        workingHours = att.workingHours || "In Progress";
      } else if (att.status === "ON_LEAVE") {
        status = "ON_LEAVE";
      }
    } else {
      // Fallback to legacy customFields
      const legacyLogs = emp.customFields?.attendanceLogs || [];
      const todayLegacy = legacyLogs.find((l) => l.date === targetDate);
      if (todayLegacy) {
        checkInTime = todayLegacy.checkIn || null;
        checkOutTime = todayLegacy.checkOut || null;
        checkInLocation = todayLegacy.checkInLocation || null;
        checkOutLocation = todayLegacy.checkOutLocation || null;
        if (checkInTime && checkOutTime) {
          status = "CHECKED_OUT";
          checkedOutCount++;
          presentCount++;
          workingHours = todayLegacy.workingHours || "--";
        } else if (checkInTime) {
          status = "CHECKED_IN";
          checkedInCount++;
          presentCount++;
          workingHours = "In Progress";
        }
      }
    }

    const isTrackingActive = Boolean(tracking);
    if (isTrackingActive) {
      liveTrackingCount++;
    }

    if (checkInLocation || checkOutLocation || tracking?.lastLocation) {
      withLocationCount++;
    }

    return {
      employeeId: emp._id,
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      email: emp.email,
      department: emp.job?.department || "General",
      jobTitle: emp.job?.jobTitle || "Team Member",
      attendanceStatus: status,
      checkInTime,
      checkOutTime,
      workingHours,
      checkInLocation,
      checkOutLocation,
      isTrackingActive,
      liveTracking: isTrackingActive
        ? {
            sessionId: tracking._id,
            expiresAt: tracking.expiresAt,
            lastLocation: tracking.lastLocation,
          }
        : null,
    };
  });

  let rangeRecords = [];
  if (rangeStart && rangeEnd && rangeStart !== rangeEnd && Attendance) {
    const rangeAttendance = await Attendance.find({
      employeeId: { $in: employeeIds },
      date: { $gte: rangeStart, $lte: rangeEnd },
    })
      .sort({ date: -1, checkIn: -1 })
      .lean();

    const employeeById = new Map(employees.map((emp) => [String(emp._id), emp]));
    rangeRecords = rangeAttendance.map((record) => {
      const emp = employeeById.get(String(record.employeeId));
      return {
        ...formatCollectionAttendance(record),
        employeeId: record.employeeId,
        employeeCode: emp?.employeeCode || "",
        fullName: emp?.fullName || "",
        department: emp?.job?.department || "General",
        jobTitle: emp?.job?.jobTitle || "Team Member",
      };
    });
  }

  return {
    date: targetDate,
    startDate: rangeStart || targetDate,
    endDate: rangeEnd || targetDate,
    summary: {
      totalEmployees: employees.length,
      presentCount,
      checkedInCount,
      checkedOutCount,
      notCheckedInCount: employees.length - presentCount,
      liveTrackingCount,
      withLocationCount,
      rangeRecordCount: rangeRecords.length,
    },
    employees: employeeOverviews,
    rangeRecords,
  };
}

/**
 * Live ACTIVE sessions for the map, plus optional historical sessions whose
 * startedAt falls in [startDate, endDate]. Does not invent locations.
 */
export async function getAdminTrackingSessions({
  models,
  companyTimezone = "Asia/Kolkata",
  startDate,
  endDate,
  department,
  status = "ALL",
  hrAccess = null,
}) {
  const { Employee, LiveTrackingSession } = models;
  if (!LiveTrackingSession) {
    return {
      live: [],
      history: [],
      summary: { liveCount: 0, historyCount: 0, withLocationCount: 0 },
      startDate: civilDateKey(startDate) || "",
      endDate: civilDateKey(endDate) || "",
      supportsHistory: false,
    };
  }

  let employeeFilter = { status: { $ne: "TERMINATED" } };
  if (department && department !== "ALL") {
    employeeFilter["job.department"] = department;
  }
  if (hrAccess) {
    const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
    employeeFilter = mergeEmployeeScopeFilter(hrAccess, employeeFilter);
  }

  const employees = await Employee.find(employeeFilter)
    .select("_id employeeCode fullName email job status")
    .lean();
  const employeeIds = employees.map((e) => e._id);
  const employeeById = new Map(employees.map((emp) => [String(emp._id), emp]));

  const now = new Date();
  const activeSessions = await LiveTrackingSession.find({
    employeeId: { $in: employeeIds },
    status: "ACTIVE",
    expiresAt: { $gt: now },
  }).lean();

  const live = activeSessions.map((session) => {
    const emp = employeeById.get(String(session.employeeId));
    return {
      sessionId: session._id,
      employeeId: session.employeeId,
      employeeCode: emp?.employeeCode || "",
      fullName: emp?.fullName || "",
      email: emp?.email || "",
      department: emp?.job?.department || "General",
      jobTitle: emp?.job?.jobTitle || "Team Member",
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      stoppedAt: session.stoppedAt,
      lastLocation: session.lastLocation || null,
      isTrackingActive: true,
      breadcrumbCount: Array.isArray(session.breadcrumbs) ? session.breadcrumbs.length : 0,
    };
  });

  const rangeStart = civilDateKey(startDate);
  const rangeEnd = civilDateKey(endDate);
  let history = [];

  if (rangeStart && rangeEnd) {
    const startBound = new Date(`${rangeStart}T00:00:00.000Z`);
    const endBound = new Date(`${rangeEnd}T23:59:59.999Z`);
    const historyFilter = {
      employeeId: { $in: employeeIds },
      startedAt: { $gte: startBound, $lte: endBound },
      status: { $in: ["STOPPED", "EXPIRED", "ACTIVE"] },
    };
    if (status && status !== "ALL") {
      historyFilter.status = String(status).toUpperCase();
    }

    const historySessions = await LiveTrackingSession.find(historyFilter)
      .sort({ startedAt: -1 })
      .limit(200)
      .lean();

    history = historySessions.map((session) => {
      const emp = employeeById.get(String(session.employeeId));
      const isLive =
        session.status === "ACTIVE" && session.expiresAt && new Date(session.expiresAt) > now;
      return {
        sessionId: session._id,
        employeeId: session.employeeId,
        employeeCode: emp?.employeeCode || "",
        fullName: emp?.fullName || "",
        email: emp?.email || "",
        department: emp?.job?.department || "General",
        jobTitle: emp?.job?.jobTitle || "Team Member",
        status: isLive ? "ACTIVE" : session.status,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        stoppedAt: session.stoppedAt,
        lastLocation: session.lastLocation || null,
        isTrackingActive: isLive,
        breadcrumbCount: Array.isArray(session.breadcrumbs) ? session.breadcrumbs.length : 0,
        source: isLive ? "live" : "history",
      };
    });
  }

  const withLocationCount = live.filter((row) => row.lastLocation).length;

  return {
    live,
    history,
    summary: {
      liveCount: live.length,
      historyCount: history.length,
      withLocationCount,
    },
    startDate: rangeStart || "",
    endDate: rangeEnd || "",
    supportsHistory: true,
    companyTimezone,
  };
}

/**
 * HR regularization for exceptional attendance situations.
 * Preserves originals in regularization.auditTrail and does NOT grant remote
 * punch authorization (hybrid remote approval remains mandatory separately).
 */
export async function regularizeAttendanceDay({
  models,
  employeeId,
  actorUser,
  workDate,
  reason,
  closeOpenSession = false,
  checkOutAt = null,
  remarks = "",
}) {
  if (!mongoose.isValidObjectId(String(employeeId))) {
    throw new HttpError(400, "Invalid employee id.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate || ""))) {
    throw new HttpError(400, "workDate must be YYYY-MM-DD.");
  }
  const why = String(reason || "").trim();
  if (why.length < 3) {
    throw new HttpError(400, "A regularization reason is required.");
  }

  const employee = await models.Employee.findById(employeeId);
  if (!employee) throw new HttpError(404, "Employee not found.");

  const attendance = await models.Attendance.findOne({ employeeId, date: workDate });
  if (!attendance) throw new HttpError(404, "No attendance record found for that date.");

  const snapshot = {
    checkIn: attendance.checkIn,
    checkOut: attendance.checkOut,
    durationMinutes: attendance.durationMinutes,
    workingHours: attendance.workingHours,
    openSessionId: attendance.openSessionId,
    sessions: attendanceSessionsView(attendance).map((s) => ({
      id: s._id ? String(s._id) : null,
      sessionType: s.sessionType,
      status: s.status,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      durationMinutes: s.durationMinutes,
    })),
  };

  if (closeOpenSession) {
    const open =
      attendance.sessions?.find((s) => String(s._id) === String(attendance.openSessionId)) ||
      attendance.sessions?.find((s) => s.status === ATTENDANCE_SESSION_STATUSES.ACTIVE && !s.checkOut);
    if (open) {
      const outAt = checkOutAt ? new Date(checkOutAt) : new Date();
      if (Number.isNaN(outAt.getTime())) {
        throw new HttpError(400, "Invalid checkOutAt timestamp.");
      }
      if (open.checkIn && outAt < new Date(open.checkIn)) {
        throw new HttpError(400, "Regularized punch-out cannot be before punch-in.");
      }
      open.checkOut = outAt;
      open.status = ATTENDANCE_SESSION_STATUSES.COMPLETED;
      open.notes = [open.notes, `HR regularized: ${why}`].filter(Boolean).join(" | ").slice(0, 500);
      attendance.openSessionId = null;
      recomputeDayTotals(attendance);
    } else {
      // Mark any check-in-without-out sessions incomplete for HR visibility
      for (const s of attendance.sessions || []) {
        if (s.checkIn && !s.checkOut) {
          s.status = ATTENDANCE_SESSION_STATUSES.INCOMPLETE;
          s.notes = [s.notes, `Flagged incomplete: ${why}`].filter(Boolean).join(" | ").slice(0, 500);
        }
      }
      attendance.markModified("sessions");
    }
  }

  const priorTrail = Array.isArray(attendance.regularization?.auditTrail)
    ? attendance.regularization.auditTrail
    : [];
  attendance.regularization = {
    requestedAt: new Date(),
    requestedBy: actorUser._id,
    reason: why,
    decidedAt: new Date(),
    decidedBy: actorUser._id,
    decision: "APPROVED",
    remarks: String(remarks || "").trim().slice(0, 1000),
    auditTrail: [
      ...priorTrail,
      {
        at: new Date(),
        by: actorUser._id,
        action: closeOpenSession ? "CLOSE_OPEN_SESSION" : "FLAG_REVIEW",
        reason: why,
        original: snapshot,
      },
    ],
  };
  attendance.markModified("regularization");
  await attendance.save();

  await notifyAttendanceStakeholders({
    models,
    employee,
    title: "Attendance regularized",
    message: `HR regularized attendance for ${workDate}: ${why}`,
    link: "/admin/attendance",
    metadata: { workDate, action: closeOpenSession ? "CLOSE_OPEN_SESSION" : "FLAG_REVIEW" },
  }).catch(() => {});

  return formatCollectionAttendance(attendance);
}

import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import {
  ATTENDANCE_SESSION_TYPES,
} from "../models/Attendance.js";
import {
  LOCATION_EXCEPTION_STATUSES,
  LOCATION_EXCEPTION_TYPES,
} from "../models/LocationException.js";
import { REMOTE_WORK_STATUSES } from "../models/RemoteWorkRequest.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { isInsideGeofence, toFiniteNumber } from "../utils/geo.js";
import {
  getCompanyBusinessDate,
  getCompanyMinutesOfDay,
  parseHmToMinutes,
} from "../utils/companyTime.js";

export function getEmployeeWorkMode(employee) {
  const mode = String(employee?.job?.workArrangement?.mode || "OFFICE").toUpperCase();
  if (mode === "WFH" || mode === "HYBRID") return mode;
  return "OFFICE";
}

export async function loadAttendancePolicy(models) {
  if (!models?.CompanyHrPolicy) return null;
  return getActiveCompanyHrPolicy(models.CompanyHrPolicy);
}

function officeZoneFromPolicy(policy) {
  const rules = policy?.locationRules || {};
  const lat = toFiniteNumber(rules.officeLatitude);
  const lng = toFiniteNumber(rules.officeLongitude);
  if (lat == null || lng == null) return null;
  return {
    label: rules.officeName || "Office",
    address: rules.officeAddress || "",
    latitude: lat,
    longitude: lng,
    radiusMeters: toFiniteNumber(rules.geofenceRadiusMeters) || 200,
    kind: "OFFICE",
  };
}

function homeZoneFromEmployee(employee, policy) {
  const home = employee?.job?.workArrangement?.homeLocation || {};
  const lat = toFiniteNumber(home.latitude);
  const lng = toFiniteNumber(home.longitude);
  if (lat == null || lng == null) return null;
  const workRules = policy?.workArrangementRules || {};
  return {
    label: home.label || "Home",
    address: home.address || "",
    latitude: lat,
    longitude: lng,
    radiusMeters: toFiniteNumber(home.radiusMeters) || toFiniteNumber(workRules.wfhRadiusMeters) || 200,
    kind: "HOME",
    approved: Boolean(home.approved),
  };
}

/**
 * Ensure server "now" falls within the approved remote sessionPeriod on workDate
 * in the company timezone. Empty period = all-day. Malformed/reversed → reject.
 */
export function assertWithinApprovedSessionPeriod({
  sessionPeriod,
  workDate,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  const startRaw = sessionPeriod?.startTime;
  const endRaw = sessionPeriod?.endTime;
  const hasStart = startRaw != null && String(startRaw).trim() !== "";
  const hasEnd = endRaw != null && String(endRaw).trim() !== "";

  if (!hasStart && !hasEnd) {
    return { ok: true, reason: "ALL_DAY" };
  }
  if (hasStart !== hasEnd) {
    throw new HttpError(400, "Approved remote session period is incomplete (both start and end times are required).");
  }

  const startMins = parseHmToMinutes(startRaw);
  const endMins = parseHmToMinutes(endRaw);
  if (startMins == null || endMins == null) {
    throw new HttpError(400, "Approved remote session period is malformed. Use HH:mm (24-hour).");
  }
  if (endMins <= startMins) {
    throw new HttpError(400, "Approved remote session period is invalid (end must be after start on the same day).");
  }

  const todayInTz = getCompanyBusinessDate(now, companyTimezone);
  if (todayInTz !== workDate) {
    throw new HttpError(400, `Remote approval is for ${workDate}, but company date is ${todayInTz}.`);
  }

  const nowMins = getCompanyMinutesOfDay(now, companyTimezone);
  if (nowMins == null) {
    throw new HttpError(400, "Unable to evaluate session period in the company timezone.");
  }
  if (nowMins < startMins || nowMins > endMins) {
    throw new HttpError(
      400,
      `Remote punch-in is only allowed between ${String(startRaw).trim()} and ${String(endRaw).trim()} (company timezone).`
    );
  }
  return { ok: true, reason: "WITHIN_PERIOD", nowMins, startMins, endMins };
}

function unconsumedApprovalFilter() {
  return {
    $or: [{ consumedAt: null }, { consumedAt: { $exists: false } }],
  };
}

/**
 * Atomically mark an approved remote request as consumed by one session.
 * Failed punch-ins must call releaseRemoteWorkApprovalConsumption.
 */
export async function consumeRemoteWorkApproval({
  models,
  requestId,
  employeeId,
  workDate,
  sessionId,
  attendanceId = null,
}) {
  if (!models?.RemoteWorkRequest) {
    throw new HttpError(500, "Remote work requests are not available.");
  }
  const updated = await models.RemoteWorkRequest.findOneAndUpdate(
    {
      _id: requestId,
      employeeId,
      workDate,
      status: REMOTE_WORK_STATUSES.APPROVED,
      ...unconsumedApprovalFilter(),
    },
    {
      $set: {
        consumedAt: new Date(),
        consumedBySessionId: sessionId,
        consumedByAttendanceId: attendanceId || null,
      },
    },
    { new: true }
  );
  if (!updated) {
    throw new HttpError(
      409,
      "This remote-work approval is unavailable (already used, cancelled, rejected, or not approved)."
    );
  }
  return updated;
}

/** Roll back consumption if session creation fails after consume. */
export async function releaseRemoteWorkApprovalConsumption({ models, requestId, sessionId }) {
  if (!models?.RemoteWorkRequest || !requestId || !sessionId) return null;
  return models.RemoteWorkRequest.findOneAndUpdate(
    {
      _id: requestId,
      consumedBySessionId: sessionId,
      status: REMOTE_WORK_STATUSES.APPROVED,
    },
    {
      $set: {
        consumedAt: null,
        consumedBySessionId: null,
        consumedByAttendanceId: null,
      },
    },
    { new: true }
  );
}

/**
 * Resolve which geofence applies for a punch of the given session type.
 * Does not consume approvals — caller must consume after geofence validation succeeds.
 */
export async function resolvePunchZone({
  models,
  employee,
  policy,
  sessionType,
  workDate,
  remoteWorkRequestId = null,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
  /** When true, allow already-consumed approvals for geofence at punch-out / monitoring. */
  allowConsumedApproval = false,
}) {
  const mode = getEmployeeWorkMode(employee);
  const locationRules = policy?.locationRules || {};
  const workRules = policy?.workArrangementRules || {};

  if (sessionType === ATTENDANCE_SESSION_TYPES.OFFICE) {
    if (mode === "WFH" && !allowConsumedApproval) {
      throw new HttpError(400, "WFH employees cannot start an office attendance session.");
    }
    if (!locationRules.geofenceEnabled) {
      return { zone: null, enforce: false, reason: "OFFICE_GEOFENCE_DISABLED" };
    }
    const zone = officeZoneFromPolicy(policy);
    if (!zone) {
      throw new HttpError(
        400,
        "Office geofencing is enabled but no office coordinates are configured. Contact HR."
      );
    }
    return { zone, enforce: true, reason: "OFFICE" };
  }

  // REMOTE
  if (mode === "OFFICE" && !allowConsumedApproval) {
    throw new HttpError(400, "Office employees cannot start a remote attendance session.");
  }

  if (mode === "HYBRID" || (allowConsumedApproval && remoteWorkRequestId)) {
    const requireApproval = workRules.hybridRemoteApprovalRequired !== false;
    if (requireApproval || allowConsumedApproval) {
      if (!remoteWorkRequestId || !mongoose.isValidObjectId(String(remoteWorkRequestId))) {
        if (allowConsumedApproval) {
          return { zone: null, enforce: false, reason: "NO_REMOTE_REF" };
        }
        throw new HttpError(
          400,
          "An approved remote-work request is required before starting a remote session."
        );
      }
      const requestFilter = {
        _id: remoteWorkRequestId,
        employeeId: employee._id,
        workDate,
        status: REMOTE_WORK_STATUSES.APPROVED,
      };
      if (!allowConsumedApproval) {
        Object.assign(requestFilter, unconsumedApprovalFilter());
      }
      const request = await models.RemoteWorkRequest.findOne(requestFilter).lean();
      if (!request) {
        throw new HttpError(
          400,
          "No usable approved remote-work request found for today (missing, consumed, or not approved)."
        );
      }
      if (!allowConsumedApproval) {
        assertWithinApprovedSessionPeriod({
          sessionPeriod: request.sessionPeriod,
          workDate,
          companyTimezone,
          now,
        });
      }
      return {
        zone: {
          label: request.location?.label || "Remote",
          address: request.location?.address || "",
          latitude: request.location.latitude,
          longitude: request.location.longitude,
          radiusMeters: request.location.radiusMeters || workRules.wfhRadiusMeters || 200,
          kind: "APPROVED_REMOTE",
          remoteWorkRequestId: request._id,
        },
        enforce: true,
        reason: "HYBRID_APPROVED_REMOTE",
        remoteWorkRequest: request,
        requiresApprovalConsumption: !allowConsumedApproval,
      };
    }
  }

  // WFH (or hybrid without approval requirement)
  const wfhMode = workRules.wfhLocationMode || "WFH_UNRESTRICTED";
  if (wfhMode === "WFH_UNRESTRICTED") {
    return { zone: null, enforce: false, reason: "WFH_UNRESTRICTED" };
  }

  const home = homeZoneFromEmployee(employee, policy);
  if (!home) {
    throw new HttpError(
      400,
      "WFH location validation requires a registered home location. Update your home location or contact HR."
    );
  }
  if (workRules.wfhRequireHomeApproval && !home.approved) {
    throw new HttpError(400, "Your home location must be approved by HR before remote punch-in.");
  }
  return { zone: home, enforce: true, reason: "WFH_APPROVED_LOCATION" };
}

export function evaluateLocationAgainstZone({ location, zone, maxAccuracyMeters }) {
  if (!zone) {
    return {
      ok: true,
      outside: false,
      lowAccuracy: false,
      distanceMeters: null,
      radiusMeters: null,
      reason: "NO_ZONE",
      label: "",
      centerLatitude: null,
      centerLongitude: null,
    };
  }

  if (!location) {
    return {
      ok: false,
      outside: false,
      lowAccuracy: false,
      distanceMeters: null,
      radiusMeters: zone.radiusMeters,
      reason: "MISSING_LOCATION",
      label: zone.label,
      centerLatitude: zone.latitude,
      centerLongitude: zone.longitude,
      accuracy: null,
      maxAccuracyMeters,
    };
  }

  const accuracy = toFiniteNumber(location?.accuracy);
  const lowAccuracy =
    maxAccuracyMeters != null && accuracy != null && accuracy > maxAccuracyMeters;

  const result = isInsideGeofence({
    latitude: location.latitude,
    longitude: location.longitude,
    centerLatitude: zone.latitude,
    centerLongitude: zone.longitude,
    radiusMeters: zone.radiusMeters,
    accuracyMeters: accuracy,
  });

  const outside = !result.ok;
  let reason = "INSIDE";
  if (outside && lowAccuracy) reason = "OUTSIDE_RADIUS";
  else if (outside) reason = result.reason || "OUTSIDE_RADIUS";
  else if (lowAccuracy) reason = "LOW_ACCURACY";

  return {
    ok: !outside && !lowAccuracy,
    outside,
    lowAccuracy,
    distanceMeters: result.distanceMeters,
    radiusMeters: result.radiusMeters,
    reason,
    label: zone.label,
    centerLatitude: zone.latitude,
    centerLongitude: zone.longitude,
    accuracy,
    maxAccuracyMeters,
  };
}

async function createLocationExceptionDoc({
  models,
  employee,
  attendanceId,
  sessionId,
  workDate,
  sessionType,
  exceptionType,
  location,
  zone,
  distanceMeters,
  message,
}) {
  if (!models.LocationException || !location) return null;
  return models.LocationException.create({
    companyId: employee.companyId,
    employeeId: employee._id,
    attendanceId,
    sessionId,
    workDate,
    sessionType,
    type: exceptionType,
    status: LOCATION_EXCEPTION_STATUSES.OPEN,
    occurredAt: new Date(),
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      address: location.address || "",
    },
    permittedLocation: {
      label: zone.label,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusMeters: zone.radiusMeters,
    },
    distanceMeters,
    message,
    dedupeKey: `${employee._id}:${workDate}:${sessionId || "none"}:${exceptionType}:open`,
  });
}

/**
 * Apply accuracyFailurePolicy and outOfRadiusPolicy independently.
 * LOW_ACCURACY never inherits outOfRadiusPolicy; OUTSIDE never inherits accuracyFailurePolicy.
 */
export async function applyGeofenceDecision({
  models,
  employee,
  policy,
  location,
  zone,
  enforce,
  attendanceId = null,
  sessionId = null,
  workDate,
  sessionType,
  phase = "PUNCH_IN",
}) {
  const locationRules = policy?.locationRules || {};
  const workRules = policy?.workArrangementRules || {};
  const outPolicy = String(locationRules.outOfRadiusPolicy || "BLOCK").toUpperCase();
  const maxAccuracy =
    sessionType === ATTENDANCE_SESSION_TYPES.REMOTE
      ? toFiniteNumber(workRules.wfhMaxAccuracyMeters) || toFiniteNumber(locationRules.maxAccuracyMeters) || 150
      : toFiniteNumber(locationRules.maxAccuracyMeters) || 100;
  const accuracyFailurePolicy = String(locationRules.accuracyFailurePolicy || "WARN").toUpperCase();

  if (!enforce || !zone) {
    return {
      geofence: {
        ok: true,
        distanceMeters: null,
        radiusMeters: zone?.radiusMeters ?? null,
        reason: "NOT_ENFORCED",
        label: zone?.label || "",
        centerLatitude: zone?.latitude ?? null,
        centerLongitude: zone?.longitude ?? null,
      },
      exception: null,
    };
  }

  const evaluation = evaluateLocationAgainstZone({
    location,
    zone,
    maxAccuracyMeters: maxAccuracy,
  });

  const phaseLabel = phase === "PUNCH_OUT" ? "Punch-out" : "Punch-in";
  let exception = null;

  // 1) Accuracy policy (independent of out-of-radius)
  if (evaluation.lowAccuracy) {
    const message = `GPS accuracy ${evaluation.accuracy}m exceeds the permitted ${maxAccuracy}m.`;
    if (accuracyFailurePolicy === "BLOCK") {
      throw new HttpError(400, `${phaseLabel} rejected: ${message}`);
    }
    if (accuracyFailurePolicy === "WARN") {
      exception = await createLocationExceptionDoc({
        models,
        employee,
        attendanceId,
        sessionId,
        workDate,
        sessionType,
        exceptionType: LOCATION_EXCEPTION_TYPES.LOW_ACCURACY,
        location,
        zone,
        distanceMeters: evaluation.distanceMeters,
        message,
      });
    }
  }

  // 2) Out-of-radius policy (independent of accuracy)
  if (evaluation.outside && outPolicy !== "OFF") {
    const message = `Location is ${evaluation.distanceMeters}m from ${zone.label} (allowed ${zone.radiusMeters}m).`;
    if (outPolicy === "BLOCK") {
      throw new HttpError(400, `${phaseLabel} rejected: ${message}`);
    }
    if (outPolicy === "WARN") {
      const outsideType =
        phase === "PUNCH_OUT"
          ? LOCATION_EXCEPTION_TYPES.PUNCH_OUTSIDE
          : LOCATION_EXCEPTION_TYPES.OUTSIDE_GEOFENCE;
      exception = await createLocationExceptionDoc({
        models,
        employee,
        attendanceId,
        sessionId,
        workDate,
        sessionType,
        exceptionType: outsideType,
        location,
        zone,
        distanceMeters: evaluation.distanceMeters,
        message,
      });
      // Punch-time outside WARN must notify immediately — live tracking is optional/manual
      // and must not be required for the first out-of-radius alert.
      await notifyAttendanceStakeholders({
        models,
        employee,
        title:
          phase === "PUNCH_OUT"
            ? "Punch-out outside permitted area"
            : "Punch-in outside permitted area",
        message: `${employee.fullName || "Employee"} ${
          phase === "PUNCH_OUT" ? "punched out" : "punched in"
        } ${evaluation.distanceMeters}m from ${zone.label} (allowed ${zone.radiusMeters}m).`,
        link: "/admin/attendance?tab=exceptions",
        metadata: {
          sessionId: sessionId ? String(sessionId) : null,
          type: outsideType,
          phase,
          distanceMeters: evaluation.distanceMeters,
        },
      }).catch(() => {});
    }
  }

  return {
    geofence: {
      ok: evaluation.ok,
      distanceMeters: evaluation.distanceMeters,
      radiusMeters: evaluation.radiusMeters,
      reason: evaluation.reason,
      label: zone.label,
      centerLatitude: zone.latitude,
      centerLongitude: zone.longitude,
      lowAccuracy: evaluation.lowAccuracy,
      outside: evaluation.outside,
      accuracy: evaluation.accuracy,
    },
    exception,
  };
}

export async function notifyAttendanceStakeholders({
  models,
  employee,
  title,
  message,
  link = "/admin/attendance",
  metadata = {},
}) {
  if (!models?.Notification) return;
  const payload = {
    title,
    message,
    type: NOTIFICATION_TYPES.ATTENDANCE,
    link,
    metadata: {
      employeeId: String(employee._id),
      ...metadata,
    },
  };

  // Employee (linked user)
  if (employee.userId) {
    await models.Notification.create({
      ...payload,
      userId: employee.userId,
      role: null,
    });
  }

  // HR role broadcast within tenant
  await models.Notification.create({
    ...payload,
    userId: null,
    role: "HR_ADMIN",
  });
}

/**
 * Evaluate a tracking location update against the active session zone.
 * Creates one OPEN outside exception and notifies once per continuous violation.
 */
export async function evaluateActiveSessionLocation({
  models,
  employee,
  attendance,
  session,
  location,
  policy,
}) {
  if (!policy?.workArrangementRules?.monitoringEnabled) {
    return { changed: false };
  }
  if (!session || session.status !== "ACTIVE") return { changed: false };

  const workDate = attendance.date;
  const resolved = await resolvePunchZone({
    models,
    employee,
    policy,
    sessionType: session.sessionType,
    workDate,
    remoteWorkRequestId: session.remoteWorkRequestId,
    allowConsumedApproval: true,
  });

  if (!resolved.enforce || !resolved.zone) return { changed: false };

  const geofence = evaluateLocationAgainstZone({
    location,
    zone: resolved.zone,
    maxAccuracyMeters:
      session.sessionType === ATTENDANCE_SESSION_TYPES.REMOTE
        ? policy.workArrangementRules?.wfhMaxAccuracyMeters
        : policy.locationRules?.maxAccuracyMeters,
  });

  const wasOutside = Boolean(session.outsideRadius);
  const isOutside = Boolean(geofence.outside);

  if (!wasOutside && isOutside) {
    session.outsideRadius = true;
    session.lastOutsideAt = new Date();
    const dedupeKey = `${employee._id}:${workDate}:${session._id}:OUTSIDE`;
    const existingOpen = await models.LocationException.findOne({
      dedupeKey,
      status: LOCATION_EXCEPTION_STATUSES.OPEN,
      type: LOCATION_EXCEPTION_TYPES.OUTSIDE_GEOFENCE,
    }).lean();
    if (!existingOpen) {
      await models.LocationException.create({
        companyId: employee.companyId,
        employeeId: employee._id,
        attendanceId: attendance._id,
        sessionId: session._id,
        workDate,
        sessionType: session.sessionType,
        type: LOCATION_EXCEPTION_TYPES.OUTSIDE_GEOFENCE,
        status: LOCATION_EXCEPTION_STATUSES.OPEN,
        occurredAt: new Date(),
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address || "",
        },
        permittedLocation: {
          label: resolved.zone.label,
          latitude: resolved.zone.latitude,
          longitude: resolved.zone.longitude,
          radiusMeters: resolved.zone.radiusMeters,
        },
        distanceMeters: geofence.distanceMeters,
        message: `Left permitted area (${geofence.distanceMeters}m from ${resolved.zone.label}).`,
        dedupeKey,
      });
      await notifyAttendanceStakeholders({
        models,
        employee,
        title: "Outside permitted work area",
        message: `${employee.fullName || "Employee"} moved outside the permitted radius during an active session.`,
        link: "/admin/attendance?tab=exceptions",
        metadata: { sessionId: String(session._id), type: "OUTSIDE_GEOFENCE" },
      });
    }
    return { changed: true, event: "LEFT" };
  }

  if (wasOutside && !isOutside) {
    session.outsideRadius = false;
    session.lastInsideAt = new Date();
    const dedupeKey = `${employee._id}:${workDate}:${session._id}:OUTSIDE`;
    await models.LocationException.updateMany(
      {
        dedupeKey,
        status: LOCATION_EXCEPTION_STATUSES.OPEN,
        type: LOCATION_EXCEPTION_TYPES.OUTSIDE_GEOFENCE,
      },
      {
        $set: {
          returnedAt: new Date(),
          status: LOCATION_EXCEPTION_STATUSES.REVIEWED,
          type: LOCATION_EXCEPTION_TYPES.OUTSIDE_GEOFENCE,
        },
      }
    );
    await models.LocationException.create({
      companyId: employee.companyId,
      employeeId: employee._id,
      attendanceId: attendance._id,
      sessionId: session._id,
      workDate,
      sessionType: session.sessionType,
      type: LOCATION_EXCEPTION_TYPES.RETURNED_INSIDE,
      status: LOCATION_EXCEPTION_STATUSES.REVIEWED,
      occurredAt: new Date(),
      returnedAt: new Date(),
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        address: location.address || "",
      },
      permittedLocation: {
        label: resolved.zone.label,
        latitude: resolved.zone.latitude,
        longitude: resolved.zone.longitude,
        radiusMeters: resolved.zone.radiusMeters,
      },
      distanceMeters: geofence.distanceMeters,
      message: `Returned inside permitted area (${resolved.zone.label}).`,
      dedupeKey: `${dedupeKey}:return:${Date.now()}`,
    });
    await notifyAttendanceStakeholders({
      models,
      employee,
      title: "Returned to permitted work area",
      message: `${employee.fullName || "Employee"} returned inside the permitted radius.`,
      link: "/admin/attendance?tab=exceptions",
      metadata: { sessionId: String(session._id), type: "RETURNED_INSIDE" },
    });
    return { changed: true, event: "RETURNED" };
  }

  return { changed: false };
}

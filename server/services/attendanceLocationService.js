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
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { USER_ROLES } from "../models/User.js";
import { isInsideGeofence, toFiniteNumber } from "../utils/geo.js";
import {
  getCompanyBusinessDate,
  getCompanyMinutesOfDay,
  parseHmToMinutes,
} from "../utils/companyTime.js";

/**
 * Active Company Admin + HR Admin user IDs in the current tenant DB.
 * Notifications must target these system User documents (never Employee ids).
 */
export async function resolveHrPortalNotificationRecipients(models) {
  if (!models?.User) return [];
  try {
    const users = await models.User.find({
      isActive: { $ne: false },
      role: { $in: [USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN] },
    })
      .select("_id role email fullName")
      .lean();
    return Array.isArray(users) ? users : [];
  } catch (err) {
    console.error("Failed to resolve HR portal notification recipients:", err.message);
    return [];
  }
}

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
    const gpsMethodEnabled = Boolean(policy?.attendanceVerification?.gps?.enabled);
    const legacyGeofenceEnabled = Boolean(locationRules.geofenceEnabled);
    // GPS verification method must enforce the office zone even when the legacy
    // locationRules.geofenceEnabled toggle was left off (common misconfiguration).
    if (!legacyGeofenceEnabled && !gpsMethodEnabled) {
      return { zone: null, enforce: false, reason: "OFFICE_GEOFENCE_DISABLED" };
    }
    const zone = officeZoneFromPolicy(policy);
    if (!zone) {
      throw new HttpError(
        400,
        "Office geofencing is enabled but no office coordinates are configured. Contact HR."
      );
    }
    return {
      zone,
      enforce: true,
      reason: legacyGeofenceEnabled ? "OFFICE" : "OFFICE_GPS_VERIFICATION",
    };
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

  if (evaluation.reason === "MISSING_LOCATION" || !location) {
    const message = `${phaseLabel} rejected: location coordinates are required for geofence enforcement.`;
    await recordGeofencePunchRejection({
      models,
      employee,
      phase,
      workDate,
      sessionType,
      reason: "MISSING_LOCATION",
      geofenceDecision: "BLOCK",
      distanceMeters: null,
      radiusMeters: zone.radiusMeters,
      accuracyMeters: null,
      zoneLabel: zone.label,
      employeeMessage:
        "Your attendance attempt was rejected because location could not be verified against the permitted office area.",
      hrMessage: `${employee.fullName || "Employee"} attempted to ${
        phase === "PUNCH_OUT" ? "punch out" : "punch in"
      } without usable location coordinates. The attendance request was rejected.`,
    }).catch(() => {});
    throw new HttpError(400, message);
  }

  // 1) Accuracy policy (independent of out-of-radius)
  if (evaluation.lowAccuracy) {
    const message = `GPS accuracy ${evaluation.accuracy}m exceeds the permitted ${maxAccuracy}m.`;
    if (accuracyFailurePolicy === "BLOCK") {
      await recordGeofencePunchRejection({
        models,
        employee,
        phase,
        workDate,
        sessionType,
        reason: "LOW_ACCURACY",
        geofenceDecision: "BLOCK",
        distanceMeters: evaluation.distanceMeters,
        radiusMeters: zone.radiusMeters,
        accuracyMeters: evaluation.accuracy,
        zoneLabel: zone.label,
        employeeMessage:
          "Your attendance attempt was rejected because GPS accuracy is too low to verify your office location.",
        hrMessage: `${employee.fullName || "Employee"} attempted to ${
          phase === "PUNCH_OUT" ? "punch out" : "punch in"
        } with GPS accuracy outside policy limits. The attendance request was rejected.`,
      }).catch(() => {});
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
      await recordGeofencePunchRejection({
        models,
        employee,
        phase,
        workDate,
        sessionType,
        reason: "OUTSIDE_RADIUS",
        geofenceDecision: "BLOCK",
        distanceMeters: evaluation.distanceMeters,
        radiusMeters: zone.radiusMeters,
        accuracyMeters: evaluation.accuracy,
        zoneLabel: zone.label,
        employeeMessage:
          "Your attendance attempt was rejected because you are outside the permitted office location.",
        hrMessage: `Attendance rejected: ${employee.fullName || "Employee"} attempted to ${
          phase === "PUNCH_OUT" ? "punch out" : "punch in"
        } outside the permitted office location.`,
      }).catch((err) => {
        console.error("Geofence rejection notify failed:", err?.message || err);
      });
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
        } outside the permitted office geofence.`,
        link: "/admin/attendance?workspace=exceptions",
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

  await deliverHrPortalAttendanceNotifications({
    models,
    title,
    message,
    link,
    metadata: payload.metadata,
    excludeUserIds: employee.userId ? [String(employee.userId)] : [],
  });
}

/**
 * Deliver attendance alerts to active HR portal operators in this tenant.
 * Prefers personal User-id notifications; falls back to role broadcasts.
 */
async function deliverHrPortalAttendanceNotifications({
  models,
  title,
  message,
  link = "/admin/attendance",
  metadata = {},
  excludeUserIds = [],
}) {
  if (!models?.Notification) return { delivered: 0 };

  const exclude = new Set((excludeUserIds || []).map(String));
  const recipients = (await resolveHrPortalNotificationRecipients(models)).filter(
    (u) => u?._id && !exclude.has(String(u._id))
  );

  if (recipients.length) {
    let delivered = 0;
    for (const recipient of recipients) {
      await models.Notification.create({
        userId: recipient._id,
        role: null,
        title,
        message,
        type: NOTIFICATION_TYPES.ATTENDANCE,
        link,
        metadata: {
          ...metadata,
          recipientRole: recipient.role,
          delivery: "PERSONAL",
        },
      });
      delivered += 1;
    }
    return { delivered, mode: "personal" };
  }

  // Fallback when no active portal operators exist yet (keeps a durable record).
  await models.Notification.create({
    userId: null,
    role: USER_ROLES.HR_ADMIN,
    title,
    message,
    type: NOTIFICATION_TYPES.ATTENDANCE,
    link,
    metadata: { ...metadata, delivery: "ROLE_BROADCAST" },
  });
  await models.Notification.create({
    userId: null,
    role: USER_ROLES.COMPANY_ADMIN,
    title,
    message,
    type: NOTIFICATION_TYPES.ATTENDANCE,
    link,
    metadata: { ...metadata, delivery: "ROLE_BROADCAST" },
  });
  return { delivered: 2, mode: "role_broadcast" };
}

/**
 * Audit + notify a blocked geofence punch without creating an attendance session.
 * Dedupes employee/HR notifications within the same minute for the same reason.
 * Does not include exact GPS coordinates in notification bodies.
 */
export async function recordGeofencePunchRejection({
  models,
  employee,
  phase = "PUNCH_IN",
  workDate = null,
  sessionType = ATTENDANCE_SESSION_TYPES.OFFICE,
  reason = "OUTSIDE_RADIUS",
  geofenceDecision = "BLOCK",
  distanceMeters = null,
  radiusMeters = null,
  accuracyMeters = null,
  zoneLabel = "",
  employeeMessage,
  hrMessage,
}) {
  const attemptedAt = new Date();
  const minuteKey = attemptedAt.toISOString().slice(0, 16);
  const dedupeKey = `geofence_reject:${String(employee._id)}:${phase}:${reason}:${minuteKey}`;

  if (models?.AuditLog) {
    try {
      await models.AuditLog.create({
        actorUserId: employee.userId || null,
        actorEmail: employee.email || "unknown",
        actorRole: "EMPLOYEE",
        action: AUDIT_ACTIONS.ATTENDANCE_PUNCH_REJECTED,
        targetType: "Attendance",
        targetId: employee._id,
        changes: {
          companyId: employee.companyId ? String(employee.companyId) : null,
          employeeId: String(employee._id),
          employeeName: employee.fullName || "",
          phase,
          sessionType,
          workDate,
          attemptedAt: attemptedAt.toISOString(),
          geofenceDecision,
          reason,
          distanceMeters: distanceMeters ?? null,
          radiusMeters: radiusMeters ?? null,
          accuracyMeters: accuracyMeters ?? null,
          zoneLabel: zoneLabel || "",
          // Exact coordinates intentionally omitted from ordinary rejection records.
        },
      });
    } catch (err) {
      console.error("Attendance rejection audit failed:", err.message);
    }
  }

  if (!models?.Notification) return { dedupeKey, notified: false };

  try {
    const existing = await models.Notification.findOne({
      "metadata.dedupeKey": dedupeKey,
    })
      .select("_id")
      .lean();
    if (existing) {
      return { dedupeKey, notified: false, deduped: true };
    }

    const actionLabel = phase === "PUNCH_OUT" ? "punch out" : "punch in";
    const empName = employee.fullName || "Employee";
    const empMsg =
      employeeMessage ||
      "Your attendance attempt was rejected because you are outside the permitted office location.";
    const hrMsg =
      hrMessage ||
      `Attendance rejected: ${empName} attempted to ${actionLabel} outside the permitted office location.`;

    const sharedMeta = {
      dedupeKey,
      employeeId: String(employee._id),
      phase,
      reason,
      geofenceDecision,
      workDate,
      attemptedAt: attemptedAt.toISOString(),
      distanceMeters: distanceMeters ?? null,
      radiusMeters: radiusMeters ?? null,
      // No exact lat/lng in notifications.
    };

    if (employee.userId) {
      await models.Notification.create({
        userId: employee.userId,
        role: null,
        title: "Attendance rejected",
        message: empMsg,
        type: NOTIFICATION_TYPES.ATTENDANCE,
        link: "/employee/attendance",
        metadata: sharedMeta,
      });
    }

    const hrDelivery = await deliverHrPortalAttendanceNotifications({
      models,
      title: "Attendance rejected — outside geofence",
      message: hrMsg,
      link: "/admin/attendance",
      metadata: sharedMeta,
      excludeUserIds: employee.userId ? [String(employee.userId)] : [],
    });

    return {
      dedupeKey,
      notified: true,
      hrDelivered: hrDelivery?.delivered || 0,
      hrDeliveryMode: hrDelivery?.mode || null,
    };
  } catch (err) {
    // Notification failures must never affect punch rejection / audit.
    console.error("Geofence rejection notification failed:", err.message);
    return { dedupeKey, notified: false, error: err.message };
  }
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
        link: "/admin/attendance?workspace=exceptions",
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
      link: "/admin/attendance?workspace=exceptions",
      metadata: { sessionId: String(session._id), type: "RETURNED_INSIDE" },
    });
    return { changed: true, event: "RETURNED" };
  }

  return { changed: false };
}

/** HR-facing punch eligibility codes — mirrors resolvePunchZone / period gates. */
export const PUNCH_ELIGIBILITY_CODES = Object.freeze({
  REMOTE_PUNCH_ALLOWED: "REMOTE_PUNCH_ALLOWED",
  OFFICE_LOCATION_REQUIRED: "OFFICE_LOCATION_REQUIRED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  EXCEPTION_PENDING_REVIEW: "EXCEPTION_PENDING_REVIEW",
  REMOTE_NOT_AUTHORIZED: "REMOTE_NOT_AUTHORIZED",
});

function eligibilityResult({
  code,
  label,
  detail,
  tone,
  remotePunchAllowed,
  officePunchAllowed,
  workMode,
  extras = {},
}) {
  return {
    code,
    label,
    detail,
    tone,
    remotePunchAllowed: Boolean(remotePunchAllowed),
    officePunchAllowed: Boolean(officePunchAllowed),
    workMode,
    exceptionGrantsRemote: false,
    ...extras,
  };
}

/**
 * Evaluate approved session period without throwing (for HR eligibility display).
 */
export function evaluateApprovedSessionPeriod({
  sessionPeriod,
  workDate,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  try {
    const result = assertWithinApprovedSessionPeriod({
      sessionPeriod,
      workDate,
      companyTimezone,
      now,
    });
    return { ok: true, reason: result.reason };
  } catch (error) {
    return {
      ok: false,
      reason: "OUTSIDE_PERIOD",
      message: error?.message || "Outside the approved remote session window.",
    };
  }
}

/**
 * Derive punch eligibility for a remote-work request from the same rules as resolvePunchZone.
 * Does not mutate state and never treats a location exception as authorization.
 */
export function describeRemoteRequestPunchEligibility({
  request,
  employee,
  policy = null,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  const mode = getEmployeeWorkMode(employee);
  const workRules = policy?.workArrangementRules || {};
  const requireApproval = workRules.hybridRemoteApprovalRequired !== false;
  const status = String(request?.status || "").toUpperCase();
  const today = getCompanyBusinessDate(now, companyTimezone);
  const workDate = request?.workDate || null;
  const periodLabel = (() => {
    const start = request?.sessionPeriod?.startTime || "";
    const end = request?.sessionPeriod?.endTime || "";
    if (!start && !end) return "all day";
    if (start && end) return `${start}–${end}`;
    return "incomplete period";
  })();

  if (mode === "OFFICE") {
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.OFFICE_LOCATION_REQUIRED,
      label: "Office location required",
      detail: "Work mode is Office. Remote punch-in/out is not authorized for this employee.",
      tone: "blocked",
      remotePunchAllowed: false,
      officePunchAllowed: true,
      workMode: mode,
      extras: { requestStatus: status, workDate, companyDate: today },
    });
  }

  if (mode === "WFH") {
    const homeOk =
      workRules.wfhLocationMode !== "WFH_APPROVED_LOCATION" ||
      Boolean(employee?.job?.workArrangement?.homeLocation?.approved) ||
      workRules.wfhRequireHomeApproval !== true;
    if (!homeOk) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
        label: "Remote attendance not authorized",
        detail: "WFH home location must be approved by HR before remote punch-in.",
        tone: "blocked",
        remotePunchAllowed: false,
        officePunchAllowed: false,
        workMode: mode,
        extras: { requestStatus: status, workDate, companyDate: today },
      });
    }
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED,
      label: "Remote punch-in/out allowed",
      detail:
        status === "APPROVED"
          ? `WFH work mode permits remote attendance. Request for ${workDate || "the work date"} is approved (${periodLabel}).`
          : "WFH work mode permits remote attendance under company WFH rules. This request does not change that.",
      tone: "ok",
      remotePunchAllowed: true,
      officePunchAllowed: false,
      workMode: mode,
      extras: { requestStatus: status, workDate, companyDate: today },
    });
  }

  // HYBRID
  if (status === "PENDING") {
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.APPROVAL_PENDING,
      label: "Approval pending",
      detail: requireApproval
        ? `Hybrid remote punch-in requires HR approval for ${workDate || "the requested date"} (${periodLabel}).`
        : "Hybrid remote approval is optional under current policy; remote punch may follow WFH-like rules without this request.",
      tone: "pending",
      remotePunchAllowed: !requireApproval,
      officePunchAllowed: true,
      workMode: mode,
      extras: { requestStatus: status, workDate, companyDate: today, hybridRemoteApprovalRequired: requireApproval },
    });
  }

  if (status === "REJECTED" || status === "CANCELLED") {
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
      label: "Remote attendance not authorized",
      detail:
        status === "REJECTED"
          ? "This remote-work request was rejected and cannot authorize remote punch-in/out."
          : "This remote-work request was cancelled and cannot authorize remote punch-in/out.",
      tone: "blocked",
      remotePunchAllowed: false,
      officePunchAllowed: true,
      workMode: mode,
      extras: { requestStatus: status, workDate, companyDate: today },
    });
  }

  if (status === "APPROVED") {
    if (request?.consumedAt) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
        label: "Remote attendance not authorized",
        detail: "This approval already authorized one remote session and cannot be reused.",
        tone: "warn",
        remotePunchAllowed: false,
        officePunchAllowed: true,
        workMode: mode,
        extras: {
          requestStatus: status,
          workDate,
          companyDate: today,
          consumedAt: request.consumedAt,
          consumedBySessionId: request.consumedBySessionId
            ? String(request.consumedBySessionId)
            : null,
        },
      });
    }

    if (!requireApproval) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED,
        label: "Remote punch-in/out allowed",
        detail: "Hybrid remote approval is not required by policy. Remote punch follows WFH-like location rules.",
        tone: "ok",
        remotePunchAllowed: true,
        officePunchAllowed: true,
        workMode: mode,
        extras: { requestStatus: status, workDate, companyDate: today, hybridRemoteApprovalRequired: false },
      });
    }

    if (workDate && workDate !== today) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
        label: "Remote attendance not authorized",
        detail:
          workDate > today
            ? `Approved for ${workDate}; company date is ${today}. Remote punch is only allowed on the approved date.`
            : `Approval was for ${workDate} (past). It no longer authorizes remote punch.`,
        tone: "warn",
        remotePunchAllowed: false,
        officePunchAllowed: true,
        workMode: mode,
        extras: { requestStatus: status, workDate, companyDate: today },
      });
    }

    const period = evaluateApprovedSessionPeriod({
      sessionPeriod: request?.sessionPeriod,
      workDate,
      companyTimezone,
      now,
    });
    if (!period.ok) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
        label: "Remote attendance not authorized",
        detail: period.message || `Outside the approved window (${periodLabel}) for ${workDate}.`,
        tone: "warn",
        remotePunchAllowed: false,
        officePunchAllowed: true,
        workMode: mode,
        extras: { requestStatus: status, workDate, companyDate: today },
      });
    }

    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED,
      label: "Remote punch-in/out allowed",
      detail: `Approved unused request for ${workDate} (${periodLabel}). Employee must punch REMOTE with this request and stay inside the approved location radius.`,
      tone: "ok",
      remotePunchAllowed: true,
      officePunchAllowed: true,
      workMode: mode,
      extras: { requestStatus: status, workDate, companyDate: today, hybridRemoteApprovalRequired: true },
    });
  }

  return eligibilityResult({
    code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
    label: "Remote attendance not authorized",
    detail: "No usable remote-work authorization applies.",
    tone: "blocked",
    remotePunchAllowed: false,
    officePunchAllowed: mode !== "WFH",
    workMode: mode,
    extras: { requestStatus: status, workDate, companyDate: today },
  });
}

/**
 * Location exceptions never grant remote rights. Punch eligibility reflects work mode
 * and any separate approved remote-work request — not the exception review status.
 */
export function describeLocationExceptionPunchEligibility({
  exception,
  employee,
  policy = null,
  activeRemoteApproval = null,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  const mode = getEmployeeWorkMode(employee);
  const exceptionStatus = String(exception?.status || "").toUpperCase();
  const type = String(exception?.type || "");
  const openNote =
    exceptionStatus === "OPEN"
      ? " Exception is pending HR review."
      : "";

  if (mode === "OFFICE") {
    return eligibilityResult({
      code:
        exceptionStatus === "OPEN"
          ? PUNCH_ELIGIBILITY_CODES.EXCEPTION_PENDING_REVIEW
          : PUNCH_ELIGIBILITY_CODES.OFFICE_LOCATION_REQUIRED,
      label:
        exceptionStatus === "OPEN"
          ? "Exception pending review"
          : "Office location required",
      detail: `Work mode is Office — punch must follow office geofence rules. Location exceptions never authorize remote attendance.${openNote}`,
      tone: exceptionStatus === "OPEN" ? "pending" : "blocked",
      remotePunchAllowed: false,
      officePunchAllowed: true,
      workMode: mode,
      extras: {
        exceptionStatus,
        exceptionType: type,
        sessionType: exception?.sessionType || null,
      },
    });
  }

  if (mode === "WFH") {
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED,
      label: "Remote punch-in/out allowed",
      detail: `Allowed under WFH work mode. This ${type || "location"} exception does not change remote authorization.${openNote}`,
      tone: exceptionStatus === "OPEN" ? "pending" : "ok",
      remotePunchAllowed: true,
      officePunchAllowed: false,
      workMode: mode,
      extras: {
        exceptionStatus,
        exceptionType: type,
        sessionType: exception?.sessionType || null,
      },
    });
  }

  // HYBRID — remote only if a separate approved request currently authorizes it
  if (activeRemoteApproval) {
    const fromRequest = describeRemoteRequestPunchEligibility({
      request: activeRemoteApproval,
      employee,
      policy,
      companyTimezone,
      now,
    });
    if (fromRequest.remotePunchAllowed) {
      return eligibilityResult({
        code: PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED,
        label: "Remote punch-in/out allowed",
        detail: `Authorized by approved remote-work request for ${activeRemoteApproval.workDate} — not by this location exception.${openNote}`,
        tone: exceptionStatus === "OPEN" ? "pending" : "ok",
        remotePunchAllowed: true,
        officePunchAllowed: true,
        workMode: mode,
        extras: {
          exceptionStatus,
          exceptionType: type,
          sessionType: exception?.sessionType || null,
          authorizingRequestId: String(activeRemoteApproval._id || activeRemoteApproval.id || ""),
        },
      });
    }
  }

  if (exceptionStatus === "OPEN") {
    return eligibilityResult({
      code: PUNCH_ELIGIBILITY_CODES.EXCEPTION_PENDING_REVIEW,
      label: "Exception pending review",
      detail:
        "Open geofence/accuracy exception under review. It does not authorize remote punch-in/out. Hybrid remote punch still needs an approved remote-work request.",
      tone: "pending",
      remotePunchAllowed: false,
      officePunchAllowed: true,
      workMode: mode,
      extras: {
        exceptionStatus,
        exceptionType: type,
        sessionType: exception?.sessionType || null,
      },
    });
  }

  return eligibilityResult({
    code: PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED,
    label: "Remote attendance not authorized",
    detail:
      "No usable approved remote-work request authorizes remote punch today. Reviewing or regularizing a location exception never grants remote attendance.",
    tone: "blocked",
    remotePunchAllowed: false,
    officePunchAllowed: true,
    workMode: mode,
    extras: {
      exceptionStatus,
      exceptionType: type,
      sessionType: exception?.sessionType || null,
    },
  });
}

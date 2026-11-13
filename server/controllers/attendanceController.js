import {
  punchInEmployee,
  punchOutEmployee,
  getEmployeeAttendanceStatus,
  getEmployeeAttendanceHistory,
  startLiveTrackingSession,
  updateLiveTrackingLocation,
  stopLiveTrackingSession,
  getLiveTrackingStatus,
  getAdminAttendanceOverview,
  getAdminTrackingSessions,
  regularizeAttendanceDay,
} from "../services/attendanceService.js";
import {
  submitRemoteWorkRequest,
  listMyRemoteWorkRequests,
  cancelRemoteWorkRequest,
  listAdminRemoteWorkRequests,
  decideRemoteWorkRequest,
  listLocationExceptions,
  reviewLocationException,
} from "../services/remoteWorkRequestService.js";
import {
  extractRequestAuthToken,
  resolveClientPlatformFromAuthSession,
} from "../utils/clientPlatform.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { HttpError } from "../utils/httpError.js";

async function getTargetEmployee(req) {
  const { Employee } = req.auth.models;
  const employee = await Employee.findOne({
    $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
  });

  if (!employee) {
    throw new HttpError(404, "Employee record not found for the authenticated user.");
  }

  return employee;
}

function extractLocationPayload(req) {
  if (req.body?.location !== undefined) {
    if (!req.body.location || typeof req.body.location !== "object" || Array.isArray(req.body.location)) {
      throw new HttpError(400, "Location payload must be an object containing latitude and longitude.");
    }
    return req.body.location;
  }
  if (req.body?.latitude !== undefined || req.body?.longitude !== undefined) {
    if (req.body.latitude === undefined || req.body.longitude === undefined) {
      throw new HttpError(400, "Both latitude and longitude are required when providing coordinates.");
    }
    return {
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracy: req.body.accuracy,
      capturedAt: req.body.capturedAt,
      address: req.body.address,
    };
  }
  return null;
}

function extractWifiEvidence(req) {
  const raw = req.body?.wifiEvidence;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "wifiEvidence must be an object.");
  }
  // Never accept client-side verification booleans as proof (wifiVerified, etc.).
  // challengeId/nonce are server-issued; validated/consumed on the backend.
  // wifiEnabled / clientReason are device state signals used only to reject
  // (never to approve). Cached SSID while the radio is off must not pass.
  return {
    ssid: raw.ssid,
    bssid: raw.bssid,
    capturedAt: raw.capturedAt,
    platform: raw.platform,
    pluginVersion: raw.pluginVersion,
    challengeId: raw.challengeId,
    challengeNonce: raw.challengeNonce || raw.nonce,
    clientReason: raw.clientReason,
    wifiEnabled: raw.wifiEnabled,
  };
}

function extractFaceImage(req) {
  const img = req.body?.faceImageBase64 ?? req.body?.faceImage;
  if (img === undefined || img === null || img === "") return null;
  if (typeof img !== "string") throw new HttpError(400, "faceImageBase64 must be a string.");
  return img;
}

function extractClientClaims(req) {
  return {
    faceVerified: req.body?.faceVerified,
    wifiVerified: req.body?.wifiVerified,
    gpsVerified: req.body?.gpsVerified,
  };
}

/**
 * Platform is resolved only from the AuthSession (informational / audit).
 * Never trusts body, query, or client-supplied platform headers.
 * Must never be treated as device authenticity proof for Wi-Fi.
 */
async function resolvePunchClientPlatform(req) {
  const token = extractRequestAuthToken(req) || req.cookies?.[getAuthCookieName()];
  return resolveClientPlatformFromAuthSession(req.auth.models, token);
}

/**
 * POST /api/employees/me/attendance/punch-in
 * Strictly requires browser geolocation coordinates.
 */
export async function punchIn(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const location = extractLocationPayload(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";

    if (!location) {
      throw new HttpError(400, "Location coordinates (latitude and longitude) are required to punch in.");
    }

    const sessionType = String(req.body?.sessionType || "OFFICE").toUpperCase() === "REMOTE" ? "REMOTE" : "OFFICE";
    const remoteWorkRequestId = req.body?.remoteWorkRequestId || null;

    const clientPlatform = await resolvePunchClientPlatform(req);
    const result = await punchInEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: true,
      companyTimezone,
      sessionType,
      remoteWorkRequestId,
      wifiEvidence: extractWifiEvidence(req),
      faceImageBase64: extractFaceImage(req),
      clientPlatform,
      clientClaims: extractClientClaims(req),
      companyId: req.auth.company?._id,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/me/attendance/punch-out
 * Strictly requires browser geolocation coordinates.
 */
export async function punchOut(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const location = extractLocationPayload(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";

    if (!location) {
      throw new HttpError(400, "Location coordinates (latitude and longitude) are required to punch out.");
    }

    const clientPlatform = await resolvePunchClientPlatform(req);
    const result = await punchOutEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: true,
      companyTimezone,
      wifiEvidence: extractWifiEvidence(req),
      faceImageBase64: extractFaceImage(req),
      clientPlatform,
      clientClaims: extractClientClaims(req),
      companyId: req.auth.company?._id,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Check-In endpoint supporting both new location payload and legacy automated test callers.
 */
export async function handleCheckIn(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const location = extractLocationPayload(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const sessionType = String(req.body?.sessionType || "OFFICE").toUpperCase() === "REMOTE" ? "REMOTE" : "OFFICE";
    const remoteWorkRequestId = req.body?.remoteWorkRequestId || null;

    const clientPlatform = await resolvePunchClientPlatform(req);
    const result = await punchInEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: Boolean(location),
      companyTimezone,
      sessionType,
      remoteWorkRequestId,
      wifiEvidence: extractWifiEvidence(req),
      faceImageBase64: extractFaceImage(req),
      clientPlatform,
      clientClaims: extractClientClaims(req),
      companyId: req.auth.company?._id,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Check-Out endpoint supporting both new location payload and legacy automated test callers.
 */
export async function handleCheckOut(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const location = extractLocationPayload(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";

    const clientPlatform = await resolvePunchClientPlatform(req);
    const result = await punchOutEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: Boolean(location),
      companyTimezone,
      wifiEvidence: extractWifiEvidence(req),
      faceImageBase64: extractFaceImage(req),
      clientPlatform,
      clientClaims: extractClientClaims(req),
      companyId: req.auth.company?._id,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/me/attendance/status
 */
export async function getStatus(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";

    const status = await getEmployeeAttendanceStatus({
      models: req.auth.models,
      employee,
      companyTimezone,
    });

    res.status(200).json({
      success: true,
      attendance: status,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/me/attendance/history
 */
export async function getHistory(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const { startDate, endDate, page, limit } = req.query;

    const history = await getEmployeeAttendanceHistory({
      models: req.auth.models,
      employee,
      startDate,
      endDate,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      ...history,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/me/tracking/start
 */
export async function startTracking(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const { durationMinutes } = req.body || {};
    const userAgent = req.headers["user-agent"] || "";
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const token = extractRequestAuthToken(req, getAuthCookieName());
    const clientPlatform = await resolveClientPlatformFromAuthSession(
      req.auth.models,
      token
    );

    const result = await startLiveTrackingSession({
      models: req.auth.models,
      employee,
      durationMinutes,
      userAgent,
      clientPlatform,
      companyTimezone,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/me/tracking/update
 */
export async function updateTrackingLocation(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const location = extractLocationPayload(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";

    if (!location) {
      throw new HttpError(400, "Location coordinates are required for live tracking update.");
    }

    const result = await updateLiveTrackingLocation({
      models: req.auth.models,
      employee,
      location,
      companyTimezone,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/me/tracking/stop
 */
export async function stopTracking(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);

    const result = await stopLiveTrackingSession({
      models: req.auth.models,
      employee,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/me/tracking/status
 */
export async function getTrackingStatusHandler(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);

    const result = await getLiveTrackingStatus({
      models: req.auth.models,
      employee,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/attendance/overview
 * Restricted to HR_ADMIN within their company tenant.
 * Platform Admin is explicitly blocked from routine employee location access.
 */
function assertCompanyAttendanceAccess(req) {
  if (req.auth.user.role === "PLATFORM_ADMIN") {
    throw new HttpError(403, "Platform Admins do not have access to company employee location details.");
  }
  if (req.auth.user.role !== "HR_ADMIN" && req.auth.user.role !== "COMPANY_ADMIN") {
    throw new HttpError(403, "Access denied. Only company HR portal roles may view attendance.");
  }
}

export async function getAdminAttendanceOverviewHandler(req, res, next) {
  try {
    assertCompanyAttendanceAccess(req);

    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const { date, startDate, endDate, department, page, limit, search } = req.query;

    const overview = await getAdminAttendanceOverview({
      models: req.auth.models,
      companyTimezone,
      date,
      startDate,
      endDate,
      department,
      hrAccess: req.hrAccess,
      page: page != null && page !== "" ? page : null,
      limit: limit != null && limit !== "" ? limit : null,
      search: search || "",
    });

    res.status(200).json({
      success: true,
      ...overview,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/attendance/tracking-sessions
 * Live open-punch / ACTIVE sessions plus optional historical sessions in a date range.
 */
export async function getAdminTrackingSessionsHandler(req, res, next) {
  try {
    assertCompanyAttendanceAccess(req);

    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const { startDate, endDate, department, status, historyPage, historyLimit, page, limit } =
      req.query;

    const payload = await getAdminTrackingSessions({
      models: req.auth.models,
      companyTimezone,
      startDate,
      endDate,
      department,
      status,
      hrAccess: req.hrAccess,
      historyPage: historyPage ?? page ?? null,
      historyLimit: historyLimit ?? limit ?? null,
    });

    res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/attendance/employee/:id
 * Allows HR portal roles to fetch an individual employee's attendance history for drawer inspection.
 */
export async function getAdminEmployeeAttendanceHistoryHandler(req, res, next) {
  try {
    assertCompanyAttendanceAccess(req);

    const { Employee } = req.auth.models;
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      throw new HttpError(404, "Employee not found.");
    }

    const { startDate, endDate, page, limit } = req.query;

    const history = await getEmployeeAttendanceHistory({
      models: req.auth.models,
      employee,
      startDate,
      endDate,
      page,
      limit: limit || 100,
    });

    res.status(200).json({
      success: true,
      employee: {
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        email: employee.email,
        phone: employee.personalPhone || employee.phone || "",
        avatar: employee.avatar || "",
        department: employee.job?.department || "General",
        jobTitle: employee.job?.jobTitle || "Team Member",
      },
      ...history,
    });
  } catch (error) {
    next(error);
  }
}

export async function postRemoteWorkRequest(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const request = await submitRemoteWorkRequest({
      models: req.auth.models,
      employee,
      user: req.auth.user,
      payload: req.body || {},
      companyTimezone,
    });
    res.status(201).json({ success: true, request });
  } catch (error) {
    next(error);
  }
}

export async function getMyRemoteWorkRequests(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const requests = await listMyRemoteWorkRequests({
      models: req.auth.models,
      employee,
      status: req.query.status || null,
    });
    res.json({ success: true, requests });
  } catch (error) {
    next(error);
  }
}

export async function cancelMyRemoteWorkRequest(req, res, next) {
  try {
    const employee = await getTargetEmployee(req);
    const request = await cancelRemoteWorkRequest({
      models: req.auth.models,
      employee,
      requestId: req.params.id,
    });
    res.json({ success: true, request });
  } catch (error) {
    next(error);
  }
}

export async function getAdminRemoteWorkRequestsHandler(req, res, next) {
  try {
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const requests = await listAdminRemoteWorkRequests({
      models: req.auth.models,
      status: req.query.status || "PENDING",
      companyTimezone,
    });
    res.json({ success: true, requests, companyTimezone });
  } catch (error) {
    next(error);
  }
}

export async function decideRemoteWorkRequestHandler(req, res, next) {
  try {
    const request = await decideRemoteWorkRequest({
      models: req.auth.models,
      requestId: req.params.id,
      actorUser: req.auth.user,
      decision: req.body?.decision,
      remarks: req.body?.remarks,
    });
    res.json({ success: true, request });
  } catch (error) {
    next(error);
  }
}

export async function getLocationExceptionsHandler(req, res, next) {
  try {
    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const exceptions = await listLocationExceptions({
      models: req.auth.models,
      status: req.query.status || "OPEN",
      companyTimezone,
    });
    res.json({ success: true, exceptions, companyTimezone });
  } catch (error) {
    next(error);
  }
}

export async function reviewLocationExceptionHandler(req, res, next) {
  try {
    const exception = await reviewLocationException({
      models: req.auth.models,
      exceptionId: req.params.id,
      actorUser: req.auth.user,
      status: req.body?.status,
      remarks: req.body?.remarks,
    });
    res.json({ success: true, exception });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployeeWorkArrangementHandler(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const employee = await Employee.findById(req.params.id);
    if (!employee) throw new HttpError(404, "Employee not found.");
    const mode = String(req.body?.mode || "").toUpperCase();
    if (!["OFFICE", "WFH", "HYBRID"].includes(mode)) {
      throw new HttpError(400, "Work arrangement mode must be OFFICE, WFH, or HYBRID.");
    }
    employee.job = employee.job || {};
    employee.job.workArrangement = employee.job.workArrangement || {};
    employee.job.workArrangement.mode = mode;
    employee.job.workArrangement.updatedAt = new Date();
    employee.job.workArrangement.updatedBy = req.auth.user._id;
    if (req.body?.homeLocation) {
      const home = req.body.homeLocation;
      employee.job.workArrangement.homeLocation = {
        label: String(home.label || "Home").trim().slice(0, 120),
        address: String(home.address || "").trim().slice(0, 255),
        latitude: home.latitude != null ? Number(home.latitude) : null,
        longitude: home.longitude != null ? Number(home.longitude) : null,
        radiusMeters: home.radiusMeters != null ? Number(home.radiusMeters) : 200,
        approved: Boolean(home.approved),
        approvedAt: home.approved ? new Date() : null,
        approvedBy: home.approved ? req.auth.user._id : null,
      };
    }
    employee.markModified("job");
    await employee.save();
    res.json({
      success: true,
      workArrangement: employee.job.workArrangement,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/attendance/employees/:id/regularize
 * Closes or flags incomplete sessions with an auditable reason.
 * Does not authorize hybrid remote punch-in.
 */
export async function regularizeAttendanceHandler(req, res, next) {
  try {
    const attendance = await regularizeAttendanceDay({
      models: req.auth.models,
      employeeId: req.params.id,
      actorUser: req.auth.user,
      workDate: req.body?.workDate,
      reason: req.body?.reason,
      closeOpenSession: Boolean(req.body?.closeOpenSession),
      checkOutAt: req.body?.checkOutAt || null,
      remarks: req.body?.remarks || "",
    });
    res.json({ success: true, attendance });
  } catch (error) {
    next(error);
  }
}


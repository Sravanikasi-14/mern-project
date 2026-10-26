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
} from "../services/attendanceService.js";
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

    const result = await punchInEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: true,
      companyTimezone,
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

    const result = await punchOutEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: true,
      companyTimezone,
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

    const result = await punchInEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: Boolean(location),
      companyTimezone,
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

    const result = await punchOutEmployee({
      models: req.auth.models,
      employee,
      location,
      requireLocation: Boolean(location),
      companyTimezone,
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

    const result = await startLiveTrackingSession({
      models: req.auth.models,
      employee,
      durationMinutes,
      userAgent,
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

    if (!location) {
      throw new HttpError(400, "Location coordinates are required for live tracking update.");
    }

    const result = await updateLiveTrackingLocation({
      models: req.auth.models,
      employee,
      location,
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
export async function getAdminAttendanceOverviewHandler(req, res, next) {
  try {
    if (req.auth.user.role === "PLATFORM_ADMIN") {
      throw new HttpError(403, "Platform Admins do not have access to company employee location details.");
    }

    if (req.auth.user.role !== "HR_ADMIN") {
      throw new HttpError(403, "Access denied. Only HR Admins may view attendance overview.");
    }

    const companyTimezone = req.auth.company?.config?.timezone || "Asia/Kolkata";
    const { date, department } = req.query;

    const overview = await getAdminAttendanceOverview({
      models: req.auth.models,
      companyTimezone,
      date,
      department,
    });

    res.status(200).json({
      success: true,
      ...overview,
    });
  } catch (error) {
    next(error);
  }
}

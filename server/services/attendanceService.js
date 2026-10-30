import { HttpError } from "../utils/httpError.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getCompanyBusinessDate } from "../utils/companyTime.js";
export { getCompanyBusinessDate };

/**
 * Validates browser geolocation coordinates and metadata.
 * Ensures coordinates are valid finite numbers within geographical bounds,
 * and reported accuracy is positive.
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

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: typeof accuracy === "number" ? Number(accuracy.toFixed(1)) : null,
    capturedAt: location.capturedAt ? new Date(location.capturedAt) : new Date(),
    address: typeof location.address === "string" ? location.address.trim().slice(0, 255) : "",
  };
}

/**
 * Records an employee punch-in event.
 * Server timestamp is authoritative; client location timestamp is capture metadata.
 */
export async function punchInEmployee({
  models,
  employee,
  location,
  requireLocation = false,
  companyTimezone = "Asia/Kolkata",
}) {
  const { Attendance, Employee, CompanyHrPolicy } = models;
  let validatedLocation = null;
  if (location || requireLocation) {
    validatedLocation = validateLocationCoordinates(location);
  }

  // Geofence enforcement from CompanyHrPolicy
  if (CompanyHrPolicy) {
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    if (
      policy?.locationRules?.geofenceEnabled &&
      typeof policy.locationRules.officeLatitude === "number" &&
      typeof policy.locationRules.officeLongitude === "number"
    ) {
      if (!validatedLocation) {
        throw new HttpError(
          400,
          "Location coordinates are required to punch in because geofencing is enabled by company policy."
        );
      }
      const lat1 = policy.locationRules.officeLatitude;
      const lon1 = policy.locationRules.officeLongitude;
      const lat2 = validatedLocation.latitude;
      const lon2 = validatedLocation.longitude;
      const R = 6371e3;
      const φ1 = (lat1 * Math.PI) / 180;
      const φ2 = (lat2 * Math.PI) / 180;
      const Δφ = ((lat2 - lat1) * Math.PI) / 180;
      const Δλ = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceMeters = Math.round(R * c);

      const radius = policy.locationRules.geofenceRadiusMeters || 200;
      if (distanceMeters > radius) {
        throw new HttpError(
          400,
          `Punch-in rejected: Your current location is ${distanceMeters}m from the office, which exceeds the permitted geofence radius of ${radius}m.`
        );
      }
    }
  }

  const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);

  // Check if attendance already exists for today
  let attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });

  if (attendance && attendance.checkIn) {
    throw new HttpError(400, "You have already punched in for today.");
  }

  const serverNow = new Date();

  if (!attendance) {
    attendance = new Attendance({
      companyId: employee.companyId,
      employeeId: employee._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: serverNow,
      checkInLocation: validatedLocation,
    });
    await attendance.save();
  } else {
    attendance.checkIn = serverNow;
    attendance.checkInLocation = validatedLocation;
    attendance.status = "PRESENT";
    await attendance.save();
  }

  // Synchronize employee customFields.attendanceLogs for backwards compatibility
  const customFields = employee.customFields || {};
  const attendanceLogs = [...(customFields.attendanceLogs || [])];
  const existingLogIndex = attendanceLogs.findIndex((log) => log.date === todayStr);

  const logEntry = {
    date: todayStr,
    checkIn: serverNow.toISOString(),
    checkOut: null,
    status: "PRESENT",
    workingHours: "In Progress",
    checkInLocation: validatedLocation,
  };

  if (existingLogIndex >= 0) {
    attendanceLogs[existingLogIndex] = {
      ...attendanceLogs[existingLogIndex],
      ...logEntry,
    };
  } else {
    attendanceLogs.push(logEntry);
  }

  employee.customFields = {
    ...customFields,
    attendanceLogs,
  };
  employee.markModified("customFields");

  if (!employee.attendance) {
    employee.attendance = { totalWorkingDays: 22, daysPresent: 1, leaveBalance: { casual: 8, sick: 6, earned: 12 } };
  } else {
    employee.attendance.daysPresent = (employee.attendance.daysPresent || 0) + 1;
  }
  await employee.save();

  return {
    success: true,
    message: "Punch-in recorded successfully.",
    today: {
      date: todayStr,
      status: "CHECKED_IN",
      checkInTime: serverNow.toISOString(),
      checkOutTime: null,
      workingHours: "In Progress",
    },
    attendance: {
      id: attendance._id,
      date: todayStr,
      status: "CHECKED_IN",
      checkInTime: serverNow.toISOString(),
      checkInLocation: validatedLocation,
      checkOutTime: null,
      workingHours: "In Progress",
    },
  };
}

/**
 * Records an employee punch-out event.
 */
export async function punchOutEmployee({
  models,
  employee,
  location,
  requireLocation = false,
  companyTimezone = "Asia/Kolkata",
}) {
  const { Attendance } = models;
  let validatedLocation = null;
  if (location || requireLocation) {
    validatedLocation = validateLocationCoordinates(location);
  }
  const todayStr = getCompanyBusinessDate(new Date(), companyTimezone);

  let attendance = await Attendance.findOne({ employeeId: employee._id, date: todayStr });

  // Fallback to employee customFields if Attendance record was not found
  const customFields = employee.customFields || {};
  const attendanceLogs = [...(customFields.attendanceLogs || [])];
  const existingLogIndex = attendanceLogs.findIndex((log) => log.date === todayStr);

  if (!attendance && existingLogIndex >= 0 && attendanceLogs[existingLogIndex].checkIn) {
    // Reconstruct Attendance record from existing log
    attendance = new Attendance({
      companyId: employee.companyId,
      employeeId: employee._id,
      date: todayStr,
      status: "PRESENT",
      checkIn: new Date(attendanceLogs[existingLogIndex].checkIn),
    });
  }

  if (!attendance || !attendance.checkIn) {
    throw new HttpError(400, "You must punch in before punching out.");
  }

  if (attendance.checkOut) {
    throw new HttpError(400, "You have already punched out for today.");
  }

  const serverNow = new Date();
  const checkInDate = new Date(attendance.checkIn);
  const diffMs = Math.max(0, serverNow.getTime() - checkInDate.getTime());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const workingHours = `${hours}h ${mins}m`;

  attendance.checkOut = serverNow;
  attendance.checkOutLocation = validatedLocation;
  attendance.workingHours = workingHours;
  attendance.durationMinutes = Math.round(diffMs / (1000 * 60));
  await attendance.save();

  // Synchronize employee customFields.attendanceLogs
  if (existingLogIndex >= 0) {
    attendanceLogs[existingLogIndex] = {
      ...attendanceLogs[existingLogIndex],
      checkOut: serverNow.toISOString(),
      workingHours,
      checkOutLocation: validatedLocation,
    };
    employee.customFields = {
      ...customFields,
      attendanceLogs,
    };
    employee.markModified("customFields");
    await employee.save();
  }

  return {
    success: true,
    message: "Punch-out recorded successfully.",
    today: {
      date: todayStr,
      status: "CHECKED_OUT",
      checkInTime: attendance.checkIn.toISOString(),
      checkOutTime: serverNow.toISOString(),
      workingHours,
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

  if (attendance) {
    checkInTime = attendance.checkIn ? attendance.checkIn.toISOString() : null;
    checkOutTime = attendance.checkOut ? attendance.checkOut.toISOString() : null;
    checkInLocation = attendance.checkInLocation || null;
    checkOutLocation = attendance.checkOutLocation || null;

    if (attendance.checkIn && attendance.checkOut) {
      todayStatus = "CHECKED_OUT";
      workingHours = attendance.workingHours || "--";
    } else if (attendance.checkIn) {
      todayStatus = "CHECKED_IN";
      workingHours = "In Progress";
    } else if (attendance.status === "ON_LEAVE") {
      todayStatus = "ON_LEAVE";
    }
  } else {
    // Fallback to customFields
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
      }
    }
  }

  return {
    date: todayStr,
    status: todayStatus,
    checkInTime,
    checkOutTime,
    checkInLocation,
    checkOutLocation,
    workingHours,
    canPunchIn: todayStatus === "NOT_CHECKED_IN",
    canPunchOut: todayStatus === "CHECKED_IN",
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

  const records = Attendance
    ? await Attendance.find(filter).sort({ date: -1, createdAt: -1 }).lean()
    : [];

  const byDate = new Map();
  for (const record of records) {
    const key = civilDateKey(record.date);
    if (!key || byDate.has(key)) continue;
    byDate.set(key, formatCollectionAttendance(record));
  }

  const customLogs = employee.customFields?.attendanceLogs || [];
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
 */
export async function startLiveTrackingSession({
  models,
  employee,
  durationMinutes = 30,
  userAgent = "",
}) {
  const { LiveTrackingSession } = models;

  // Clean up any existing active sessions
  await LiveTrackingSession.updateMany(
    { employeeId: employee._id, status: "ACTIVE" },
    { $set: { status: "STOPPED", stoppedAt: new Date() } }
  );

  const duration = Math.min(Math.max(parseInt(durationMinutes, 10) || 30, 5), 120);
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + duration * 60 * 1000);

  const session = new LiveTrackingSession({
    employeeId: employee._id,
    status: "ACTIVE",
    startedAt,
    expiresAt,
    deviceInfo: { userAgent },
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

  return {
    success: true,
    throttled: false,
    message: "Location update recorded.",
    session: {
      id: session._id,
      status: "ACTIVE",
      expiresAt: session.expiresAt,
      lastLocation: breadcrumb,
    },
  };
}

/**
 * Stops an active live tracking session.
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

  session.status = "STOPPED";
  session.stoppedAt = new Date();
  await session.save();

  return {
    success: true,
    message: "Live tracking session stopped.",
    session: {
      id: session._id,
      status: "STOPPED",
      stoppedAt: session.stoppedAt,
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
 * for a specific business date.
 */
export async function getAdminAttendanceOverview({
  models,
  companyTimezone = "Asia/Kolkata",
  date,
  department,
}) {
  const { Attendance, Employee, LiveTrackingSession } = models;
  const targetDate = date || getCompanyBusinessDate(new Date(), companyTimezone);

  const employeeFilter = { status: { $ne: "TERMINATED" } };
  if (department && department !== "ALL") {
    employeeFilter["job.department"] = department;
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

  return {
    date: targetDate,
    summary: {
      totalEmployees: employees.length,
      presentCount,
      checkedInCount,
      checkedOutCount,
      notCheckedInCount: employees.length - presentCount,
      liveTrackingCount,
      withLocationCount,
    },
    employees: employeeOverviews,
  };
}

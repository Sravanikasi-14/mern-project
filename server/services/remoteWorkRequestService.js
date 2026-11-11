import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { getCompanyBusinessDate } from "../utils/companyTime.js";
import { REMOTE_WORK_STATUSES } from "../models/RemoteWorkRequest.js";
import { validateLocationCoordinates } from "./attendanceService.js";
import {
  describeLocationExceptionPunchEligibility,
  describeRemoteRequestPunchEligibility,
  getEmployeeWorkMode,
  loadAttendancePolicy,
  notifyAttendanceStakeholders,
} from "./attendanceLocationService.js";

function publicRequest(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    employeeId: String(doc.employeeId),
    workDate: doc.workDate,
    sessionPeriod: doc.sessionPeriod || { startTime: "", endTime: "" },
    location: doc.location,
    reason: doc.reason,
    status: doc.status,
    decision: doc.decision || {},
    consumedAt: doc.consumedAt || null,
    consumedBySessionId: doc.consumedBySessionId ? String(doc.consumedBySessionId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function userNameMap(models, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length || !models?.User) return new Map();
  const users = await models.User.find({ _id: { $in: ids } }).select("fullName email").lean();
  return new Map(
    users.map((user) => [
      String(user._id),
      (user.fullName && String(user.fullName).trim()) || user.email || "Colleague",
    ])
  );
}

function whyRemoteListed(row) {
  const status = String(row.status || "").toUpperCase();
  if (status === "PENDING") return "Hybrid/WFH employee requested remote punch authorization for a specific work date.";
  if (status === "APPROVED") {
    return row.consumedAt
      ? "Approved remote-work request that already authorized one remote session."
      : "Approved remote-work request that can authorize remote punch within its date and conditions.";
  }
  if (status === "REJECTED") return "Remote-work request that was rejected by HR.";
  if (status === "CANCELLED") return "Remote-work request cancelled by the employee.";
  return "Remote-work request in the attendance workspace.";
}

function whyExceptionListed(row) {
  const type = String(row.type || "");
  if (type === "OUTSIDE_GEOFENCE" || type === "PUNCH_OUTSIDE") {
    return "Attendance location was outside the permitted geofence radius.";
  }
  if (type === "LOW_ACCURACY") return "GPS accuracy was below the configured threshold during attendance.";
  if (type === "GPS_UNAVAILABLE") return "GPS was unavailable when attendance location was required.";
  if (type === "RETURNED_INSIDE") return "Employee returned inside the permitted geofence after being outside.";
  return "Location exception captured during punch or live monitoring.";
}

export async function submitRemoteWorkRequest({
  models,
  employee,
  user,
  payload,
  companyTimezone = "Asia/Kolkata",
}) {
  const mode = getEmployeeWorkMode(employee);
  if (mode !== "HYBRID" && mode !== "WFH") {
    throw new HttpError(400, "Only hybrid or WFH employees can request remote work sessions.");
  }
  const policy = await loadAttendancePolicy(models);
  if (mode === "HYBRID" && policy?.workArrangementRules?.hybridRemoteApprovalRequired === false) {
    // Still allow requests for auditability, but they are optional for punch-in.
  }

  const workDate = String(payload?.workDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new HttpError(400, "A valid work date (YYYY-MM-DD) is required.");
  }
  const today = getCompanyBusinessDate(new Date(), companyTimezone);
  if (workDate < today) {
    throw new HttpError(400, "Remote work cannot be requested for a past date.");
  }
  const reason = String(payload?.reason || "").trim();
  if (reason.length < 3) {
    throw new HttpError(400, "Please provide a reason for the remote work request.");
  }

  const locationInput = payload?.location || {};
  const coords = validateLocationCoordinates({
    latitude: Number(locationInput.latitude),
    longitude: Number(locationInput.longitude),
    accuracy: locationInput.accuracy,
    address: locationInput.address,
  });
  const radius =
    Number(locationInput.radiusMeters) ||
    Number(policy?.workArrangementRules?.wfhRadiusMeters) ||
    200;

  const existingPending = await models.RemoteWorkRequest.findOne({
    employeeId: employee._id,
    workDate,
    status: REMOTE_WORK_STATUSES.PENDING,
  }).lean();
  if (existingPending) {
    throw new HttpError(409, "You already have a pending remote-work request for that date.");
  }

  const existingApproved = await models.RemoteWorkRequest.findOne({
    employeeId: employee._id,
    workDate,
    status: REMOTE_WORK_STATUSES.APPROVED,
  }).lean();
  if (existingApproved) {
    throw new HttpError(409, "An approved remote-work request already exists for that date.");
  }

  const created = await models.RemoteWorkRequest.create({
    companyId: employee.companyId,
    employeeId: employee._id,
    requestedByUserId: user._id,
    workDate,
    sessionPeriod: {
      startTime: String(payload?.sessionPeriod?.startTime || "").trim().slice(0, 5),
      endTime: String(payload?.sessionPeriod?.endTime || "").trim().slice(0, 5),
    },
    location: {
      label: String(locationInput.label || "Home").trim().slice(0, 120),
      address: coords.address,
      latitude: coords.latitude,
      longitude: coords.longitude,
      radiusMeters: Math.max(25, Math.min(5000, radius)),
    },
    reason: reason.slice(0, 1000),
    status: REMOTE_WORK_STATUSES.PENDING,
  });

  await notifyAttendanceStakeholders({
    models,
    employee,
    title: "Remote work request submitted",
    message: `${employee.fullName || "Employee"} requested remote work for ${workDate}.`,
    link: "/admin/attendance?workspace=remote",
    metadata: { remoteWorkRequestId: String(created._id) },
  }).catch(() => {});

  return publicRequest(created);
}

export async function listMyRemoteWorkRequests({ models, employee, status = null }) {
  const filter = { employeeId: employee._id };
  if (status) filter.status = String(status).toUpperCase();
  const rows = await models.RemoteWorkRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map(publicRequest);
}

export async function cancelRemoteWorkRequest({ models, employee, requestId }) {
  if (!mongoose.isValidObjectId(String(requestId))) {
    throw new HttpError(404, "Remote work request not found.");
  }
  const doc = await models.RemoteWorkRequest.findOne({
    _id: requestId,
    employeeId: employee._id,
  });
  if (!doc) throw new HttpError(404, "Remote work request not found.");
  if (doc.status !== REMOTE_WORK_STATUSES.PENDING) {
    throw new HttpError(400, "Only pending requests can be cancelled.");
  }
  doc.status = REMOTE_WORK_STATUSES.CANCELLED;
  await doc.save();
  return publicRequest(doc);
}

export async function listAdminRemoteWorkRequests({
  models,
  status = "PENDING",
  employeeScopeFilter = null,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  const filter = {};
  if (status && status !== "ALL") filter.status = String(status).toUpperCase();
  if (employeeScopeFilter?.employeeId) {
    Object.assign(filter, employeeScopeFilter);
  }
  const [rows, policy] = await Promise.all([
    models.RemoteWorkRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    loadAttendancePolicy(models),
  ]);
  const employeeIds = [...new Set(rows.map((r) => String(r.employeeId)))];
  const employees = employeeIds.length
    ? await models.Employee.find({ _id: { $in: employeeIds } })
        .select("fullName employeeCode email avatar job.workArrangement")
        .lean()
    : [];
  const byId = new Map(employees.map((e) => [String(e._id), e]));
  const decidedByIds = rows.map((row) => row.decision?.decidedBy).filter(Boolean);
  const names = await userNameMap(models, decidedByIds);

  return rows.map((row) => {
    const base = publicRequest(row);
    const emp = byId.get(String(row.employeeId));
    const workMode = getEmployeeWorkMode(emp);
    const punchEligibility = describeRemoteRequestPunchEligibility({
      request: row,
      employee: emp || {},
      policy,
      companyTimezone,
      now,
    });
    const decidedById = row.decision?.decidedBy ? String(row.decision.decidedBy) : null;
    return {
      ...base,
      _id: base.id,
      employee: emp
        ? {
            _id: emp._id,
            fullName: emp.fullName,
            employeeCode: emp.employeeCode,
            email: emp.email,
            avatar: emp.avatar || "",
            workMode,
          }
        : null,
      workMode,
      whyListed: whyRemoteListed(row),
      punchEligibility,
      decisionRemarks: row.decision?.remarks || "",
      decidedAt: row.decision?.decidedAt || null,
      decidedBy: decidedById,
      decidedByName: decidedById ? names.get(decidedById) || "" : "",
      companyDate: getCompanyBusinessDate(now, companyTimezone),
    };
  });
}

export async function decideRemoteWorkRequest({
  models,
  requestId,
  actorUser,
  decision,
  remarks = "",
}) {
  if (!mongoose.isValidObjectId(String(requestId))) {
    throw new HttpError(404, "Remote work request not found.");
  }
  const normalized = String(decision || "").toUpperCase();
  if (normalized !== "APPROVED" && normalized !== "REJECTED") {
    throw new HttpError(400, "Decision must be APPROVED or REJECTED.");
  }
  const doc = await models.RemoteWorkRequest.findById(requestId);
  if (!doc) throw new HttpError(404, "Remote work request not found.");
  if (doc.status !== REMOTE_WORK_STATUSES.PENDING) {
    throw new HttpError(409, "This request has already been decided.");
  }
  if (String(doc.requestedByUserId) === String(actorUser._id)) {
    throw new HttpError(403, "You cannot decide your own remote-work request.");
  }

  doc.status = normalized;
  doc.decision = {
    decidedBy: actorUser._id,
    decidedAt: new Date(),
    remarks: String(remarks || "").trim().slice(0, 1000),
  };
  await doc.save();

  const employee = await models.Employee.findById(doc.employeeId).lean();
  if (employee) {
    await notifyAttendanceStakeholders({
      models,
      employee,
      title: normalized === "APPROVED" ? "Remote work approved" : "Remote work rejected",
      message:
        normalized === "APPROVED"
          ? `Your remote work request for ${doc.workDate} was approved.`
          : `Your remote work request for ${doc.workDate} was rejected.`,
      link: "/app/attendance",
      metadata: { remoteWorkRequestId: String(doc._id), decision: normalized },
    }).catch(() => {});
  }

  return publicRequest(doc);
}

export async function listLocationExceptions({
  models,
  status = "OPEN",
  employeeScopeFilter = null,
  companyTimezone = "Asia/Kolkata",
  now = new Date(),
}) {
  const filter = {};
  if (status && status !== "ALL") filter.status = String(status).toUpperCase();
  if (employeeScopeFilter?.employeeId) Object.assign(filter, employeeScopeFilter);
  const [rows, policy] = await Promise.all([
    models.LocationException.find(filter).sort({ occurredAt: -1 }).limit(200).lean(),
    loadAttendancePolicy(models),
  ]);
  const employeeIds = [...new Set(rows.map((r) => String(r.employeeId)))];
  const employees = employeeIds.length
    ? await models.Employee.find({ _id: { $in: employeeIds } })
        .select("fullName employeeCode email avatar job.workArrangement")
        .lean()
    : [];
  const byId = new Map(employees.map((e) => [String(e._id), e]));
  const today = getCompanyBusinessDate(now, companyTimezone);

  const activeApprovals = employeeIds.length
    ? await models.RemoteWorkRequest.find({
        employeeId: { $in: employeeIds },
        workDate: today,
        status: REMOTE_WORK_STATUSES.APPROVED,
        $or: [{ consumedAt: null }, { consumedAt: { $exists: false } }],
      }).lean()
    : [];
  const approvalByEmployee = new Map(activeApprovals.map((row) => [String(row.employeeId), row]));

  const reviewedByIds = rows.map((row) => row.review?.reviewedBy).filter(Boolean);
  const names = await userNameMap(models, reviewedByIds);

  return rows.map((row) => {
    const emp = byId.get(String(row.employeeId));
    const workMode = getEmployeeWorkMode(emp);
    const punchEligibility = describeLocationExceptionPunchEligibility({
      exception: row,
      employee: emp || {},
      policy,
      activeRemoteApproval: approvalByEmployee.get(String(row.employeeId)) || null,
      companyTimezone,
      now,
    });
    const reviewedById = row.review?.reviewedBy ? String(row.review.reviewedBy) : null;
    const distanceReliable =
      row.distanceMeters != null &&
      Number.isFinite(Number(row.distanceMeters)) &&
      row.permittedLocation?.latitude != null &&
      row.permittedLocation?.longitude != null;
    return {
      id: String(row._id),
      _id: String(row._id),
      employeeId: String(row.employeeId),
      employee: emp
        ? {
            _id: emp._id,
            fullName: emp.fullName,
            employeeCode: emp.employeeCode,
            email: emp.email,
            avatar: emp.avatar || "",
            workMode,
          }
        : null,
      workMode,
      attendanceId: row.attendanceId ? String(row.attendanceId) : null,
      sessionId: row.sessionId ? String(row.sessionId) : null,
      workDate: row.workDate,
      sessionType: row.sessionType,
      type: row.type,
      status: row.status,
      occurredAt: row.occurredAt,
      returnedAt: row.returnedAt,
      location: row.location,
      permittedLocation: row.permittedLocation,
      distanceMeters: row.distanceMeters,
      distanceReliable,
      message: row.message,
      whyListed: whyExceptionListed(row),
      punchEligibility,
      review: row.review || {},
      reviewRemarks: row.review?.remarks || "",
      reviewedAt: row.review?.reviewedAt || null,
      reviewedBy: reviewedById,
      reviewedByName: reviewedById ? names.get(reviewedById) || "" : "",
      companyDate: today,
      exceptionGrantsRemote: false,
    };
  });
}

export async function reviewLocationException({ models, exceptionId, actorUser, status, remarks = "" }) {
  if (!mongoose.isValidObjectId(String(exceptionId))) {
    throw new HttpError(404, "Location exception not found.");
  }
  const normalized = String(status || "").toUpperCase();
  if (!["REVIEWED", "REGULARIZED", "DISMISSED"].includes(normalized)) {
    throw new HttpError(400, "Status must be REVIEWED, REGULARIZED, or DISMISSED.");
  }
  const doc = await models.LocationException.findById(exceptionId);
  if (!doc) throw new HttpError(404, "Location exception not found.");
  doc.status = normalized;
  doc.review = {
    reviewedBy: actorUser._id,
    reviewedAt: new Date(),
    remarks: String(remarks || "").trim().slice(0, 1000),
  };
  await doc.save();
  return {
    id: String(doc._id),
    status: doc.status,
    review: doc.review,
  };
}

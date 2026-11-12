import { HttpError } from "../utils/httpError.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import {
  enrollEmployeeFace,
  revokeEmployeeFace,
  getFaceEnrollmentStatus,
} from "../services/faceRecognitionService.js";
import { USER_ROLES } from "../models/User.js";

async function getTargetEmployee(req, employeeId = null) {
  const { Employee } = req.auth.models;
  if (employeeId) {
    const employee = await Employee.findOne({ _id: employeeId, companyId: req.auth.company._id });
    if (!employee) throw new HttpError(404, "Employee not found.");
    return employee;
  }
  const employee = await Employee.findOne({
    $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
  });
  if (!employee) throw new HttpError(404, "Employee record not found for the authenticated user.");
  return employee;
}

function assertFaceModel(req) {
  if (!req.auth.models.EmployeeFaceEnrollment) {
    throw new HttpError(500, "Face enrollment is not available for this company tenant.");
  }
}

async function recordFaceAudit(req, action, targetId, changes = {}) {
  try {
    const { AuditLog } = req.auth.models;
    if (!AuditLog) return;
    await AuditLog.create({
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      action,
      targetType: "EmployeeFaceEnrollment",
      targetId,
      changes,
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Face enrollment audit error:", err.message);
  }
}

/**
 * GET /api/employees/me/face-enrollment
 */
export async function getMyFaceEnrollment(req, res, next) {
  try {
    assertFaceModel(req);
    const employee = await getTargetEmployee(req);
    const status = await getFaceEnrollmentStatus({
      FaceEnrollment: req.auth.models.EmployeeFaceEnrollment,
      companyId: req.auth.company._id,
      employeeId: employee._id,
    });
    res.status(200).json({ success: true, enrollment: status });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/me/face-enrollment
 * Body: { imageBase64, consentAccepted, consentTextVersion? }
 */
export async function enrollMyFace(req, res, next) {
  try {
    assertFaceModel(req);
    const employee = await getTargetEmployee(req);
    const { imageBase64, consentAccepted, consentTextVersion } = req.body || {};

    const result = await enrollEmployeeFace({
      FaceEnrollment: req.auth.models.EmployeeFaceEnrollment,
      companyId: req.auth.company._id,
      employeeId: employee._id,
      enrolledBy: req.auth.user._id,
      imageBase64,
      consentAccepted: Boolean(consentAccepted),
      consentTextVersion: consentTextVersion || "v1",
    });

    await recordFaceAudit(req, AUDIT_ACTIONS.FACE_ENROLLED, result.enrollmentId, {
      employeeId: String(employee._id),
      action: "FACE_ENROLLED",
    });

    res.status(201).json({
      success: true,
      message: "Face enrolled successfully.",
      enrollment: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/employees/me/face-enrollment
 */
export async function revokeMyFace(req, res, next) {
  try {
    assertFaceModel(req);
    const employee = await getTargetEmployee(req);
    const result = await revokeEmployeeFace({
      FaceEnrollment: req.auth.models.EmployeeFaceEnrollment,
      companyId: req.auth.company._id,
      employeeId: employee._id,
      revokedBy: req.auth.user._id,
      reason: req.body?.reason || "employee_revoked",
    });
    await recordFaceAudit(req, AUDIT_ACTIONS.FACE_REVOKED, employee._id, {
      employeeId: String(employee._id),
      revoked: result.revoked,
    });
    res.status(200).json({ success: true, message: "Face enrollment revoked.", ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/:id/face-enrollment (HR)
 * Status only — never returns embeddings.
 */
export async function getEmployeeFaceEnrollmentAdmin(req, res, next) {
  try {
    assertFaceModel(req);
    const role = req.auth.user.role;
    if (![USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN].includes(role)) {
      throw new HttpError(403, "Only HR or Company Admin can view enrollment status.");
    }
    const employee = await getTargetEmployee(req, req.params.id);
    const status = await getFaceEnrollmentStatus({
      FaceEnrollment: req.auth.models.EmployeeFaceEnrollment,
      companyId: req.auth.company._id,
      employeeId: employee._id,
    });
    res.status(200).json({
      success: true,
      employeeId: String(employee._id),
      fullName: employee.fullName || "",
      enrollment: status,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/employees/:id/face-enrollment (HR)
 */
export async function revokeEmployeeFaceEnrollmentAdmin(req, res, next) {
  try {
    assertFaceModel(req);
    const role = req.auth.user.role;
    if (![USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN].includes(role)) {
      throw new HttpError(403, "Only HR or Company Admin can revoke enrollments.");
    }
    const employee = await getTargetEmployee(req, req.params.id);
    const result = await revokeEmployeeFace({
      FaceEnrollment: req.auth.models.EmployeeFaceEnrollment,
      companyId: req.auth.company._id,
      employeeId: employee._id,
      revokedBy: req.auth.user._id,
      reason: req.body?.reason || "hr_revoked",
    });
    await recordFaceAudit(req, AUDIT_ACTIONS.FACE_REVOKED_BY_HR, employee._id, {
      employeeId: String(employee._id),
      revoked: result.revoked,
    });
    res.status(200).json({ success: true, message: "Face enrollment revoked by HR.", ...result });
  } catch (error) {
    next(error);
  }
}

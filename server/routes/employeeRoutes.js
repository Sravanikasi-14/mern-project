import express from "express";
import {
  createEmployee,
  downloadDocument,
  downloadPayslip,
  applyLeave,
  getEmployeeById,
  getEmployeeDashboard,
  getEmployeeSummary,
  getEmployees,
  getEmployeeDirectory,
  getMyProfile,
  getVisibleEmployeeProfile,
  resendInvitation,
  streamEmployeeAvatar,
  streamMyEmployeeAvatar,
  updateEmployee,
  updateMyProfile,
  uploadEmployeeDocument,
} from "../controllers/employeeController.js";
import {
  downloadImportTemplate,
  previewEmployeeImport,
  commitEmployeeImport,
} from "../controllers/employeeImportController.js";
import {
  getOrganizationHierarchy,
  getEmployeeOrganizationView,
  getOrganizationExplorerDepartments,
  getOrganizationExplorerDepartmentEmployees,
  getOrganizationExplorerProjects,
  getOrganizationExplorerProjectEmployees,
  listOrganizationExplorerTeamsHandler,
  getOrganizationExplorerTeamHandler,
  createOrganizationExplorerTeamHandler,
  updateOrganizationExplorerTeamHandler,
  deactivateOrganizationExplorerTeamHandler,
} from "../controllers/organizationController.js";
import {
  punchIn,
  punchOut,
  handleCheckIn,
  handleCheckOut,
  getStatus as getAttendanceStatus,
  getHistory as getAttendanceHistory,
  startTracking,
  updateTrackingLocation,
  stopTracking,
  getTrackingStatusHandler,
  postRemoteWorkRequest,
  getMyRemoteWorkRequests,
  cancelMyRemoteWorkRequest,
} from "../controllers/attendanceController.js";
import {
  getMyFaceEnrollment,
  enrollMyFace,
  revokeMyFace,
  getEmployeeFaceEnrollmentAdmin,
  revokeEmployeeFaceEnrollmentAdmin,
} from "../controllers/faceEnrollmentController.js";
import { issuePunchVerificationChallenge } from "../controllers/verificationChallengeController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireHrPermission,
  requireEmployeeInScope,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Authenticated employee self-service routes
router.get("/me", authenticate, getMyProfile);
router.get("/me/dashboard", authenticate, getEmployeeDashboard);
router.get("/me/avatar", authenticate, streamMyEmployeeAvatar);

// Attendance — authenticate only; controller/service retain geofence and punch guards
router.post("/me/attendance/punch-in", authenticate, punchIn);
router.post("/me/attendance/punch-out", authenticate, punchOut);
router.post("/me/attendance/check-in", authenticate, handleCheckIn);
router.post("/me/attendance/check-out", authenticate, handleCheckOut);
router.get("/me/attendance/status", authenticate, getAttendanceStatus);
router.get("/me/attendance/history", authenticate, getAttendanceHistory);
router.post(
  "/me/attendance/verification-challenge",
  authenticate,
  issuePunchVerificationChallenge
);

// Face biometric enrollment (self-service)
router.get("/me/face-enrollment", authenticate, getMyFaceEnrollment);
router.post("/me/face-enrollment", authenticate, enrollMyFace);
router.delete("/me/face-enrollment", authenticate, revokeMyFace);
router.post("/me/attendance/remote-requests", authenticate, postRemoteWorkRequest);
router.get("/me/attendance/remote-requests", authenticate, getMyRemoteWorkRequests);
router.post("/me/attendance/remote-requests/:id/cancel", authenticate, cancelMyRemoteWorkRequest);

// Live tracking — authenticate only; privacy/lifecycle enforced in service layer
router.post("/me/tracking/start", authenticate, startTracking);
router.post("/me/tracking/update", authenticate, updateTrackingLocation);
router.post("/me/tracking/stop", authenticate, stopTracking);
router.get("/me/tracking/status", authenticate, getTrackingStatusHandler);

router.post("/me/leave-requests", authenticate, applyLeave);
// Payslip download — controller ownership (assertCanAccessPayslip) remains authoritative
router.get("/me/payslips/:payslipId/download", authenticate, downloadPayslip);
router.patch("/me", authenticate, updateMyProfile);
router.post("/me/documents", authenticate, uploadEmployeeDocument);
router.get("/me/documents/:docId/download", authenticate, downloadDocument);

// Directory / org views — employees keep basic directory; HR_ADMIN gated when ENFORCED
router.get(
  "/directory",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.view"),
  getEmployeeDirectory
);
router.get(
  "/organization-view",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getEmployeeOrganizationView
);

// Organization Explorer — Departments / Projects / Teams (reads for authenticated users)
router.get(
  "/organization-explorer/departments",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerDepartments
);
router.get(
  "/organization-explorer/departments/:department",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerDepartmentEmployees
);
router.get(
  "/organization-explorer/projects",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerProjects
);
router.get(
  "/organization-explorer/projects/:project",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerProjectEmployees
);
router.get(
  "/organization-explorer/teams",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  listOrganizationExplorerTeamsHandler
);
router.get(
  "/organization-explorer/teams/:teamId",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerTeamHandler
);

// Organization Explorer team mutations — HR_ADMIN only
router.post(
  "/organization-explorer/teams",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("organization.manage"),
  createOrganizationExplorerTeamHandler
);
router.patch(
  "/organization-explorer/teams/:teamId/deactivate",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("organization.manage"),
  deactivateOrganizationExplorerTeamHandler
);
router.put(
  "/organization-explorer/teams/:teamId",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("organization.manage"),
  updateOrganizationExplorerTeamHandler
);

// Relationship-scoped profile. Enforced HR needs people.view and employee scope.
router.get(
  "/:id/visible-profile",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.view"),
  getVisibleEmployeeProfile
);

// Employee photo — self, or HR portal operator with people.view (+ scope when enforced)
router.get("/:id/avatar", authenticate, loadHrAccessContext, streamEmployeeAvatar);

// Document download/upload — controller ownership + CA4-C HR scope/permission remain authoritative
router.get(
  "/:id/documents/:docId/download",
  authenticate,
  loadHrAccessContext,
  downloadDocument
);
router.post(
  "/:id/documents",
  authenticate,
  loadHrAccessContext,
  uploadEmployeeDocument
);

// Management routes restricted to HR_ADMIN
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/summary", requireHrPermission("people.view"), getEmployeeSummary);
router.get("/organization", requireHrPermission("organization.view"), getOrganizationHierarchy);
router.get("/import/template", requireHrPermission("people.import"), downloadImportTemplate);
router.post("/import/preview", requireHrPermission("people.import"), previewEmployeeImport);
router.post("/import", requireHrPermission("people.import"), commitEmployeeImport);
router.get("/", requireHrPermission("people.view"), getEmployees);
router.post("/", requireHrPermission("people.create"), createEmployee);
router.post(
  "/:id/resend-invite",
  requireHrPermission("people.edit"),
  requireEmployeeInScope((req) => req.params.id),
  resendInvitation
);
router.post(
  "/:id/activation-link",
  requireHrPermission("people.edit"),
  requireEmployeeInScope((req) => req.params.id),
  resendInvitation
);
router.get(
  "/:id/face-enrollment",
  requireHrPermission("people.view"),
  requireEmployeeInScope((req) => req.params.id),
  getEmployeeFaceEnrollmentAdmin
);
router.delete(
  "/:id/face-enrollment",
  requireHrPermission("people.edit"),
  requireEmployeeInScope((req) => req.params.id),
  revokeEmployeeFaceEnrollmentAdmin
);
router.get(
  "/:id",
  requireHrPermission("people.view"),
  requireEmployeeInScope((req) => req.params.id),
  getEmployeeById
);
router.patch(
  "/:id",
  requireHrPermission("people.edit"),
  requireEmployeeInScope((req) => req.params.id),
  updateEmployee
);

export default router;

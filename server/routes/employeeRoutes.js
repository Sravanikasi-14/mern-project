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
  getEmployeeFilterOptions,
  getEmployeeProjectsOverview,
  getEmployeeDirectory,
  getPeopleSearch,
  getMyProfile,
  getVisibleEmployeeProfile,
  getPeopleDiscoveryProfile,
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
  getOrganizationChildren,
  getOrganizationSearch,
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
  requireEntitledCapability,
  requireEntitledModule,
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
router.post("/me/attendance/punch-in", authenticate, requireEntitledModule("attendance"), punchIn);
router.post("/me/attendance/punch-out", authenticate, requireEntitledModule("attendance"), punchOut);
router.post("/me/attendance/check-in", authenticate, requireEntitledModule("attendance"), handleCheckIn);
router.post("/me/attendance/check-out", authenticate, requireEntitledModule("attendance"), handleCheckOut);
router.get("/me/attendance/status", authenticate, requireEntitledModule("attendance"), getAttendanceStatus);
router.get("/me/attendance/history", authenticate, requireEntitledModule("attendance"), getAttendanceHistory);
router.post(
  "/me/attendance/verification-challenge",
  authenticate,
  requireEntitledModule("attendance"),
  issuePunchVerificationChallenge
);

// Face biometric enrollment (self-service)
router.get(
  "/me/face-enrollment",
  authenticate,
  requireEntitledModule("attendance"),
  requireEntitledCapability("attendance.faceVerification"),
  getMyFaceEnrollment
);
router.post(
  "/me/face-enrollment",
  authenticate,
  requireEntitledModule("attendance"),
  requireEntitledCapability("attendance.faceVerification"),
  enrollMyFace
);
router.delete(
  "/me/face-enrollment",
  authenticate,
  requireEntitledModule("attendance"),
  requireEntitledCapability("attendance.faceVerification"),
  revokeMyFace
);
router.post(
  "/me/attendance/remote-requests",
  authenticate,
  requireEntitledModule("attendance"),
  postRemoteWorkRequest
);
router.get(
  "/me/attendance/remote-requests",
  authenticate,
  requireEntitledModule("attendance"),
  getMyRemoteWorkRequests
);
router.post(
  "/me/attendance/remote-requests/:id/cancel",
  authenticate,
  requireEntitledModule("attendance"),
  cancelMyRemoteWorkRequest
);

// Live tracking — authenticate only; privacy/lifecycle enforced in service layer
router.post("/me/tracking/start", authenticate, requireEntitledModule("liveTracking"), startTracking);
router.post("/me/tracking/update", authenticate, requireEntitledModule("liveTracking"), updateTrackingLocation);
router.post("/me/tracking/stop", authenticate, requireEntitledModule("liveTracking"), stopTracking);
router.get("/me/tracking/status", authenticate, requireEntitledModule("liveTracking"), getTrackingStatusHandler);

router.post("/me/leave-requests", authenticate, requireEntitledModule("leave"), applyLeave);
// Payslip download — controller ownership (assertCanAccessPayslip) remains authoritative
router.get(
  "/me/payslips/:payslipId/download",
  authenticate,
  requireEntitledModule("payroll"),
  downloadPayslip
);
router.patch("/me", authenticate, updateMyProfile);
router.post("/me/documents", authenticate, requireEntitledModule("people"), uploadEmployeeDocument);
router.get(
  "/me/documents/:docId/download",
  authenticate,
  requireEntitledModule("people"),
  downloadDocument
);

// Directory / org views — employees keep basic directory; HR_ADMIN gated when ENFORCED
router.get(
  "/directory",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.view"),
  getEmployeeDirectory
);
// Global header people search (HR + Employee portals).
// Authenticated company users may search; HR_ADMIN still needs people.view when enforced.
// Field-level redaction is enforced in buildPeopleSearch / serializePeopleSearchHit.
router.get(
  "/people-search",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.view"),
  getPeopleSearch
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
// Global Search colleague detail — hierarchy fields when authorized; BASIC card otherwise.
router.get(
  "/:id/people-profile",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.view"),
  getPeopleDiscoveryProfile
);

// Employee photo — self, or HR portal operator with people.view (+ scope when enforced)
router.get(
  "/:id/avatar",
  authenticate,
  loadHrAccessContext,
  requireEntitledModule("people"),
  streamEmployeeAvatar
);

// Document download/upload — people module required; controller ownership + CA4-C remain authoritative
router.get(
  "/:id/documents/:docId/download",
  authenticate,
  loadHrAccessContext,
  requireEntitledModule("people"),
  downloadDocument
);
router.post(
  "/:id/documents",
  authenticate,
  loadHrAccessContext,
  requireEntitledModule("people"),
  uploadEmployeeDocument
);

// Management routes restricted to HR_ADMIN
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/summary", requireHrPermission("people.view"), getEmployeeSummary);
router.get(
  "/filter-options",
  requireHrPermission("people.view"),
  getEmployeeFilterOptions
);
router.get(
  "/projects-overview",
  requireHrPermission("people.view"),
  getEmployeeProjectsOverview
);
router.get("/organization", requireHrPermission("organization.view"), getOrganizationHierarchy);
router.get(
  "/organization/children",
  requireHrPermission("organization.view"),
  getOrganizationChildren
);
router.get(
  "/organization/search",
  requireHrPermission("organization.view"),
  getOrganizationSearch
);
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

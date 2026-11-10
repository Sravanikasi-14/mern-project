import express from "express";
import { getAdminOverview, getAdminDashboard } from "../controllers/adminController.js";
import {
  getAdminAttendanceOverviewHandler,
  getAdminEmployeeAttendanceHistoryHandler,
  getAdminTrackingSessionsHandler,
  getAdminRemoteWorkRequestsHandler,
  decideRemoteWorkRequestHandler,
  getLocationExceptionsHandler,
  reviewLocationExceptionHandler,
  updateEmployeeWorkArrangementHandler,
  regularizeAttendanceHandler,
} from "../controllers/attendanceController.js";
import { getHrIntelligenceHandler } from "../controllers/hrIntelligenceController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission, requireEmployeeInScope } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);
router.get("/overview", requireHrPermission("dashboard.view"), getAdminOverview);
router.get("/dashboard", requireHrPermission("dashboard.view"), getAdminDashboard);
router.get("/attendance/overview", requireHrPermission("attendance.view"), getAdminAttendanceOverviewHandler);
router.get(
  "/attendance/tracking-sessions",
  requireHrPermission("attendance.view"),
  getAdminTrackingSessionsHandler
);
router.get(
  "/attendance/employee/:id",
  requireHrPermission("attendance.view"),
  requireEmployeeInScope((req) => req.params.id),
  getAdminEmployeeAttendanceHistoryHandler
);
router.get(
  "/attendance/remote-requests",
  requireHrPermission("attendance.approve"),
  getAdminRemoteWorkRequestsHandler
);
router.post(
  "/attendance/remote-requests/:id/decide",
  requireHrPermission("attendance.approve"),
  decideRemoteWorkRequestHandler
);
router.get(
  "/attendance/location-exceptions",
  requireHrPermission("attendance.manage"),
  getLocationExceptionsHandler
);
router.post(
  "/attendance/location-exceptions/:id/review",
  requireHrPermission("attendance.manage"),
  reviewLocationExceptionHandler
);
router.put(
  "/attendance/employees/:id/work-arrangement",
  requireHrPermission("attendance.manage"),
  requireEmployeeInScope((req) => req.params.id),
  updateEmployeeWorkArrangementHandler
);
router.post(
  "/attendance/employees/:id/regularize",
  requireHrPermission("attendance.manage"),
  requireEmployeeInScope((req) => req.params.id),
  regularizeAttendanceHandler
);
router.get("/intelligence", requireHrPermission("reports.view"), getHrIntelligenceHandler);

export default router;

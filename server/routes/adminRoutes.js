import express from "express";
import { getAdminOverview, getAdminDashboard } from "../controllers/adminController.js";
import {
  getAdminAttendanceOverviewHandler,
  getAdminEmployeeAttendanceHistoryHandler,
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
  "/attendance/employee/:id",
  requireHrPermission("attendance.view"),
  requireEmployeeInScope((req) => req.params.id),
  getAdminEmployeeAttendanceHistoryHandler
);
router.get("/intelligence", requireHrPermission("reports.view"), getHrIntelligenceHandler);

export default router;

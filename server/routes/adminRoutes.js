import express from "express";
import { getAdminOverview, getAdminDashboard } from "../controllers/adminController.js";
import {
  getAdminAttendanceOverviewHandler,
  getAdminEmployeeAttendanceHistoryHandler,
} from "../controllers/attendanceController.js";
import { getHrIntelligenceHandler } from "../controllers/hrIntelligenceController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));
router.get("/overview", getAdminOverview);
router.get("/dashboard", getAdminDashboard);
router.get("/attendance/overview", getAdminAttendanceOverviewHandler);
router.get("/attendance/employee/:id", getAdminEmployeeAttendanceHistoryHandler);
router.get("/intelligence", getHrIntelligenceHandler);

export default router;


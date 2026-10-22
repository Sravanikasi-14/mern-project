import express from "express";
import { getAdminOverview } from "../controllers/adminController.js";
import { getAdminAttendanceOverviewHandler } from "../controllers/attendanceController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));
router.get("/overview", getAdminOverview);
router.get("/attendance/overview", getAdminAttendanceOverviewHandler);

export default router;

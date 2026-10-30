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
  getMyProfile,
  resendInvitation,
  updateEmployee,
  updateMyProfile,
  uploadEmployeeDocument,
} from "../controllers/employeeController.js";
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
} from "../controllers/attendanceController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Authenticated employee self-service routes
router.get("/me", authenticate, getMyProfile);
router.get("/me/dashboard", authenticate, getEmployeeDashboard);

// Attendance routes
router.post("/me/attendance/punch-in", authenticate, punchIn);
router.post("/me/attendance/punch-out", authenticate, punchOut);
router.post("/me/attendance/check-in", authenticate, handleCheckIn);
router.post("/me/attendance/check-out", authenticate, handleCheckOut);
router.get("/me/attendance/status", authenticate, getAttendanceStatus);
router.get("/me/attendance/history", authenticate, getAttendanceHistory);

// Live tracking routes
router.post("/me/tracking/start", authenticate, startTracking);
router.post("/me/tracking/update", authenticate, updateTrackingLocation);
router.post("/me/tracking/stop", authenticate, stopTracking);
router.get("/me/tracking/status", authenticate, getTrackingStatusHandler);

router.post("/me/leave-requests", authenticate, applyLeave);
router.get("/me/payslips/:payslipId/download", authenticate, downloadPayslip);
router.patch("/me", authenticate, updateMyProfile);
router.post("/me/documents", authenticate, uploadEmployeeDocument);
router.get("/me/documents/:docId/download", authenticate, downloadDocument);

// Document download with strict role/employee ownership authorization
router.get("/:id/documents/:docId/download", authenticate, downloadDocument);

// Document upload for employee self-service or HR management
router.post("/:id/documents", authenticate, uploadEmployeeDocument);

// Management routes restricted to HR_ADMIN
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/summary", getEmployeeSummary);
router.get("/", getEmployees);
router.post("/", createEmployee);
router.post("/:id/resend-invite", resendInvitation);
router.get("/:id", getEmployeeById);
router.patch("/:id", updateEmployee);

export default router;

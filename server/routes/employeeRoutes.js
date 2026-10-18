import express from "express";
import {
  createEmployee,
  downloadDocument,
  downloadPayslip,
  employeeCheckIn,
  employeeCheckOut,
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
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Authenticated employee self-service routes
router.get("/me", authenticate, getMyProfile);
router.get("/me/dashboard", authenticate, getEmployeeDashboard);
router.post("/me/attendance/check-in", authenticate, employeeCheckIn);
router.post("/me/attendance/check-out", authenticate, employeeCheckOut);
router.post("/me/leave-requests", authenticate, applyLeave);
router.get("/me/payslips/:payslipId/download", authenticate, downloadPayslip);
router.patch("/me", authenticate, updateMyProfile);
router.post("/me/documents", authenticate, uploadEmployeeDocument);

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

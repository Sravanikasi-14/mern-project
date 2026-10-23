import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";
import {
  listPayrollCycles,
  createPayrollCycle,
  getPayrollCycleDetails,
  recalculatePayrollCycle,
  finalizePayrollCycle,
  recordCyclePayment,
  getEmployeePayslips,
  downloadPayslipPdf,
} from "../controllers/payrollController.js";

const router = express.Router();

// All payroll routes require authenticated tenant context
router.use(authenticate);

// ==========================================
// Employee Self-Service Payslip Endpoints
// Accessible to both EMPLOYEE and HR_ADMIN
// ==========================================
router.get("/employee/payslips", getEmployeePayslips);
router.get("/employee/payslips/:payslipId/download", downloadPayslipPdf);
router.get("/payslips/:payslipId/download", downloadPayslipPdf);

// ==========================================
// HR Admin Payroll Administration Endpoints
// Restricted exclusively to HR_ADMIN
// ==========================================
router.get("/cycles", requireRole(USER_ROLES.HR_ADMIN), listPayrollCycles);
router.post("/cycles", requireRole(USER_ROLES.HR_ADMIN), createPayrollCycle);
router.get("/cycles/:cycleId", requireRole(USER_ROLES.HR_ADMIN), getPayrollCycleDetails);
router.post("/cycles/:cycleId/calculate", requireRole(USER_ROLES.HR_ADMIN), recalculatePayrollCycle);
router.post("/cycles/:cycleId/recalculate", requireRole(USER_ROLES.HR_ADMIN), recalculatePayrollCycle);
router.post("/cycles/:cycleId/finalize", requireRole(USER_ROLES.HR_ADMIN), finalizePayrollCycle);
router.post("/cycles/:cycleId/pay", requireRole(USER_ROLES.HR_ADMIN), recordCyclePayment);
router.post("/cycles/:cycleId/payments", requireRole(USER_ROLES.HR_ADMIN), recordCyclePayment);

export default router;

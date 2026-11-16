import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireEntitledModule,
  requireHrPermission,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";
import {
  listPayrollCycles,
  createPayrollCycle,
  getPayrollCycleDetails,
  exportPayrollCycleRegister,
  recalculatePayrollCycle,
  finalizePayrollCycle,
  recordCyclePayment,
  getEmployeePayslips,
  downloadPayslipPdf,
} from "../controllers/payrollController.js";

const router = express.Router();

// All payroll routes require authenticated tenant context
router.use(authenticate);

// Employee self-service — platform payroll entitlement + assertCanAccessPayslip
router.get("/employee/payslips", requireEntitledModule("payroll"), getEmployeePayslips);
router.get(
  "/employee/payslips/:payslipId/download",
  requireEntitledModule("payroll"),
  downloadPayslipPdf
);
router.get("/payslips/:payslipId/download", requireEntitledModule("payroll"), downloadPayslipPdf);

// HR Admin payroll administration
router.get(
  "/cycles",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.view"),
  listPayrollCycles
);
router.post(
  "/cycles",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.create"),
  createPayrollCycle
);
router.get(
  "/cycles/:cycleId",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.view"),
  getPayrollCycleDetails
);
router.get(
  "/cycles/:cycleId/export",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.view"),
  exportPayrollCycleRegister
);
router.post(
  "/cycles/:cycleId/calculate",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.calculate"),
  recalculatePayrollCycle
);
router.post(
  "/cycles/:cycleId/recalculate",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.calculate"),
  recalculatePayrollCycle
);
router.post(
  "/cycles/:cycleId/finalize",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.finalize"),
  finalizePayrollCycle
);
router.post(
  "/cycles/:cycleId/pay",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.pay"),
  recordCyclePayment
);
router.post(
  "/cycles/:cycleId/payments",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("payroll.pay"),
  recordCyclePayment
);

export default router;

import express from "express";
import {
  completeSettlement,
  getMySettlement,
  getSettlementById,
  getSettlements,
  initiateSettlement,
  recordSettlementPayment,
  updateSettlementDraft,
  updateSettlementStatus,
} from "../controllers/settlementController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireHrPermission,
  requireEmployeeInScope,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.get(
  "/my-settlement",
  authenticate,
  requireRole(USER_ROLES.EMPLOYEE),
  getMySettlement
);

router.post(
  "/initiate",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.create"),
  requireEmployeeInScope((req) => req.body?.employeeId),
  initiateSettlement
);

router.get(
  "/",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.view"),
  getSettlements
);

router.get(
  "/:id",
  authenticate,
  loadHrAccessContext,
  // HR path requires settlements.view when ENFORCED; employees pass through assertHrPermission
  requireHrPermission("settlements.view"),
  getSettlementById
);

router.patch(
  "/:id",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.edit"),
  updateSettlementDraft
);

router.put(
  "/:id",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.edit"),
  updateSettlementDraft
);

router.put(
  "/:id/draft",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.edit"),
  updateSettlementDraft
);

router.post(
  "/:id/status",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.edit"),
  updateSettlementStatus
);

router.put(
  "/:id/status",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.edit"),
  updateSettlementStatus
);

router.post(
  "/:id/pay",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.pay"),
  recordSettlementPayment
);

router.post(
  "/:id/payment",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.pay"),
  recordSettlementPayment
);

router.post(
  "/:id/complete",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("settlements.complete"),
  completeSettlement
);

export default router;

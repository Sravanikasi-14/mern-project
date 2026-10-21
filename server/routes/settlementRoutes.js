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
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Employee portal self-service route
router.get(
  "/my-settlement",
  authenticate,
  requireRole(USER_ROLES.EMPLOYEE),
  getMySettlement
);

// HR Admin settlement management routes
router.post(
  "/initiate",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  initiateSettlement
);

router.get(
  "/",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  getSettlements
);

router.get("/:id", authenticate, getSettlementById);

router.patch(
  "/:id",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  updateSettlementDraft
);

router.put(
  "/:id",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  updateSettlementDraft
);

router.put(
  "/:id/draft",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  updateSettlementDraft
);

router.post(
  "/:id/status",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  updateSettlementStatus
);

router.put(
  "/:id/status",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  updateSettlementStatus
);

router.post(
  "/:id/pay",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  recordSettlementPayment
);

router.post(
  "/:id/payment",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  recordSettlementPayment
);

router.post(
  "/:id/complete",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN),
  completeSettlement
);

export default router;

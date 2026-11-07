import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireHrPermission,
  requireEmployeeInScope,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";
import {
  getMyPointsSummary,
  getEmployeePointsSummary,
  getLeaderboard,
  awardRecognition,
  getTransactionLedger,
  reverseTransaction,
  getImpactPointRules,
  updateImpactPointRules,
} from "../controllers/impactPointController.js";

const router = express.Router();

router.use(authenticate, loadHrAccessContext);

// Employee & Manager personal endpoints
router.get("/me", getMyPointsSummary);
router.get(
  "/employee/:employeeId",
  requireHrPermission("impact.view"),
  requireEmployeeInScope((req) =>
    req.auth?.user?.role === USER_ROLES.HR_ADMIN ? req.params.employeeId : null
  ),
  getEmployeePointsSummary
);
router.get("/leaderboard", requireHrPermission("impact.view"), getLeaderboard);
router.get("/transactions", requireHrPermission("impact.view"), getTransactionLedger);
router.post("/recognize", requireHrPermission("impact.manage"), awardRecognition);

// Rules endpoints
router.get("/rules", getImpactPointRules);
router.patch(
  "/rules",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  requireHrPermission("impact.manage"),
  updateImpactPointRules
);

// Reversal (HR Admin only)
router.post(
  "/transactions/:id/reverse",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  requireHrPermission("impact.manage"),
  reverseTransaction
);

export default router;

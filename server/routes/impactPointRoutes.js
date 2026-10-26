import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
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

router.use(authenticate);

// Employee & Manager personal endpoints
router.get("/me", getMyPointsSummary);
router.get("/employee/:employeeId", getEmployeePointsSummary);
router.get("/leaderboard", getLeaderboard);
router.get("/transactions", getTransactionLedger);
router.post("/recognize", awardRecognition);

// Rules endpoints
router.get("/rules", getImpactPointRules);
router.patch("/rules", requireRole(USER_ROLES.HR_ADMIN), updateImpactPointRules);

// Reversal (HR Admin only)
router.post("/transactions/:id/reverse", requireRole(USER_ROLES.HR_ADMIN), reverseTransaction);

export default router;

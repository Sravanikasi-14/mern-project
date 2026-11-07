import express from "express";
import {
  changeLeaveType,
  decideLeaveRequest,
  getCompanyHrPolicy,
  getLeaveBackupRecommendations,
  getLeaveImpactAnalysis,
  getLeaveRequestById,
  getLeaveRequests,
  getLeaveSummary,
  saveLeaveBackupProposal,
} from "../controllers/leaveController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

import { subscribeLeaveEvents } from "../services/leaveEventsService.js";

const router = express.Router();

// SSE live synchronization endpoint for both EMPLOYEE and HR_ADMIN (scoped when ENFORCED)
router.get("/events", authenticate, loadHrAccessContext, subscribeLeaveEvents);

// Enforce authentication and HR_ADMIN authorization on all HR leave endpoints
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/summary", requireHrPermission("leave.view"), getLeaveSummary);
router.get("/policy", requireHrPermission("leave.view"), getCompanyHrPolicy);
router.get("/", requireHrPermission("leave.view"), getLeaveRequests);
router.get("/:id/impact", requireHrPermission("leave.view"), getLeaveImpactAnalysis);
router.get("/:id/backup-recommendations", requireHrPermission("leave.edit"), getLeaveBackupRecommendations);
router.put("/:id/backup-proposals", requireHrPermission("leave.edit"), saveLeaveBackupProposal);
router.get("/:id", requireHrPermission("leave.view"), getLeaveRequestById);
router.post("/:id/decision", requireHrPermission("leave.approve"), decideLeaveRequest);
router.patch("/:id/leave-type", requireHrPermission("leave.edit"), changeLeaveType);

export default router;

import express from "express";
import {
  changeLeaveType,
  decideLeaveRequest,
  getCompanyHrPolicy,
  getLeaveRequestById,
  getLeaveRequests,
  getLeaveSummary,
} from "../controllers/leaveController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

import { subscribeLeaveEvents } from "../services/leaveEventsService.js";

const router = express.Router();

// SSE live synchronization endpoint for both EMPLOYEE and HR_ADMIN
router.get("/events", authenticate, subscribeLeaveEvents);

// Enforce authentication and HR_ADMIN authorization on all HR leave endpoints
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/summary", getLeaveSummary);
router.get("/policy", getCompanyHrPolicy);
router.get("/", getLeaveRequests);
router.get("/:id", getLeaveRequestById);
router.post("/:id/decision", decideLeaveRequest);
router.patch("/:id/leave-type", changeLeaveType);

export default router;

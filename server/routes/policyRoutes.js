import express from "express";
import {
  getActivePolicy,
  getPolicyHistory,
  getPolicyById,
  createPolicyRevision,
  updatePolicyRevision,
  deletePolicyRevision,
  checkLeaveTypeInUse,
} from "../controllers/policyController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Active policy can be queried by any authenticated employee or HR Admin
router.get("/active", authenticate, getActivePolicy);

// All policy management, revision history, and updates strictly require HR_ADMIN
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/history", getPolicyHistory);
router.get("/leave-types/:code/in-use", checkLeaveTypeInUse);
router.get("/:id", getPolicyById);
router.post("/", createPolicyRevision);
router.put("/:id", updatePolicyRevision);
router.delete("/:id", deletePolicyRevision);

export default router;

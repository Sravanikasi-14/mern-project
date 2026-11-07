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
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.get("/active", authenticate, getActivePolicy);

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/history", requireHrPermission("policies.view"), getPolicyHistory);
router.get("/leave-types/:code/in-use", requireHrPermission("policies.view"), checkLeaveTypeInUse);
router.get("/:id", requireHrPermission("policies.view"), getPolicyById);
router.post("/", requireHrPermission("policies.create"), createPolicyRevision);
router.put("/:id", requireHrPermission("policies.edit"), updatePolicyRevision);
router.delete("/:id", requireHrPermission("policies.delete"), deletePolicyRevision);

export default router;

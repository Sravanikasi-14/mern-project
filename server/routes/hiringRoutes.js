import express from "express";
import {
  getHiringCandidateOnboardingRef,
  getHiringCandidateSummary,
  listHiringCandidates,
} from "../controllers/hiringWorkspaceController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/candidates", requireHrPermission("hiring.view"), listHiringCandidates);
router.get("/candidates/:offerId", requireHrPermission("hiring.view"), getHiringCandidateSummary);
router.get("/candidates/:offerId/onboarding", requireHrPermission("hiring.view"), getHiringCandidateOnboardingRef);

export default router;

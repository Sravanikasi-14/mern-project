import express from "express";
import {
  approveOnboardingAndCreateEmployee,
  downloadSubmissionDocument,
  getOnboardingSubmissionById,
  getOnboardingSubmissions,
  rejectOnboardingSubmission,
  requestOnboardingCorrections,
  resendEmployeeActivationEmail,
  reviewOnboardingSection,
} from "../controllers/onboardingReviewController.js";
import { subscribeOnboardingEvents } from "../services/onboardingEventsService.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/events", requireHrPermission("hiring.view"), subscribeOnboardingEvents);

router.get("/submissions", requireHrPermission("hiring.view"), getOnboardingSubmissions);
router.get("/submissions/:id", requireHrPermission("hiring.view"), getOnboardingSubmissionById);
router.get(
  "/submissions/:id/documents/:docId/download",
  requireHrPermission("hiring.view"),
  downloadSubmissionDocument
);
router.post(
  "/submissions/:id/sections/:section/review",
  requireHrPermission("hiring.approve"),
  reviewOnboardingSection
);
router.post(
  "/submissions/:id/request-corrections",
  requireHrPermission("hiring.approve"),
  requestOnboardingCorrections
);
router.post("/submissions/:id/reject", requireHrPermission("hiring.approve"), rejectOnboardingSubmission);
router.post(
  "/submissions/:id/approve",
  requireHrPermission("hiring.approve"),
  approveOnboardingAndCreateEmployee
);
router.post(
  "/submissions/:id/resend-activation",
  requireHrPermission("hiring.approve"),
  resendEmployeeActivationEmail
);

export default router;

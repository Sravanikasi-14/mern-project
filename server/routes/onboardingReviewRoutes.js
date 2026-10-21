import express from "express";
import {
  approveOnboardingAndCreateEmployee,
  downloadSubmissionDocument,
  getOnboardingSubmissionById,
  getOnboardingSubmissions,
  rejectOnboardingSubmission,
  requestOnboardingCorrections,
  resendEmployeeActivationEmail,
} from "../controllers/onboardingReviewController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// HR_ADMIN protected routes
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/submissions", getOnboardingSubmissions);
router.get("/submissions/:id", getOnboardingSubmissionById);
router.get("/submissions/:id/documents/:docId/download", downloadSubmissionDocument);
router.post("/submissions/:id/request-corrections", requestOnboardingCorrections);
router.post("/submissions/:id/reject", rejectOnboardingSubmission);
router.post("/submissions/:id/approve", approveOnboardingAndCreateEmployee);
router.post("/submissions/:id/resend-activation", resendEmployeeActivationEmail);

export default router;

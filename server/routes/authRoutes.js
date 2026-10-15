import express from "express";
import {
  completeOnboarding,
  login,
  logout,
  me,
  setupInitialAdmin,
  verifyOnboardingInvitation,
} from "../controllers/authController.js";
import { authenticate } from "../middleware/authenticate.js";
import { loginLimiter } from "../middleware/loginLimiter.js";

const router = express.Router();

router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.get("/me", authenticate, me);

// Controlled initial HR Admin setup for already-provisioned companies
router.post("/setup-initial-admin", loginLimiter, setupInitialAdmin);
router.post("/onboarding/setup", loginLimiter, setupInitialAdmin);

router.get("/onboarding/verify", verifyOnboardingInvitation);
router.post("/onboarding/complete", completeOnboarding);

export default router;

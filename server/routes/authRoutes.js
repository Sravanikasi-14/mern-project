import express from "express";
import {
  completeOnboarding,
  login,
  logout,
  refreshSession,
  me,
  updateProfile,
  uploadProfileAvatar,
  deleteProfileAvatar,
  streamOwnAvatar,
  changePassword,
  setupInitialAdmin,
  verifyOnboardingInvitation,
} from "../controllers/authController.js";
import { streamCompanyLogo } from "../controllers/settingsController.js";
import {
  verifyActivationTokenEndpoint,
  completeActivation,
} from "../controllers/accountActivationController.js";
import { authenticate } from "../middleware/authenticate.js";
import { loginLimiter, refreshSessionLimiter } from "../middleware/loginLimiter.js";

const router = express.Router();

router.post("/login", loginLimiter, login);
router.post("/refresh", refreshSessionLimiter, refreshSession);
router.post("/logout", logout);
router.get("/me", authenticate, me);

router.get("/company-logo", authenticate, streamCompanyLogo);
router.put("/profile", authenticate, updateProfile);
router.post("/profile/avatar", authenticate, uploadProfileAvatar);
router.delete("/profile/avatar", authenticate, deleteProfileAvatar);
router.get("/avatar", authenticate, streamOwnAvatar);
router.post("/change-password", authenticate, changePassword);

// Controlled initial HR Admin setup for already-provisioned companies
router.post("/setup-initial-admin", loginLimiter, setupInitialAdmin);
router.post("/onboarding/setup", loginLimiter, setupInitialAdmin);

router.get("/onboarding/verify", verifyOnboardingInvitation);
router.get("/onboard/verify", verifyOnboardingInvitation);
router.post("/onboarding/complete", completeOnboarding);
router.post("/onboard/complete", completeOnboarding);

// Stage 6: Employee account activation & password setup
router.get("/activate/verify", verifyActivationTokenEndpoint);
router.post("/activate/complete", completeActivation);

export default router;

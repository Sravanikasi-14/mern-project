import express from "express";
import {
  deleteOnboardingDocument,
  downloadOnboardingDocument,
  getCandidateOnboarding,
  saveOnboardingDraft,
  submitOnboarding,
  uploadOnboardingDocument,
} from "../controllers/candidateOnboardingController.js";

const router = express.Router();

// Candidate token-secured endpoints (isolated to candidate's own record via signed token)
router.get("/:token", getCandidateOnboarding);
router.put("/:token/draft", saveOnboardingDraft);
router.post("/:token/documents", uploadOnboardingDocument);
router.delete("/:token/documents/:docId", deleteOnboardingDocument);
router.get("/:token/documents/:docId/download", downloadOnboardingDocument);
router.post("/:token/submit", submitOnboarding);

export default router;

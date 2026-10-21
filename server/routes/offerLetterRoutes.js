import express from "express";
import {
  createOfferLetter,
  deleteOfferLetter,
  downloadOfferLetterPdf,
  getDefaultClauses,
  getOfferLetterById,
  getOfferLetters,
  getOfferRecipients,
  getOfferSummary,
  linkEmployeeToOffer,
  previewOfferLetter,
  sendOfferLetterEmail,
  updateOfferLetter,
  updateOfferStatus,
} from "../controllers/offerLetterController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { emailSendLimiter } from "../middleware/emailLimiter.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Enforce authentication and HR_ADMIN authorization on all offer letter operations
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/clauses", getDefaultClauses);
router.get("/clauses/defaults", getDefaultClauses);
router.get("/summary", getOfferSummary);
router.get("/recipients", getOfferRecipients);
router.post("/preview", previewOfferLetter);

router.get("/", getOfferLetters);
router.post("/", createOfferLetter);

router.get("/:id", getOfferLetterById);
router.put("/:id", updateOfferLetter);
router.delete("/:id", deleteOfferLetter);

router.post("/:id/send", emailSendLimiter, sendOfferLetterEmail);
router.patch("/:id/status", updateOfferStatus);
router.post("/:id/status", updateOfferStatus);
router.get("/:id/pdf", downloadOfferLetterPdf);
router.post("/:id/link-employee", linkEmployeeToOffer);

export default router;

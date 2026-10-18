import express from "express";
import {
  createOfferLetter,
  deleteOfferLetter,
  downloadOfferLetterPdf,
  getDefaultClauses,
  getOfferLetterById,
  getOfferLetters,
  getOfferSummary,
  linkEmployeeToOffer,
  previewOfferLetter,
  updateOfferLetter,
  updateOfferStatus,
} from "../controllers/offerLetterController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Enforce authentication and HR_ADMIN authorization on all offer letter operations
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/clauses", getDefaultClauses);
router.get("/clauses/defaults", getDefaultClauses);
router.get("/summary", getOfferSummary);
router.post("/preview", previewOfferLetter);

router.get("/", getOfferLetters);
router.post("/", createOfferLetter);

router.get("/:id", getOfferLetterById);
router.put("/:id", updateOfferLetter);
router.delete("/:id", deleteOfferLetter);

router.patch("/:id/status", updateOfferStatus);
router.post("/:id/status", updateOfferStatus);
router.get("/:id/pdf", downloadOfferLetterPdf);
router.post("/:id/link-employee", linkEmployeeToOffer);

export default router;

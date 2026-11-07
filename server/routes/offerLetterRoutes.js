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
  withdrawOfferLetter,
} from "../controllers/offerLetterController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { emailSendLimiter } from "../middleware/emailLimiter.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/clauses", requireHrPermission("hiring.view"), getDefaultClauses);
router.get("/clauses/defaults", requireHrPermission("hiring.view"), getDefaultClauses);
router.get("/summary", requireHrPermission("hiring.view"), getOfferSummary);
router.get("/recipients", requireHrPermission("hiring.view"), getOfferRecipients);
router.post("/preview", requireHrPermission("hiring.view"), previewOfferLetter);

router.get("/", requireHrPermission("hiring.view"), getOfferLetters);
router.post("/", requireHrPermission("hiring.create"), createOfferLetter);

router.get("/:id", requireHrPermission("hiring.view"), getOfferLetterById);
router.put("/:id", requireHrPermission("hiring.edit"), updateOfferLetter);
router.delete("/:id", requireHrPermission("hiring.delete"), deleteOfferLetter);

router.post("/:id/send", requireHrPermission("hiring.send"), emailSendLimiter, sendOfferLetterEmail);
router.post("/:id/withdraw", requireHrPermission("hiring.withdraw"), withdrawOfferLetter);
router.patch("/:id/status", requireHrPermission("hiring.edit"), updateOfferStatus);
router.post("/:id/status", requireHrPermission("hiring.edit"), updateOfferStatus);
router.get("/:id/pdf", requireHrPermission("hiring.view"), downloadOfferLetterPdf);
router.post("/:id/link-employee", requireHrPermission("hiring.edit"), linkEmployeeToOffer);

export default router;

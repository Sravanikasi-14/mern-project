import express from "express";
import {
  listOfferTemplates,
  getOfferTemplate,
  createOfferTemplate,
  updateOfferTemplate,
  uploadOfferTemplateDocx,
  previewOfferTemplate,
  generateTemplateDocx,
  generateTemplatePdf,
  downloadTemplateSource,
  deleteOfferTemplate,
} from "../controllers/offerTemplateController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext
);

router.get("/", requireHrPermission("hiring.view"), listOfferTemplates);
router.post("/", requireHrPermission("hiring.edit"), createOfferTemplate);

router.get("/:id", requireHrPermission("hiring.view"), getOfferTemplate);
router.patch("/:id", requireHrPermission("hiring.edit"), updateOfferTemplate);
router.delete("/:id", requireHrPermission("hiring.delete"), deleteOfferTemplate);

router.post("/:id/docx", requireHrPermission("hiring.edit"), uploadOfferTemplateDocx);
router.post("/:id/preview", requireHrPermission("hiring.view"), previewOfferTemplate);
router.post("/:id/generate-docx", requireHrPermission("hiring.edit"), generateTemplateDocx);
router.post("/:id/generate-pdf", requireHrPermission("hiring.edit"), generateTemplatePdf);
router.get("/:id/source-download", requireHrPermission("hiring.view"), downloadTemplateSource);

export default router;

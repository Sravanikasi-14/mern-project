import express from "express";
import {
  getEmailSettings,
  updateEmailSettings,
  sendTestEmailSettings,
  getCompanySettings,
  updateCompanySettings,
  getOrganizationExplorerSettings,
  updateOrganizationExplorerSettings,
  getAuditLogsSettings,
  uploadCompanyLogo,
  deleteCompanyLogo,
  saveCompanySignature,
  streamCompanySignature,
  deleteCompanySignature,
} from "../controllers/settingsController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { emailSendLimiter } from "../middleware/emailLimiter.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.get(
  "/organization-explorer",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN, USER_ROLES.EMPLOYEE),
  loadHrAccessContext,
  requireHrPermission("organization.view"),
  getOrganizationExplorerSettings
);
router.put(
  "/organization-explorer",
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("organization.manage"),
  updateOrganizationExplorerSettings
);

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/company", requireHrPermission("settings.view"), getCompanySettings);
router.put("/company", requireHrPermission("settings.edit"), updateCompanySettings);
router.post("/company/logo", requireHrPermission("settings.edit"), uploadCompanyLogo);
router.delete("/company/logo", requireHrPermission("settings.edit"), deleteCompanyLogo);
router.post("/company/signature", requireHrPermission("settings.edit"), saveCompanySignature);
router.get("/company/signature", requireHrPermission("settings.view"), streamCompanySignature);
router.delete("/company/signature", requireHrPermission("settings.edit"), deleteCompanySignature);
router.get("/audit-logs", requireHrPermission("settings.view"), getAuditLogsSettings);
router.get("/email", requireHrPermission("settings.view"), getEmailSettings);
router.put("/email", requireHrPermission("settings.edit"), updateEmailSettings);
router.post("/email/test", requireHrPermission("settings.edit"), emailSendLimiter, sendTestEmailSettings);

export default router;

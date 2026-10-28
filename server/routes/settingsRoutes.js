import express from "express";
import {
  getEmailSettings,
  updateEmailSettings,
  sendTestEmailSettings,
  getCompanySettings,
  updateCompanySettings,
  getAuditLogsSettings,
  uploadCompanyLogo,
  deleteCompanyLogo,
} from "../controllers/settingsController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { emailSendLimiter } from "../middleware/emailLimiter.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/company", getCompanySettings);
router.put("/company", updateCompanySettings);
router.post("/company/logo", uploadCompanyLogo);
router.delete("/company/logo", deleteCompanyLogo);
router.get("/audit-logs", getAuditLogsSettings);
router.get("/email", getEmailSettings);
router.put("/email", updateEmailSettings);
router.post("/email/test", emailSendLimiter, sendTestEmailSettings);

export default router;

import express from "express";
import {
  activateCompanyHrAdmin,
  deactivateCompanyHrAdmin,
  getCompanyAdminDashboard,
  getCompanyHrAccessCatalog,
  getCompanyHrAccessEnforcement,
  getCompanyHrAccessOptions,
  getCompanyHrAdmin,
  getCompanyHrAdminAccess,
  getCompanyHrAdminEmployeeProfile,
  getMyEmployeeProfile,
  inviteCompanyHrAdmin,
  listCompanyHrAdmins,
  postCompanyHrAccessBootstrapLegacy,
  putCompanyHrAccessEnforcement,
  putCompanyHrAdminAccess,
  putCompanyHrAdminAccessPermissions,
  putCompanyHrAdminAccessScope,
  putCompanyHrAdminEmployeeProfile,
  putMyEmployeeProfile,
  resendCompanyHrAdminInvite,
  revokeCompanyHrAdminInvite,
} from "../controllers/companyAdminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.COMPANY_ADMIN));
router.get("/dashboard", getCompanyAdminDashboard);

router.get("/hr-access/catalog", getCompanyHrAccessCatalog);
router.get("/hr-access/options", getCompanyHrAccessOptions);
router.get("/hr-access/enforcement", getCompanyHrAccessEnforcement);
router.put("/hr-access/enforcement", putCompanyHrAccessEnforcement);
router.post("/hr-access/bootstrap-legacy", postCompanyHrAccessBootstrapLegacy);

router.get("/me/employee-profile", getMyEmployeeProfile);
router.put("/me/employee-profile", putMyEmployeeProfile);

router.get("/hr-admins", listCompanyHrAdmins);
router.get("/hr-admins/:id/employee-profile", getCompanyHrAdminEmployeeProfile);
router.put("/hr-admins/:id/employee-profile", putCompanyHrAdminEmployeeProfile);
router.post("/hr-admins/invite", inviteCompanyHrAdmin);
router.get("/hr-admins/:id/access", getCompanyHrAdminAccess);
router.put("/hr-admins/:id/access", putCompanyHrAdminAccess);
router.put("/hr-admins/:id/access/scope", putCompanyHrAdminAccessScope);
router.put("/hr-admins/:id/access/permissions", putCompanyHrAdminAccessPermissions);
router.get("/hr-admins/:id", getCompanyHrAdmin);
router.post("/hr-admins/:id/resend", resendCompanyHrAdminInvite);
router.post("/hr-admins/:id/revoke", revokeCompanyHrAdminInvite);
router.post("/hr-admins/:id/deactivate", deactivateCompanyHrAdmin);
router.post("/hr-admins/:id/activate", activateCompanyHrAdmin);

export default router;

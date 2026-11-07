import { buildCompanyAdminDashboard } from "../services/companyAdminDashboardService.js";
import {
  activateHrAdmin,
  deactivateHrAdmin,
  getHrAdminById,
  inviteHrAdmin,
  listHrAdmins,
  resendHrAdminInvitation,
  revokeHrAdminInvitation,
} from "../services/hrAdminManagementService.js";
import {
  getHrAccessCatalog,
  getHrAdminAccessConfig,
  listAccessConfigOptions,
  updateHrAdminAccess,
  updateHrAdminEmployeeScope,
  updateHrAdminPermissions,
} from "../services/hrAccessConfigService.js";
import {
  bootstrapLegacyHrAccess,
  getHrAccessEnforcementReadiness,
  setHrAccessEnforcementMode,
} from "../services/hrAccessRolloutService.js";
import {
  getPortalEmployeeProfile,
  linkPortalOperatorEmployee,
} from "../services/portalIdentityLinkService.js";
import { USER_ROLES } from "../models/User.js";

/**
 * GET /api/company-admin/dashboard
 * Company Admin–only aggregate oversight payload for the authenticated tenant.
 */
export async function getCompanyAdminDashboard(req, res, next) {
  try {
    const payload = await buildCompanyAdminDashboard({
      company: req.auth.company,
      models: req.auth.models,
    });

    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-admins */
export async function listCompanyHrAdmins(req, res, next) {
  try {
    const result = await listHrAdmins({
      models: req.auth.models,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-admins/:id */
export async function getCompanyHrAdmin(req, res, next) {
  try {
    const hrAdmin = await getHrAdminById({
      models: req.auth.models,
      hrAdminId: req.params.id,
    });
    res.json({ success: true, hrAdmin });
  } catch (error) {
    next(error);
  }
}

/** POST /api/company-admin/hr-admins/invite */
export async function inviteCompanyHrAdmin(req, res, next) {
  try {
    const result = await inviteHrAdmin({
      models: req.auth.models,
      company: req.auth.company,
      actor: req.auth.user,
      fullName: req.body?.fullName,
      email: req.body?.email,
      ipAddress: req.ip || "",
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** POST /api/company-admin/hr-admins/:id/resend */
export async function resendCompanyHrAdminInvite(req, res, next) {
  try {
    const result = await resendHrAdminInvitation({
      models: req.auth.models,
      company: req.auth.company,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** POST /api/company-admin/hr-admins/:id/revoke */
export async function revokeCompanyHrAdminInvite(req, res, next) {
  try {
    const result = await revokeHrAdminInvitation({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** POST /api/company-admin/hr-admins/:id/deactivate */
export async function deactivateCompanyHrAdmin(req, res, next) {
  try {
    const result = await deactivateHrAdmin({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** POST /api/company-admin/hr-admins/:id/activate */
export async function activateCompanyHrAdmin(req, res, next) {
  try {
    const result = await activateHrAdmin({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-access/catalog */
export async function getCompanyHrAccessCatalog(req, res, next) {
  try {
    const catalog = await getHrAccessCatalog();
    res.json({ success: true, catalog });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-access/options */
export async function getCompanyHrAccessOptions(req, res, next) {
  try {
    const result = await listAccessConfigOptions({
      models: req.auth.models,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-admins/:id/access */
export async function getCompanyHrAdminAccess(req, res, next) {
  try {
    const result = await getHrAdminAccessConfig({
      models: req.auth.models,
      hrAdminId: req.params.id,
      actor: req.auth.user,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/company-admin/hr-admins/:id/access */
export async function putCompanyHrAdminAccess(req, res, next) {
  try {
    const result = await updateHrAdminAccess({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      employeeScope: req.body?.employeeScope,
      permissions: req.body?.permissions,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/company-admin/hr-admins/:id/access/scope */
export async function putCompanyHrAdminAccessScope(req, res, next) {
  try {
    const result = await updateHrAdminEmployeeScope({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      employeeScope: req.body?.employeeScope ?? req.body,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/company-admin/hr-admins/:id/access/permissions */
export async function putCompanyHrAdminAccessPermissions(req, res, next) {
  try {
    const result = await updateHrAdminPermissions({
      models: req.auth.models,
      actor: req.auth.user,
      hrAdminId: req.params.id,
      permissions: req.body?.permissions,
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-access/enforcement */
export async function getCompanyHrAccessEnforcement(req, res, next) {
  try {
    const readiness = await getHrAccessEnforcementReadiness({
      models: req.auth.models,
      company: req.auth.company,
    });
    res.json({ success: true, ...readiness });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/company-admin/hr-access/bootstrap-legacy
 * Explicit migration: COMPANY scope + full catalog for unconfigured HR Admins.
 * Does not turn enforcement on.
 */
export async function postCompanyHrAccessBootstrapLegacy(req, res, next) {
  try {
    const result = await bootstrapLegacyHrAccess({
      models: req.auth.models,
      actor: req.auth.user,
      company: req.auth.company,
      force: Boolean(req.body?.force),
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/company-admin/hr-access/enforcement
 * Body: { mode: "OFF" | "ENFORCED", reason?: string }
 */
export async function putCompanyHrAccessEnforcement(req, res, next) {
  try {
    const result = await setHrAccessEnforcementMode({
      models: req.auth.models,
      actor: req.auth.user,
      company: req.auth.company,
      mode: req.body?.mode,
      reason: req.body?.reason || "",
      ipAddress: req.ip || "",
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/me/employee-profile */
export async function getMyEmployeeProfile(req, res, next) {
  try {
    const result = await getPortalEmployeeProfile({
      models: req.auth.models,
      userId: req.auth.user._id,
      expectedRole: USER_ROLES.COMPANY_ADMIN,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/company-admin/me/employee-profile */
export async function putMyEmployeeProfile(req, res, next) {
  try {
    const result = await linkPortalOperatorEmployee({
      models: req.auth.models,
      company: req.auth.company,
      user: req.auth.user._id,
      profile: req.body || {},
      updateEmployment: true,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** GET /api/company-admin/hr-admins/:id/employee-profile */
export async function getCompanyHrAdminEmployeeProfile(req, res, next) {
  try {
    const result = await getPortalEmployeeProfile({
      models: req.auth.models,
      userId: req.params.id,
      expectedRole: USER_ROLES.HR_ADMIN,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/company-admin/hr-admins/:id/employee-profile */
export async function putCompanyHrAdminEmployeeProfile(req, res, next) {
  try {
    const account = await req.auth.models.User.findOne({
      _id: req.params.id,
      role: USER_ROLES.HR_ADMIN,
    }).select("_id role");
    if (!account) {
      res.status(404).json({
        success: false,
        message: "HR Admin account not found.",
        code: "HR_ADMIN_NOT_FOUND",
      });
      return;
    }
    const result = await linkPortalOperatorEmployee({
      models: req.auth.models,
      company: req.auth.company,
      user: account._id,
      profile: req.body || {},
      updateEmployment: true,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

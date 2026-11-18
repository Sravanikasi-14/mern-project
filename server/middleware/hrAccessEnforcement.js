import {
  resolveHrAccessContext,
  assertHrPermission,
  assertEmployeeInScope,
} from "../services/hrAccessEnforcementService.js";
import { assertHrPermissionEntitled } from "../services/platformEntitlementService.js";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

async function auditHrAccessDenied(req, metadata = {}) {
  try {
    const models = req.auth?.models;
    const user = req.auth?.user;
    if (!models?.AuditLog || !user?._id) return;
    await models.AuditLog.create({
      actorUserId: user._id,
      actorEmail: user.email || "unknown",
      actorRole: user.role,
      action: AUDIT_ACTIONS.HR_ACCESS_DENIED,
      targetType: "HrAccess",
      targetId: user._id,
      changes: {
        ...metadata,
        path: req.originalUrl,
        method: req.method,
      },
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch {
    /* non-blocking */
  }
}

/**
 * Loads HR access context onto req.hrAccess after authenticate.
 * Safe for COMPANY_ADMIN and EMPLOYEE (no-op enforcement).
 */
export async function loadHrAccessContext(req, res, next) {
  try {
    if (!req.auth?.user || !req.auth?.company || !req.auth?.models) {
      return next();
    }
    req.hrAccess = await resolveHrAccessContext({
      user: req.auth.user,
      company: req.auth.company,
      models: req.auth.models,
    });
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Require an exact catalog permission when enforcement is ON for HR_ADMIN.
 * Other roles pass through (subject to requireRole elsewhere).
 */
export function requireHrPermission(permissionKey) {
  return async (req, res, next) => {
    try {
      // Platform entitlements apply to Company Admin and HR Admin alike.
      if (req.auth?.company) {
        await assertHrPermissionEntitled(req.auth.company, permissionKey);
      }
      if (!req.hrAccess) {
        req.hrAccess = await resolveHrAccessContext({
          user: req.auth.user,
          company: req.auth.company,
          models: req.auth.models,
        });
      }
      assertHrPermission(req.hrAccess, permissionKey);
      return next();
    } catch (err) {
      if (
        err.status === 403 &&
        req.auth?.user?.role === USER_ROLES.HR_ADMIN &&
        err.code !== "PLATFORM_MODULE_DISABLED" &&
        err.code !== "PLATFORM_FEATURE_DISABLED"
      ) {
        await auditHrAccessDenied(req, {
          code: err.code || "HR_PERMISSION_DENIED",
          permission: permissionKey,
        });
      }
      return next(err);
    }
  };
}

/** Gate a route by platform module key (for routes without an HR permission key). */
export function requireEntitledModule(moduleKey) {
  return async (req, res, next) => {
    try {
      const { assertModuleEntitled } = await import("../services/platformEntitlementService.js");
      await assertModuleEntitled(req.auth.company, moduleKey);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Allow when any of the listed modules is entitled (fail closed if none are).
 * Used for shared supporting endpoints (e.g. active HR policy used by leave + attendance).
 */
export function requireAnyEntitledModule(...moduleKeys) {
  const keys = moduleKeys.flat().filter(Boolean);
  return async (req, res, next) => {
    try {
      const {
        getEffectiveEntitlementsForCompany,
      } = await import("../services/platformEntitlementService.js");
      const { HttpError } = await import("../utils/httpError.js");
      if (!req.auth?.company) {
        throw new HttpError(403, "This module is not available for your company.", {
          code: "PLATFORM_MODULE_DISABLED",
        });
      }
      const { effective } = await getEffectiveEntitlementsForCompany(req.auth.company, {
        authoritative: true,
      });
      const allowed = keys.some((key) => effective.modules?.[key]?.allowed);
      if (!allowed) {
        throw new HttpError(403, "This module is not available for your company.", {
          code: "PLATFORM_MODULE_DISABLED",
          moduleKeys: keys,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireEntitledCapability(capabilityKey) {
  return async (req, res, next) => {
    try {
      const { assertCapabilityEntitled } = await import("../services/platformEntitlementService.js");
      await assertCapabilityEntitled(req.auth.company, capabilityKey);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Assert employeeId (param or body field) is in scope for enforced HR admins.
 */
export function requireEmployeeInScope(getEmployeeId) {
  return async (req, res, next) => {
    try {
      if (!req.hrAccess) {
        req.hrAccess = await resolveHrAccessContext({
          user: req.auth.user,
          company: req.auth.company,
          models: req.auth.models,
        });
      }
      const employeeId = typeof getEmployeeId === "function" ? getEmployeeId(req) : getEmployeeId;
      if (employeeId) {
        assertEmployeeInScope(req.hrAccess, employeeId);
      }
      return next();
    } catch (err) {
      if (err.status === 403 && req.auth?.user?.role === USER_ROLES.HR_ADMIN) {
        await auditHrAccessDenied(req, {
          code: err.code || "HR_SCOPE_DENIED",
        });
      }
      return next(err);
    }
  };
}

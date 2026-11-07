import mongoose from "mongoose";
import Company from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { HR_SCOPE_MODES, isValidHrPermissionKey } from "../constants/hrAccessCatalog.js";
import { isHrAccessConfigured, serializeHrAccess, updateHrAdminAccess } from "./hrAccessConfigService.js";
import {
  HR_ACCESS_ENFORCEMENT_MODES,
  getHrAccessEnforcementMode,
  getLegacyBootstrapPermissions,
} from "./hrAccessEnforcementService.js";
import { HttpError } from "../utils/httpError.js";

function isObjectId(value) {
  return (
    mongoose.Types.ObjectId.isValid(value) &&
    String(new mongoose.Types.ObjectId(value)) === String(value)
  );
}

async function writeRolloutAudit(models, { actor, action, targetId, changes, ipAddress }) {
  if (!models?.AuditLog || !targetId) return;
  try {
    await models.AuditLog.create({
      actorUserId: actor?._id || null,
      actorEmail: actor?.email || "system",
      actorRole: actor?.role || USER_ROLES.COMPANY_ADMIN,
      action,
      targetType: "HrAccess",
      targetId,
      changes: changes || {},
      ipAddress: ipAddress || "",
      timestamp: new Date(),
    });
  } catch {
    /* non-blocking */
  }
}

/**
 * Evaluate whether one HR Admin's access config is ready for ENFORCED.
 * Does not mutate configuration. Reasons are non-sensitive.
 *
 * @returns {{ ready: boolean, reason: string|null, code: string|null }}
 */
export function evaluateHrAdminAccessReadiness(hrAccess, { existingDepartmentIds, existingEmployeeIds } = {}) {
  if (!isHrAccessConfigured(hrAccess)) {
    return {
      ready: false,
      reason: "Access is not configured.",
      code: "NOT_CONFIGURED",
    };
  }

  if (!Array.isArray(hrAccess.permissions)) {
    return {
      ready: false,
      reason: "Permission configuration is missing or malformed.",
      code: "PERMISSIONS_MALFORMED",
    };
  }

  const permissions = hrAccess.permissions.map((p) => String(p || "").trim()).filter(Boolean);
  if (permissions.length === 0) {
    return {
      ready: false,
      reason: "At least one valid permission must be assigned.",
      code: "PERMISSIONS_EMPTY",
    };
  }

  const invalidKeys = permissions.filter((key) => !isValidHrPermissionKey(key));
  if (invalidKeys.length > 0) {
    return {
      ready: false,
      reason: "One or more assigned permission keys are invalid.",
      code: "PERMISSIONS_INVALID",
    };
  }

  const mode = String(hrAccess.employeeScope?.mode || "").toUpperCase();
  if (mode !== HR_SCOPE_MODES.COMPANY && mode !== HR_SCOPE_MODES.CUSTOM) {
    return {
      ready: false,
      reason: "Employee scope mode is missing or invalid.",
      code: "SCOPE_MODE_INVALID",
    };
  }

  if (mode === HR_SCOPE_MODES.COMPANY) {
    return { ready: true, reason: null, code: null };
  }

  const rawDeptIds = hrAccess.employeeScope?.departmentIds || [];
  const rawEmpIds = hrAccess.employeeScope?.employeeIds || [];

  if (!Array.isArray(rawDeptIds) || !Array.isArray(rawEmpIds)) {
    return {
      ready: false,
      reason: "Custom employee scope is malformed.",
      code: "SCOPE_MALFORMED",
    };
  }

  if (rawDeptIds.length === 0 && rawEmpIds.length === 0) {
    return {
      ready: false,
      reason: "Custom scope requires at least one department or employee.",
      code: "SCOPE_EMPTY",
    };
  }

  for (const raw of rawDeptIds) {
    if (!isObjectId(raw)) {
      return {
        ready: false,
        reason: "Custom scope contains an invalid department reference.",
        code: "DEPARTMENT_ID_INVALID",
      };
    }
  }
  for (const raw of rawEmpIds) {
    if (!isObjectId(raw)) {
      return {
        ready: false,
        reason: "Custom scope contains an invalid employee reference.",
        code: "EMPLOYEE_ID_INVALID",
      };
    }
  }

  const deptSet = existingDepartmentIds || new Set();
  const empSet = existingEmployeeIds || new Set();

  for (const raw of rawDeptIds) {
    if (!deptSet.has(String(raw))) {
      return {
        ready: false,
        reason: "Custom scope references a department that no longer exists in this company.",
        code: "DEPARTMENT_NOT_FOUND",
      };
    }
  }
  for (const raw of rawEmpIds) {
    if (!empSet.has(String(raw))) {
      return {
        ready: false,
        reason: "Custom scope references an employee that no longer exists in this company.",
        code: "EMPLOYEE_NOT_FOUND",
      };
    }
  }

  return { ready: true, reason: null, code: null };
}

/**
 * Readiness report: which HR Admins still need configuration before ENFORCED.
 * Active HR Admins must have valid permissions and valid CUSTOM scope references.
 */
export async function getHrAccessEnforcementReadiness({ models, company }) {
  const mode = getHrAccessEnforcementMode(company);
  const hrAdmins = await models.User.find({ role: USER_ROLES.HR_ADMIN })
    .select("_id email fullName isActive hrAccess createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const allDeptIds = new Set();
  const allEmpIds = new Set();
  for (const u of hrAdmins) {
    if (!isHrAccessConfigured(u.hrAccess)) continue;
    if (String(u.hrAccess?.employeeScope?.mode || "").toUpperCase() !== HR_SCOPE_MODES.CUSTOM) {
      continue;
    }
    for (const id of u.hrAccess.employeeScope?.departmentIds || []) {
      if (isObjectId(id)) allDeptIds.add(String(id));
    }
    for (const id of u.hrAccess.employeeScope?.employeeIds || []) {
      if (isObjectId(id)) allEmpIds.add(String(id));
    }
  }

  const [existingDepts, existingEmps] = await Promise.all([
    allDeptIds.size && models.Department
      ? models.Department.find({
          _id: { $in: [...allDeptIds].map((id) => new mongoose.Types.ObjectId(id)) },
        })
          .select("_id")
          .lean()
      : Promise.resolve([]),
    allEmpIds.size
      ? models.Employee.find({
          _id: { $in: [...allEmpIds].map((id) => new mongoose.Types.ObjectId(id)) },
        })
          .select("_id")
          .lean()
      : Promise.resolve([]),
  ]);

  const existingDepartmentIds = new Set(existingDepts.map((d) => String(d._id)));
  const existingEmployeeIds = new Set(existingEmps.map((e) => String(e._id)));

  const rows = hrAdmins.map((u) => {
    const baseConfigured = isHrAccessConfigured(u.hrAccess);
    const access = serializeHrAccess(u.hrAccess);
    const evaluation = evaluateHrAdminAccessReadiness(u.hrAccess, {
      existingDepartmentIds,
      existingEmployeeIds,
    });
    const readyForEnforcement = evaluation.ready;
    const configured = baseConfigured && readyForEnforcement;

    return {
      id: String(u._id),
      email: u.email,
      fullName: u.fullName || "",
      isActive: Boolean(u.isActive),
      configured,
      accessSummary: access.summary,
      readyForEnforcement,
      readinessReason: evaluation.reason,
      readinessCode: evaluation.code,
    };
  });

  const configuredCount = rows.filter((r) => r.configured).length;
  const unconfiguredCount = rows.length - configuredCount;
  const activeUnconfigured = rows.filter((r) => r.isActive && !r.readyForEnforcement).length;
  const activeNotReady = rows.filter((r) => r.isActive && !r.readyForEnforcement);

  return {
    enforcement: {
      mode,
      canEnable: activeUnconfigured === 0,
      blockingReason:
        activeUnconfigured > 0
          ? `${activeUnconfigured} active HR Admin(s) still need access configuration before enforcement can be enabled.`
          : null,
      blockingHrAdminIds: activeNotReady.map((r) => r.id),
    },
    totals: {
      hrAdmins: rows.length,
      configured: configuredCount,
      unconfigured: unconfiguredCount,
      activeUnconfigured,
    },
    hrAdmins: rows,
  };
}

/**
 * Explicit legacy bootstrap: COMPANY scope + full catalog permissions.
 * Does not enable enforcement. Idempotent for already-configured admins unless force=true.
 */
export async function bootstrapLegacyHrAccess({
  models,
  actor,
  company,
  force = false,
  ipAddress = "",
}) {
  const hrAdmins = await models.User.find({ role: USER_ROLES.HR_ADMIN }).select("_id email hrAccess");
  const permissions = getLegacyBootstrapPermissions();
  const results = [];

  for (const admin of hrAdmins) {
    if (isHrAccessConfigured(admin.hrAccess) && !force) {
      results.push({
        id: String(admin._id),
        email: admin.email,
        status: "skipped_already_configured",
      });
      continue;
    }

    const updated = await updateHrAdminAccess({
      models,
      actor,
      hrAdminId: admin._id,
      employeeScope: { mode: HR_SCOPE_MODES.COMPANY, departmentIds: [], employeeIds: [] },
      permissions,
      ipAddress,
    });

    results.push({
      id: String(admin._id),
      email: admin.email,
      status: "bootstrapped",
      access: updated.access,
    });
  }

  await writeRolloutAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ACCESS_LEGACY_BOOTSTRAPPED,
    targetId: actor._id,
    changes: {
      count: results.filter((r) => r.status === "bootstrapped").length,
      skipped: results.filter((r) => r.status === "skipped_already_configured").length,
      force: Boolean(force),
    },
    ipAddress,
  });

  return {
    message:
      "Legacy HR access bootstrapped with company-wide scope and full catalog permissions. Enforcement remains unchanged until explicitly enabled.",
    enforcementMode: getHrAccessEnforcementMode(company),
    results,
  };
}

/**
 * Enable or disable HR access enforcement for the tenant.
 * Enabling requires all active HR Admins to be configured and ready.
 */
export async function setHrAccessEnforcementMode({
  models,
  actor,
  company,
  mode,
  reason = "",
  ipAddress = "",
}) {
  const nextMode = String(mode || "").toUpperCase();
  if (
    nextMode !== HR_ACCESS_ENFORCEMENT_MODES.OFF &&
    nextMode !== HR_ACCESS_ENFORCEMENT_MODES.ENFORCED
  ) {
    throw new HttpError(400, "mode must be OFF or ENFORCED.", { code: "INVALID_ENFORCEMENT_MODE" });
  }

  if (nextMode === HR_ACCESS_ENFORCEMENT_MODES.ENFORCED) {
    const readiness = await getHrAccessEnforcementReadiness({ models, company });
    if (!readiness.enforcement.canEnable) {
      throw new HttpError(409, readiness.enforcement.blockingReason, {
        code: "HR_ACCESS_NOT_READY",
      });
    }
  }

  const companyDoc = await Company.findById(company._id);
  if (!companyDoc) {
    throw new HttpError(404, "Company not found");
  }

  if (!companyDoc.config) companyDoc.config = {};
  if (!companyDoc.config.hrAccessEnforcement) {
    companyDoc.config.hrAccessEnforcement = {};
  }

  const previousMode = companyDoc.config.hrAccessEnforcement.mode || HR_ACCESS_ENFORCEMENT_MODES.OFF;
  companyDoc.config.hrAccessEnforcement.previousMode = previousMode;
  companyDoc.config.hrAccessEnforcement.mode = nextMode;
  companyDoc.config.hrAccessEnforcement.updatedAt = new Date();
  companyDoc.config.hrAccessEnforcement.updatedByUserId = String(actor._id);
  if (!Array.isArray(companyDoc.config.hrAccessEnforcement.history)) {
    companyDoc.config.hrAccessEnforcement.history = [];
  }
  companyDoc.config.hrAccessEnforcement.history.push({
    from: previousMode,
    to: nextMode,
    at: new Date(),
    byUserId: String(actor._id),
    reason: String(reason || "").slice(0, 500),
  });
  companyDoc.markModified("config");
  await companyDoc.save();

  await writeRolloutAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ACCESS_ENFORCEMENT_CHANGED,
    targetId: actor._id,
    changes: { from: previousMode, to: nextMode, reason: String(reason || "").slice(0, 500) },
    ipAddress,
  });

  company.config = company.config || {};
  company.config.hrAccessEnforcement = companyDoc.config.hrAccessEnforcement;

  return {
    enforcement: {
      mode: nextMode,
      previousMode,
      updatedAt: companyDoc.config.hrAccessEnforcement.updatedAt,
    },
  };
}

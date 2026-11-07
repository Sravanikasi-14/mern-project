import mongoose from "mongoose";
import { USER_ROLES } from "../models/User.js";
import { HR_SCOPE_MODES, HR_PERMISSION_KEYS, isValidHrPermissionKey } from "../constants/hrAccessCatalog.js";
import { isHrAccessConfigured } from "./hrAccessConfigService.js";
import { HttpError } from "../utils/httpError.js";

export const HR_ACCESS_ENFORCEMENT_MODES = Object.freeze({
  OFF: "OFF",
  ENFORCED: "ENFORCED",
});

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);
}

export function getHrAccessEnforcementMode(company) {
  const mode = company?.config?.hrAccessEnforcement?.mode;
  if (mode === HR_ACCESS_ENFORCEMENT_MODES.ENFORCED) {
    return HR_ACCESS_ENFORCEMENT_MODES.ENFORCED;
  }
  return HR_ACCESS_ENFORCEMENT_MODES.OFF;
}

/**
 * Resolve effective HR access for the current request.
 * COMPANY_ADMIN never uses this path for /api/admin HR routes (role gate).
 * When enforcement is OFF, returns enforced:false (legacy unrestricted HR).
 */
export async function resolveHrAccessContext({ user, company, models }) {
  const mode = getHrAccessEnforcementMode(company);
  const base = {
    enforcementMode: mode,
    enforced: mode === HR_ACCESS_ENFORCEMENT_MODES.ENFORCED,
    role: user?.role,
    configured: false,
    permissions: new Set(),
    scopeMode: null,
    departmentIds: [],
    employeeIds: [],
    /** Mongo filter for Employee documents; null = no extra filter (company-wide). */
    employeeMatch: null,
    /** Resolved employee ObjectId strings when CUSTOM (for non-Employee collections). */
    allowedEmployeeIdSet: null,
  };

  if (user?.role !== USER_ROLES.HR_ADMIN) {
    return base;
  }

  if (!base.enforced) {
    return base;
  }

  const hrAccess = user.hrAccess;
  if (!isHrAccessConfigured(hrAccess)) {
    return {
      ...base,
      configured: false,
      denyReason: "HR_ACCESS_NOT_CONFIGURED",
    };
  }

  const permissions = new Set(
    (hrAccess.permissions || []).filter((key) => isValidHrPermissionKey(key))
  );
  const rawScopeMode = hrAccess.employeeScope?.mode;
  // Exact modes only. Missing or unknown modes must not widen to company-wide access.
  if (rawScopeMode !== HR_SCOPE_MODES.COMPANY && rawScopeMode !== HR_SCOPE_MODES.CUSTOM) {
    return {
      ...base,
      configured: false,
      denyReason: "HR_SCOPE_MODE_INVALID",
    };
  }
  const scopeMode = rawScopeMode;
  const departmentIds = (hrAccess.employeeScope?.departmentIds || [])
    .filter((id) => isObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  const employeeIds = (hrAccess.employeeScope?.employeeIds || [])
    .filter((id) => isObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  let employeeMatch = null;
  let allowedEmployeeIdSet = null;

  if (scopeMode === HR_SCOPE_MODES.CUSTOM) {
    const or = [];
    if (employeeIds.length) {
      or.push({ _id: { $in: employeeIds } });
    }
    if (departmentIds.length) {
      // Authoritative department id only. Display-name matches can pull in
      // employees whose departmentId points at a different department.
      or.push({ "job.departmentId": { $in: departmentIds } });
    }
    if (!or.length) {
      // Configured CUSTOM but empty effective set → match nothing
      employeeMatch = { _id: { $in: [] } };
      allowedEmployeeIdSet = new Set();
    } else {
      employeeMatch = { $or: or };
      const scoped = await models.Employee.find(employeeMatch).select("_id").lean();
      allowedEmployeeIdSet = new Set(scoped.map((e) => String(e._id)));
    }
  }

  return {
    ...base,
    configured: true,
    permissions,
    scopeMode,
    departmentIds: departmentIds.map(String),
    employeeIds: employeeIds.map(String),
    employeeMatch,
    allowedEmployeeIdSet,
  };
}

function throwIfHrAccessUnconfigured(ctx) {
  if (ctx?.configured) return;
  const invalidScope = ctx?.denyReason === "HR_SCOPE_MODE_INVALID";
  throw new HttpError(
    403,
    invalidScope
      ? "HR Admin employee scope is missing or invalid. Ask your Company Admin to correct the access configuration."
      : "HR Admin access is not configured. Ask your Company Admin to configure access before using this feature.",
    { code: invalidScope ? "HR_SCOPE_MODE_INVALID" : "HR_ACCESS_NOT_CONFIGURED" }
  );
}

export function assertHrPermission(ctx, permissionKey) {
  if (!ctx?.enforced) return;
  if (ctx.role !== USER_ROLES.HR_ADMIN) return;

  throwIfHrAccessUnconfigured(ctx);

  if (!isValidHrPermissionKey(permissionKey) || !ctx.permissions.has(permissionKey)) {
    throw new HttpError(403, "You do not have permission to perform this action.", {
      code: "HR_PERMISSION_DENIED",
      permission: permissionKey,
    });
  }
}

/** True when the caller may use this permission. Non-HR and enforcement OFF pass. */
export function hasHrPermission(ctx, permissionKey) {
  try {
    assertHrPermission(ctx, permissionKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cycle-level payroll writes rewrite or lock every payslip on the cycle.
 * CUSTOM scope cannot do that without changing out-of-scope records, so reject.
 * COMPANY scope and enforcement OFF keep the existing company-wide workflow.
 */
export function assertHrCompanyWidePayrollMutation(ctx) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) return;
  throwIfHrAccessUnconfigured(ctx);
  if (ctx.scopeMode === HR_SCOPE_MODES.CUSTOM) {
    throw new HttpError(
      403,
      "Payroll cycle actions apply to the whole company and are not available for a custom employee scope.",
      { code: "HR_SCOPE_DENIED" }
    );
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Import rows name a department. Resolve that name to a department id and
 * allow the row only when that id is inside CUSTOM scope. Employee-id-only
 * scope cannot own a brand-new employee, so those rows are rejected.
 */
export async function isImportDepartmentInHrScope(ctx, models, departmentName) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) return true;
  if (!ctx.configured) return false;
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM) return true;
  const name = String(departmentName || "").trim();
  if (!name || !models?.Department) return false;
  const dept = await models.Department.findOne({
    isActive: true,
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
  })
    .select("_id")
    .lean();
  if (!dept) return false;
  return (ctx.departmentIds || []).map(String).includes(String(dept._id));
}

/**
 * Authoritative department-scope check for create and edit.
 * Company Admin, enforcement off, and company-wide HR are unchanged.
 * A custom scope may assign only one of its departments.
 */
export async function assertEmployeeDepartmentInHrScope(
  ctx,
  models,
  { departmentId = null, departmentName = "" } = {},
  message = "You cannot assign a department outside your employee scope."
) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) return;
  throwIfHrAccessUnconfigured(ctx);
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM) return;

  if (departmentId) {
    const allowed = (ctx.departmentIds || []).map(String).includes(String(departmentId));
    if (!allowed) {
      throw new HttpError(403, message, { code: "HR_SCOPE_DENIED", field: "departmentId" });
    }
    return;
  }

  const allowed = await isImportDepartmentInHrScope(ctx, models, departmentName);
  if (!allowed) {
    throw new HttpError(403, message, { code: "HR_SCOPE_DENIED", field: "department" });
  }
}

export function mergeEmployeeScopeFilter(ctx, filter = {}) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return filter;
  }
  throwIfHrAccessUnconfigured(ctx);
  if (!ctx.employeeMatch) {
    return filter;
  }
  return { $and: [filter, ctx.employeeMatch] };
}

/**
 * Filter for collections keyed by employeeId (LeaveRequest, Attendance, etc.).
 */
export function mergeEmployeeIdScopeFilter(ctx, filter = {}, field = "employeeId") {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return filter;
  }
  throwIfHrAccessUnconfigured(ctx);
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return filter;
  }
  const ids = [...ctx.allowedEmployeeIdSet].map((id) => new mongoose.Types.ObjectId(id));
  return { $and: [filter, { [field]: { $in: ids } }] };
}

export function isEmployeeIdInScope(ctx, employeeId) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return true;
  }
  if (!ctx.configured) {
    return false;
  }
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return true;
  }
  if (!employeeId) return false;
  return ctx.allowedEmployeeIdSet.has(String(employeeId));
}

/**
 * Keep an in-scope manager reference intact.
 * For enforced CUSTOM HR, drop name and employee code when the manager is outside scope.
 * Other roles, COMPANY scope, and enforcement OFF are unchanged.
 */
export function redactOutOfScopeManagerIdentity(ctx, manager) {
  if (manager == null || typeof manager !== "object") return manager;
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) return manager;
  if (!ctx.configured || ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return manager;
  }
  const id = manager._id || manager.id;
  if (!id || isEmployeeIdInScope(ctx, id)) return manager;
  return { _id: id };
}

export function assertEmployeeInScope(ctx, employeeId, message = "You do not have access to this employee.") {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return;
  }
  throwIfHrAccessUnconfigured(ctx);
  if (!isEmployeeIdInScope(ctx, employeeId)) {
    throw new HttpError(403, message, { code: "HR_SCOPE_DENIED" });
  }
}

export function filterEmployeeListByScope(ctx, employees) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN || !ctx.configured) {
    if (ctx?.enforced && ctx.role === USER_ROLES.HR_ADMIN && !ctx.configured) {
      return [];
    }
    return employees;
  }
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return employees;
  }
  return employees.filter((e) => ctx.allowedEmployeeIdSet.has(String(e._id || e.id)));
}

/** Full catalog allow-list for explicit legacy bootstrap (not a silent default). */
export function getLegacyBootstrapPermissions() {
  return [...HR_PERMISSION_KEYS];
}

/**
 * Filter payslip (or similar) rows by employee scope when enforcement is active.
 */
export function filterPayslipsByScope(ctx, payslips = []) {
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return payslips;
  }
  if (!ctx.configured) {
    return [];
  }
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return payslips;
  }
  return payslips.filter((p) =>
    isEmployeeIdInScope(ctx, p.employeeId?._id || p.employeeId)
  );
}

/**
 * True when a payroll validation issue carries employee-identifying fields.
 * Company-level issues (no employee identity) must remain visible when scoped.
 */
export function isEmployeeSpecificValidationIssue(issue) {
  if (!issue || typeof issue !== "object") return false;
  return Boolean(
    issue.employeeId ||
      issue.employeeCode ||
      issue.fullName ||
      issue.employee?._id ||
      issue.employee?.fullName ||
      issue.employee?.employeeCode
  );
}

/**
 * Filter payroll validationIssues for CUSTOM-scoped HR responses.
 * Keeps company-level (non-employee) issues; drops out-of-scope employee rows.
 * Fail-closed when ENFORCED but unconfigured.
 */
export function filterValidationIssuesByScope(ctx, issues = []) {
  const list = Array.isArray(issues) ? issues : [];
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return list;
  }
  if (!ctx.configured) {
    return list.filter((issue) => !isEmployeeSpecificValidationIssue(issue));
  }
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM || !ctx.allowedEmployeeIdSet) {
    return list;
  }
  return list.filter((issue) => {
    if (!isEmployeeSpecificValidationIssue(issue)) return true;
    return isEmployeeIdInScope(
      ctx,
      issue.employeeId?._id || issue.employeeId || issue.employee?._id
    );
  });
}

/**
 * For CUSTOM-scoped HR, replace company-wide cycle aggregate fields with
 * recomputed values from in-scope payslips (or null when no payslips provided).
 * Does not mutate stored Mongo documents — response shaping only.
 */
export function shapePayrollCycleForHrAccess(ctx, cycle, scopedPayslips = null) {
  if (!cycle) return cycle;
  if (!ctx?.enforced || ctx.role !== USER_ROLES.HR_ADMIN) {
    return cycle;
  }

  const scopedIssues = Array.isArray(cycle.validationIssues)
    ? filterValidationIssuesByScope(ctx, cycle.validationIssues)
    : cycle.validationIssues;

  if (!ctx.configured) {
    return {
      ...cycle,
      employeeCount: 0,
      totalGrossEarnings: null,
      totalEmployeeDeductions: null,
      totalEmployerContributions: null,
      totalNetPayable: null,
      totalNetSalary: null,
      validationIssues: scopedIssues,
      _aggregatesRestricted: true,
    };
  }
  if (ctx.scopeMode !== HR_SCOPE_MODES.CUSTOM) {
    return cycle;
  }

  if (!Array.isArray(scopedPayslips)) {
    return {
      ...cycle,
      employeeCount: null,
      totalGrossEarnings: null,
      totalEmployeeDeductions: null,
      totalEmployerContributions: null,
      totalNetPayable: null,
      totalNetSalary: null,
      validationIssues: scopedIssues,
      _aggregatesRestricted: true,
    };
  }

  let totalGross = 0;
  let totalDeductions = 0;
  let totalEmployer = 0;
  let totalNet = 0;
  for (const p of scopedPayslips) {
    totalGross += Number(p.grossEarnings ?? p.totalGrossEarnings ?? 0) || 0;
    totalDeductions += Number(p.totalDeductions ?? p.employeeDeductions ?? 0) || 0;
    totalEmployer += Number(p.employerContributions ?? 0) || 0;
    totalNet += Number(p.netPayable ?? p.netSalary ?? p.totalNetPayable ?? 0) || 0;
  }

  return {
    ...cycle,
    employeeCount: scopedPayslips.length,
    totalGrossEarnings: totalGross,
    totalEmployeeDeductions: totalDeductions,
    totalEmployerContributions: totalEmployer,
    totalNetPayable: totalNet,
    totalNetSalary: totalNet,
    validationIssues: scopedIssues,
    _aggregatesRestricted: true,
  };
}

import mongoose from "mongoose";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import {
  HR_SCOPE_MODES,
  getHrAccessCatalogPublic,
  isValidHrPermissionKey,
} from "../constants/hrAccessCatalog.js";
import { HttpError } from "../utils/httpError.js";

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);
}

function uniqueObjectIds(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    if (!isObjectId(raw)) continue;
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(new mongoose.Types.ObjectId(id));
  }
  return out;
}

function uniquePermissionKeys(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const key = String(raw || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

async function writeAudit(models, { actor, action, targetId, changes = {}, ipAddress = "" }) {
  if (!models.AuditLog || !targetId) return;
  try {
    await models.AuditLog.create({
      actorUserId: actor?._id || null,
      actorEmail: actor?.email || "system",
      actorRole: actor?.role || USER_ROLES.COMPANY_ADMIN,
      action,
      targetType: "User",
      targetId,
      changes,
      ipAddress: ipAddress || "",
      timestamp: new Date(),
    });
  } catch {
    // non-blocking
  }
}

export function isHrAccessConfigured(hrAccess) {
  return Boolean(hrAccess && hrAccess.version >= 1 && hrAccess.configuredAt);
}

export function serializeHrAccess(hrAccess) {
  if (!isHrAccessConfigured(hrAccess)) {
    return {
      configured: false,
      version: null,
      configuredAt: null,
      updatedAt: null,
      employeeScope: null,
      permissions: [],
      summary: {
        scopeLabel: "Not configured",
        permissionCount: 0,
        departmentCount: 0,
        employeeCount: 0,
      },
    };
  }

  const mode = hrAccess.employeeScope?.mode || HR_SCOPE_MODES.COMPANY;
  const departmentIds = (hrAccess.employeeScope?.departmentIds || []).map(String);
  const employeeIds = (hrAccess.employeeScope?.employeeIds || []).map(String);
  const permissions = [...(hrAccess.permissions || [])];

  let scopeLabel = "Entire company";
  if (mode === HR_SCOPE_MODES.CUSTOM) {
    const parts = [];
    if (departmentIds.length) parts.push(`${departmentIds.length} department${departmentIds.length === 1 ? "" : "s"}`);
    if (employeeIds.length) parts.push(`${employeeIds.length} employee${employeeIds.length === 1 ? "" : "s"}`);
    scopeLabel = parts.length ? `Custom · ${parts.join(" + ")}` : "Custom · empty";
  }

  return {
    configured: true,
    version: hrAccess.version,
    configuredAt: hrAccess.configuredAt || null,
    updatedAt: hrAccess.updatedAt || null,
    employeeScope: {
      mode,
      departmentIds,
      employeeIds,
    },
    permissions,
    summary: {
      scopeLabel,
      permissionCount: permissions.length,
      departmentCount: departmentIds.length,
      employeeCount: employeeIds.length,
    },
  };
}

async function loadHrAdminOrThrow(models, hrAdminId, actorUserId) {
  if (!isObjectId(hrAdminId)) {
    throw new HttpError(400, "Invalid HR Admin id.", { code: "INVALID_ID" });
  }
  if (actorUserId && String(hrAdminId) === String(actorUserId)) {
    throw new HttpError(400, "Company Admin access cannot be configured through HR Admin access APIs.", {
      code: "CANNOT_CONFIGURE_SELF",
    });
  }

  const user = await models.User.findById(hrAdminId);
  if (!user || user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }
  return user;
}

function validateEmployeeScopeInput(scopeInput) {
  const mode = String(scopeInput?.mode || "").toUpperCase();
  if (mode !== HR_SCOPE_MODES.COMPANY && mode !== HR_SCOPE_MODES.CUSTOM) {
    throw new HttpError(400, "Employee scope mode must be COMPANY or CUSTOM.", {
      code: "INVALID_SCOPE_MODE",
      errors: { mode: "Select entire company or custom scope." },
    });
  }

  const departmentIds = uniqueObjectIds(scopeInput?.departmentIds);
  const employeeIds = uniqueObjectIds(scopeInput?.employeeIds);

  if (mode === HR_SCOPE_MODES.COMPANY) {
    return {
      mode: HR_SCOPE_MODES.COMPANY,
      departmentIds: [],
      employeeIds: [],
    };
  }

  // Reject clearly invalid ID strings that were not ObjectIds
  const rawDept = scopeInput?.departmentIds || [];
  const rawEmp = scopeInput?.employeeIds || [];
  for (const raw of rawDept) {
    if (raw != null && String(raw).trim() && !isObjectId(raw)) {
      throw new HttpError(400, "One or more department IDs are invalid.", {
        code: "INVALID_DEPARTMENT_ID",
      });
    }
  }
  for (const raw of rawEmp) {
    if (raw != null && String(raw).trim() && !isObjectId(raw)) {
      throw new HttpError(400, "One or more employee IDs are invalid.", {
        code: "INVALID_EMPLOYEE_ID",
      });
    }
  }

  if (departmentIds.length === 0 && employeeIds.length === 0) {
    throw new HttpError(400, "Custom scope requires at least one department or employee.", {
      code: "EMPTY_CUSTOM_SCOPE",
    });
  }

  return {
    mode: HR_SCOPE_MODES.CUSTOM,
    departmentIds,
    employeeIds,
  };
}

function validatePermissionsInput(permissionsInput) {
  if (!Array.isArray(permissionsInput)) {
    throw new HttpError(400, "Permissions must be an array of permission keys.", {
      code: "INVALID_PERMISSIONS",
    });
  }
  const permissions = uniquePermissionKeys(permissionsInput);
  const invalid = permissions.filter((key) => !isValidHrPermissionKey(key));
  if (invalid.length) {
    throw new HttpError(400, "One or more permission keys are invalid.", {
      code: "INVALID_PERMISSION_KEY",
      errors: { permissions: invalid },
    });
  }
  return permissions;
}

async function assertDepartmentsExist(models, departmentIds) {
  if (!departmentIds.length) return;
  if (!models.Department) {
    throw new HttpError(400, "Department registry is unavailable.", { code: "DEPARTMENTS_UNAVAILABLE" });
  }
  const count = await models.Department.countDocuments({
    _id: { $in: departmentIds },
  });
  if (count !== departmentIds.length) {
    throw new HttpError(400, "One or more selected departments were not found.", {
      code: "DEPARTMENT_NOT_FOUND",
    });
  }
}

async function assertEmployeesExist(models, employeeIds) {
  if (!employeeIds.length) return;
  const count = await models.Employee.countDocuments({
    _id: { $in: employeeIds },
  });
  if (count !== employeeIds.length) {
    throw new HttpError(400, "One or more selected employees were not found.", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }
}

export async function getHrAccessCatalog() {
  return getHrAccessCatalogPublic();
}

export async function getHrAdminAccessConfig({ models, hrAdminId, actor }) {
  const user = await loadHrAdminOrThrow(models, hrAdminId, actor?._id);
  return {
    hrAdmin: {
      id: String(user._id),
      fullName: user.fullName || "",
      email: user.email,
      isActive: Boolean(user.isActive),
    },
    access: serializeHrAccess(user.hrAccess),
    catalog: getHrAccessCatalogPublic(),
  };
}

export async function listAccessConfigOptions({ models, query = {} }) {
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));

  const deptFilter = { isActive: true };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    deptFilter.name = { $regex: escaped, $options: "i" };
  }

  const empFilter = { status: "ACTIVE" };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    empFilter.$or = [
      { fullName: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
      { employeeCode: { $regex: escaped, $options: "i" } },
    ];
  }

  const [departments, employees] = await Promise.all([
    models.Department
      ? models.Department.find(deptFilter)
          .select("name code isActive")
          .sort({ name: 1 })
          .limit(limit)
          .lean()
      : Promise.resolve([]),
    models.Employee.find(empFilter)
      .select("fullName email employeeCode status job.department job.departmentId")
      .sort({ fullName: 1 })
      .limit(limit)
      .lean(),
  ]);

  return {
    departments: departments.map((d) => ({
      id: String(d._id),
      name: d.name || "",
      code: d.code || "",
      isActive: Boolean(d.isActive),
    })),
    employees: employees.map((e) => ({
      id: String(e._id),
      fullName: e.fullName || "",
      email: e.email || "",
      employeeCode: e.employeeCode || "",
      department: e.job?.department || "",
      departmentId: e.job?.departmentId ? String(e.job.departmentId) : null,
      status: e.status || "",
    })),
  };
}

export async function updateHrAdminEmployeeScope({
  models,
  actor,
  hrAdminId,
  employeeScope,
  ipAddress = "",
}) {
  const user = await loadHrAdminOrThrow(models, hrAdminId, actor?._id);
  const normalized = validateEmployeeScopeInput(employeeScope || {});
  await assertDepartmentsExist(models, normalized.departmentIds);
  await assertEmployeesExist(models, normalized.employeeIds);

  const now = new Date();
  const existing = user.hrAccess || {};
  const wasConfigured = isHrAccessConfigured(existing);

  user.hrAccess = {
    version: 1,
    configuredAt: wasConfigured ? existing.configuredAt || now : now,
    updatedAt: now,
    updatedBy: actor?._id || null,
    employeeScope: {
      mode: normalized.mode,
      departmentIds: normalized.departmentIds,
      employeeIds: normalized.employeeIds,
    },
    permissions: wasConfigured ? [...(existing.permissions || [])] : [],
  };

  await user.save();

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_SCOPE_UPDATED,
    targetId: user._id,
    changes: {
      mode: normalized.mode,
      departmentCount: normalized.departmentIds.length,
      employeeCount: normalized.employeeIds.length,
      firstConfiguration: !wasConfigured,
    },
    ipAddress,
  });

  return {
    hrAdminId: String(user._id),
    access: serializeHrAccess(user.hrAccess),
  };
}

export async function updateHrAdminPermissions({
  models,
  actor,
  hrAdminId,
  permissions,
  ipAddress = "",
}) {
  const user = await loadHrAdminOrThrow(models, hrAdminId, actor?._id);
  const normalizedPermissions = validatePermissionsInput(permissions);

  const now = new Date();
  const existing = user.hrAccess || {};
  const wasConfigured = isHrAccessConfigured(existing);
  const existingScope = existing.employeeScope || {};

  // If permissions are set first, establish a configured record with COMPANY scope
  // only when already configured; otherwise require explicit scope first via full save.
  // Allow permissions-only update when already configured OR when creating with empty
  // COMPANY default to avoid accidental broad grants — require wasConfigured OR
  // caller uses updateHrAdminAccess (full). Spec: scope and permissions independently.
  // For first-time permissions-only: default scope to COMPANY but permissions as given
  // (Company Admin explicitly chose permissions; scope defaults company-wide until changed).
  user.hrAccess = {
    version: 1,
    configuredAt: wasConfigured ? existing.configuredAt || now : now,
    updatedAt: now,
    updatedBy: actor?._id || null,
    employeeScope: {
      mode: existingScope.mode || HR_SCOPE_MODES.COMPANY,
      departmentIds: existingScope.departmentIds || [],
      employeeIds: existingScope.employeeIds || [],
    },
    permissions: normalizedPermissions,
  };

  await user.save();

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_PERMISSIONS_UPDATED,
    targetId: user._id,
    changes: {
      permissionCount: normalizedPermissions.length,
      firstConfiguration: !wasConfigured,
    },
    ipAddress,
  });

  return {
    hrAdminId: String(user._id),
    access: serializeHrAccess(user.hrAccess),
  };
}

/**
 * Atomic save of both scope and permissions (preferred UI save).
 */
export async function updateHrAdminAccess({
  models,
  actor,
  hrAdminId,
  employeeScope,
  permissions,
  ipAddress = "",
}) {
  const user = await loadHrAdminOrThrow(models, hrAdminId, actor?._id);
  const normalizedScope = validateEmployeeScopeInput(employeeScope || {});
  const normalizedPermissions = validatePermissionsInput(permissions);
  await assertDepartmentsExist(models, normalizedScope.departmentIds);
  await assertEmployeesExist(models, normalizedScope.employeeIds);

  const now = new Date();
  const wasConfigured = isHrAccessConfigured(user.hrAccess);

  user.hrAccess = {
    version: 1,
    configuredAt: wasConfigured ? user.hrAccess.configuredAt || now : now,
    updatedAt: now,
    updatedBy: actor?._id || null,
    employeeScope: {
      mode: normalizedScope.mode,
      departmentIds: normalizedScope.departmentIds,
      employeeIds: normalizedScope.employeeIds,
    },
    permissions: normalizedPermissions,
  };

  await user.save();

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_ACCESS_UPDATED,
    targetId: user._id,
    changes: {
      mode: normalizedScope.mode,
      departmentCount: normalizedScope.departmentIds.length,
      employeeCount: normalizedScope.employeeIds.length,
      permissionCount: normalizedPermissions.length,
      firstConfiguration: !wasConfigured,
    },
    ipAddress,
  });

  return {
    hrAdminId: String(user._id),
    access: serializeHrAccess(user.hrAccess),
  };
}

import Company from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { HttpError } from "../utils/httpError.js";
import { USER_ROLES } from "../models/User.js";
import {
  assertNoSensitiveLeak,
  resolveVisibleEmployeeAccess,
} from "./employeeVisibilityService.js";
import { filterEmployeeListByScope } from "./hrAccessEnforcementService.js";
import { resolveOrganizationExplorerConfig } from "./organizationExplorerConfigService.js";

/** Minimal chart fields for project explorer nodes (aligned with departments / organization-view). */
export const PROJECT_EMPLOYEE_ALLOWED_KEYS = Object.freeze([
  "id",
  "fullName",
  "employeeCode",
  "jobTitle",
  "department",
  "departmentId",
  "projectId",
  "reportingManagerId",
]);

const PROJECT_SELECT =
  "_id fullName employeeCode job.jobTitle job.department job.departmentId job.reportingManagerId job.project.projectName job.project.projectType job.project.projectId";
const MAX_PROJECT_PARAM_LENGTH = 200;

/**
 * Trimmed project name, or null when missing / blank (no fake Unassigned project).
 */
export function extractProjectName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function projectGroupingKey(name) {
  return name.trim().toLowerCase();
}

/**
 * Decode and validate the :project path parameter.
 */
export function parseProjectParam(raw) {
  if (raw == null) {
    throw new HttpError(400, "Project is required.", {
      field: "project",
      code: "INVALID_PROJECT",
    });
  }

  let value = typeof raw === "string" ? raw : String(raw);
  try {
    value = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Project name is not a valid URL-encoded value.", {
      field: "project",
      code: "INVALID_PROJECT",
    });
  }

  value = value.trim();
  if (!value) {
    throw new HttpError(400, "Project name must not be empty.", {
      field: "project",
      code: "INVALID_PROJECT",
    });
  }
  if (value.length > MAX_PROJECT_PARAM_LENGTH) {
    throw new HttpError(400, "Project name is too long.", {
      field: "project",
      code: "INVALID_PROJECT",
    });
  }
  return value;
}

/**
 * Ensure Organization Explorer has the projects view enabled for this tenant.
 */
export async function assertProjectsViewEnabled(company) {
  if (!company?._id) {
    throw new HttpError(401, "Authentication required");
  }

  let rawConfig = company.config?.organizationExplorer;
  if (rawConfig === undefined) {
    const fresh = await Company.findById(company._id).select("config.organizationExplorer").lean();
    rawConfig = fresh?.config?.organizationExplorer;
  }

  const config = resolveOrganizationExplorerConfig(rawConfig);
  if (!config.enabledViews.includes("projects")) {
    throw new HttpError(403, "Projects view is not enabled for this organization.", {
      code: "ORGANIZATION_EXPLORER_VIEW_DISABLED",
      field: "projects",
    });
  }
  return config;
}

function extractProjectType(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * Return a single agreed non-empty type, or null when missing / conflicting.
 */
export function resolveAgreedProjectType(types) {
  const normalized = types.map((t) => extractProjectType(t));
  if (normalized.length === 0) return null;
  if (normalized.some((t) => !t)) return null;
  const unique = [...new Set(normalized.map((t) => t.toUpperCase()))];
  if (unique.length !== 1) return null;
  // Preserve the first non-empty casing/form from the input list.
  const first = normalized.find((t) => t);
  return first || null;
}

function projectChartEmployee(doc) {
  const departmentRaw = doc.job?.department;
  const projected = {
    id: String(doc._id),
    fullName: doc.fullName || "",
    employeeCode: doc.employeeCode || "",
    jobTitle: doc.job?.jobTitle || "",
    department: typeof departmentRaw === "string" ? departmentRaw.trim() : "",
    departmentId: doc.job?.departmentId ? String(doc.job.departmentId) : null,
    // Additive Phase A4 — never derived from Task.projectName or display name alone.
    projectId: doc.job?.project?.projectId ? String(doc.job.project.projectId) : null,
    reportingManagerId: doc.job?.reportingManagerId
      ? String(doc.job.reportingManagerId)
      : null,
  };
  for (const key of Object.keys(projected)) {
    if (!PROJECT_EMPLOYEE_ALLOWED_KEYS.includes(key)) delete projected[key];
  }
  return projected;
}

function resolveGroupProjectId(employees) {
  const ids = [...new Set(employees.map((e) => e.projectId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

async function loadActiveEmployees(Employee) {
  return Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
    .select(PROJECT_SELECT)
    .sort({ fullName: 1 })
    .lean();
}

async function loadVisibleActiveEmployees(Employee, user, hrAccess = null) {
  const docs = await loadActiveEmployees(Employee);
  if (user?.role === USER_ROLES.HR_ADMIN || user?.role === USER_ROLES.COMPANY_ADMIN) {
    return hrAccess ? filterEmployeeListByScope(hrAccess, docs) : docs;
  }
  if (!user) return docs;
  const access = await resolveVisibleEmployeeAccess({ Employee, user, employees: docs });
  if (access.bypass) return docs;
  return docs.filter((doc) => access.visibleIds.has(String(doc._id)));
}

/**
 * Build case-insensitive project groups from ACTIVE employees.
 * @returns {{ groups: Map<string, object>, unassignedCount: number }}
 */
function groupActiveEmployeesByProject(docs) {
  /** @type {Map<string, { name: string, employees: ReturnType<typeof projectChartEmployee>[], types: string[] }>} */
  const groups = new Map();
  let unassignedCount = 0;

  for (const doc of docs) {
    const name = extractProjectName(doc.job?.project?.projectName);
    if (!name) {
      unassignedCount += 1;
      continue;
    }

    const key = projectGroupingKey(name);
    if (!groups.has(key)) {
      groups.set(key, {
        name, // first trimmed display name wins (docs sorted by fullName)
        employees: [],
        types: [],
      });
    }
    const group = groups.get(key);
    group.employees.push(projectChartEmployee(doc));
    group.types.push(doc.job?.project?.projectType ?? "");
  }

  return { groups, unassignedCount };
}

/**
 * Project overview: ACTIVE employees grouped by job.project.projectName.
 * Non-HR viewers only see hierarchy-visible colleagues.
 */
export async function listOrganizationExplorerProjects(Employee, user, hrAccess = null) {
  const docs = await loadVisibleActiveEmployees(Employee, user, hrAccess);
  const { groups, unassignedCount } = groupActiveEmployeesByProject(docs);

  const projects = [...groups.values()]
    .map((group) => ({
      name: group.name,
      projectId: resolveGroupProjectId(group.employees),
      projectType: resolveAgreedProjectType(group.types),
      employeeCount: group.employees.length,
      employees: group.employees,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const payload = {
    projects,
    meta: {
      totalProjects: projects.length,
      totalAssignedEmployees: projects.reduce((sum, p) => sum + p.employeeCount, 0),
      unassignedCount,
      totalEmployees: docs.length,
    },
  };
  assertNoSensitiveLeak(payload);
  return payload;
}

/**
 * Employees assigned to a single project (case-insensitive name match).
 */
export async function listOrganizationExplorerProjectEmployees(
  Employee,
  projectParam,
  user,
  hrAccess = null
) {
  const requested = parseProjectParam(projectParam);
  const docs = await loadVisibleActiveEmployees(Employee, user, hrAccess);
  const { groups } = groupActiveEmployeesByProject(docs);
  const key = projectGroupingKey(requested);
  const group = groups.get(key);

  const employees = group ? group.employees : [];
  const payload = {
    project: group?.name || requested,
    projectId: resolveGroupProjectId(employees),
    projectType: group ? resolveAgreedProjectType(group.types) : null,
    employees,
    meta: {
      total: employees.length,
    },
  };
  assertNoSensitiveLeak(payload);
  return payload;
}

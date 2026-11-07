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

export const UNASSIGNED_DEPARTMENT = "Unassigned";

/** Minimal chart fields for department explorer nodes (aligned with organization-view). */
export const DEPARTMENT_EMPLOYEE_ALLOWED_KEYS = Object.freeze([
  "id",
  "fullName",
  "employeeCode",
  "jobTitle",
  "department",
  "departmentId",
  "reportingManagerId",
]);

const DEPT_SELECT =
  "_id fullName employeeCode job.jobTitle job.department job.departmentId job.reportingManagerId";
const MAX_DEPARTMENT_PARAM_LENGTH = 200;

/**
 * Normalize a stored department string for grouping.
 * Missing / null / blank → Unassigned.
 */
export function normalizeDepartmentName(raw) {
  if (typeof raw !== "string") return UNASSIGNED_DEPARTMENT;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? UNASSIGNED_DEPARTMENT : trimmed;
}

/**
 * Decode and validate the :department path parameter.
 */
export function parseDepartmentParam(raw) {
  if (raw == null) {
    throw new HttpError(400, "Department is required.", {
      field: "department",
      code: "INVALID_DEPARTMENT",
    });
  }

  let value = typeof raw === "string" ? raw : String(raw);
  try {
    // Express usually decodes once; tolerate a second pass for encoded callers.
    value = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "Department name is not a valid URL-encoded value.", {
      field: "department",
      code: "INVALID_DEPARTMENT",
    });
  }

  value = value.trim();
  if (!value) {
    throw new HttpError(400, "Department name must not be empty.", {
      field: "department",
      code: "INVALID_DEPARTMENT",
    });
  }
  if (value.length > MAX_DEPARTMENT_PARAM_LENGTH) {
    throw new HttpError(400, "Department name is too long.", {
      field: "department",
      code: "INVALID_DEPARTMENT",
    });
  }
  return value;
}

/**
 * Ensure Organization Explorer has the departments view enabled for this tenant.
 * Uses authenticated company context only.
 */
export async function assertDepartmentsViewEnabled(company) {
  if (!company?._id) {
    throw new HttpError(401, "Authentication required");
  }

  let rawConfig = company.config?.organizationExplorer;
  // Re-read lean config if the in-memory company doc may be stale / partial.
  if (rawConfig === undefined) {
    const fresh = await Company.findById(company._id).select("config.organizationExplorer").lean();
    rawConfig = fresh?.config?.organizationExplorer;
  }

  const config = resolveOrganizationExplorerConfig(rawConfig);
  if (!config.enabledViews.includes("departments")) {
    throw new HttpError(403, "Departments view is not enabled for this organization.", {
      code: "ORGANIZATION_EXPLORER_VIEW_DISABLED",
      field: "departments",
    });
  }
  return config;
}

function projectDepartmentEmployee(doc, records = new Map()) {
  const display = displayDepartment(doc, records);
  const projected = {
    id: String(doc._id),
    fullName: doc.fullName || "",
    employeeCode: doc.employeeCode || "",
    jobTitle: doc.job?.jobTitle || "",
    department: display.departmentId ? display.name : (typeof doc.job?.department === "string" ? doc.job.department.trim() : ""),
    departmentId: display.departmentId,
    reportingManagerId: doc.job?.reportingManagerId
      ? String(doc.job.reportingManagerId)
      : null,
  };
  for (const key of Object.keys(projected)) {
    if (!DEPARTMENT_EMPLOYEE_ALLOWED_KEYS.includes(key)) delete projected[key];
  }
  return projected;
}

async function departmentRecordsById(Department, docs) {
  const records = new Map();
  if (!Department) return records;
  const ids = [...new Set(docs.map((doc) => doc.job?.departmentId).filter(Boolean).map((id) => String(id)))];
  if (!ids.length) return records;
  const rows = await Department.find({ _id: { $in: ids } }).select("name isActive").lean();
  for (const row of rows) records.set(String(row._id), row);
  return records;
}

/**
 * Linked employees group by departmentId and display the Department name.
 * Employees without a resolvable department stay in a legacy name group, or Unassigned.
 */
export function displayDepartment(doc, records = new Map()) {
  const departmentId = doc.job?.departmentId ? String(doc.job.departmentId) : null;
  const record = departmentId ? records.get(departmentId) : null;
  if (record?.name) {
    return { key: `id:${departmentId}`, name: record.name, departmentId };
  }
  const fallback = normalizeDepartmentName(doc.job?.department);
  if (fallback === UNASSIGNED_DEPARTMENT) {
    return { key: "legacy:unassigned", name: UNASSIGNED_DEPARTMENT, departmentId: null };
  }
  return { key: `legacy:${fallback.toLowerCase()}`, name: fallback, departmentId: null };
}

/** Unanimous departmentId among grouped employees, else null (no guessing). */
function resolveGroupDepartmentId(employees) {
  const ids = [
    ...new Set(employees.map((e) => e.departmentId).filter(Boolean)),
  ];
  return ids.length === 1 ? ids[0] : null;
}

async function loadActiveEmployees(Employee) {
  return Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
    .select(DEPT_SELECT)
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
 * Department overview: ACTIVE employees grouped by job.department.
 * Non-HR viewers only see hierarchy-visible colleagues.
 */
export async function listOrganizationExplorerDepartments(Employee, user, hrAccess = null, Department = null) {
  const docs = await loadVisibleActiveEmployees(Employee, user, hrAccess);
  const records = await departmentRecordsById(Department, docs);
  /** @type {Map<string, { name: string, employees: ReturnType<typeof projectDepartmentEmployee>[] }>} */
  const groups = new Map();

  for (const doc of docs) {
    const display = displayDepartment(doc, records);
    if (!groups.has(display.key)) groups.set(display.key, { name: display.name, employees: [] });
    groups.get(display.key).employees.push(projectDepartmentEmployee(doc, records));
  }

  const departments = [...groups.values()]
    .map(({ name, employees }) => ({
      name,
      departmentId: resolveGroupDepartmentId(employees),
      employeeCount: employees.length,
      employees,
    }))
    .sort((a, b) => {
      if (a.name === UNASSIGNED_DEPARTMENT) return 1;
      if (b.name === UNASSIGNED_DEPARTMENT) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

  const payload = {
    departments,
    meta: {
      totalDepartments: departments.length,
      totalEmployees: docs.length,
    },
  };
  assertNoSensitiveLeak(payload);
  return payload;
}

/**
 * Employees in a single department (or Unassigned bucket).
 */
export async function listOrganizationExplorerDepartmentEmployees(
  Employee,
  departmentParam,
  user,
  hrAccess = null,
  Department = null
) {
  const department = parseDepartmentParam(departmentParam);
  const docs = await loadVisibleActiveEmployees(Employee, user, hrAccess);
  const records = await departmentRecordsById(Department, docs);
  const wantedKey = `legacy:${department.toLowerCase()}`;

  const employees = docs
    .filter((doc) => {
      const display = displayDepartment(doc, records);
      if (display.departmentId) return display.name === department;
      if (display.name === department) return true;
      return display.key === wantedKey && department !== UNASSIGNED_DEPARTMENT;
    })
    .map((doc) => projectDepartmentEmployee(doc, records));

  const payload = {
    department,
    departmentId: resolveGroupDepartmentId(employees),
    employees,
    meta: {
      total: employees.length,
    },
  };
  assertNoSensitiveLeak(payload);
  return payload;
}

import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { EMPLOYEE_RELATIONSHIPS } from "./employeeRelationshipService.js";
import {
  assertNoSensitiveLeak,
  resolveVisibleEmployeeAccess,
  serializeDirectoryCard,
} from "./employeeVisibilityService.js";

const DIRECTORY_SELECT =
  "_id fullName preferredName employeeCode email phoneNumber avatar job.jobTitle job.department job.workLocation job.employmentType job.joiningDate job.reportingManagerId";

const DIRECTORY_ALLOWED_LIMITS = new Set([10, 20, 50]);
const DIRECTORY_DEFAULT_LIMIT = 20;
const DIRECTORY_MAX_SEARCH_LENGTH = 100;

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

function parsePage(raw) {
  const page = parseInt(raw, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseLimit(raw) {
  const limit = parseInt(raw, 10);
  return DIRECTORY_ALLOWED_LIMITS.has(limit) ? limit : DIRECTORY_DEFAULT_LIMIT;
}

function parseSearch(raw) {
  if (raw == null) return "";
  if (typeof raw !== "string") {
    throw new HttpError(400, "Invalid search query.", {
      field: "search",
      code: "INVALID_SEARCH",
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length > DIRECTORY_MAX_SEARCH_LENGTH) {
    throw new HttpError(400, `Search query must be at most ${DIRECTORY_MAX_SEARCH_LENGTH} characters.`, {
      field: "search",
      code: "SEARCH_TOO_LONG",
    });
  }
  return trimmed;
}

/**
 * Build Mongo filter for the company-wide employee directory.
 * ACTIVE employees only; free-text search on non-sensitive identity/job fields.
 */
export function buildDirectoryQuery(search) {
  const query = {
    status: EMPLOYEE_STATUSES.ACTIVE,
  };

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    query.$or = [
      { fullName: regex },
      { preferredName: regex },
      { employeeCode: regex },
      { "job.jobTitle": regex },
      { "job.department": regex },
    ];
  }

  return query;
}

/**
 * Tenant-scoped, relationship-aware directory page.
 * Non-HR users only see hierarchy-visible colleagues; pagination counts match.
 * HR_ADMIN retains company-wide directory access.
 */
export async function buildEmployeeDirectory({
  Employee,
  user,
  search: searchRaw,
  page: pageRaw,
  limit: limitRaw,
  hrAccess = null,
}) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }

  const search = parseSearch(searchRaw);
  const page = parsePage(pageRaw);
  const limit = parseLimit(limitRaw);
  let query = buildDirectoryQuery(search);

  // HR keeps DB-side pagination; apply employee scope when ENFORCED.
  if (user.role === USER_ROLES.HR_ADMIN) {
    if (hrAccess) {
      const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
      query = mergeEmployeeScopeFilter(hrAccess, query);
    }
    const [totalEmployees, employees] = await Promise.all([
      Employee.countDocuments(query),
      Employee.find(query)
        .select(DIRECTORY_SELECT)
        .sort({ fullName: 1, employeeCode: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const data = employees.map((emp) =>
      serializeDirectoryCard(emp, EMPLOYEE_RELATIONSHIPS.OTHER)
    );
    assertNoSensitiveLeak({ data });

    return {
      success: true,
      data,
      pagination: {
        page,
        limit,
        totalEmployees,
        totalPages: Math.ceil(totalEmployees / limit) || 0,
      },
    };
  }

  // Employees: load matching candidates, filter by hierarchy, then paginate.
  const candidates = await Employee.find(query)
    .select(DIRECTORY_SELECT)
    .sort({ fullName: 1, employeeCode: 1 })
    .lean();

  const access = await resolveVisibleEmployeeAccess({
    Employee,
    user,
    employees: candidates,
  });

  const visible = candidates.filter((emp) => access.visibleIds.has(String(emp._id)));
  const totalEmployees = visible.length;
  const start = (page - 1) * limit;
  const pageRows = visible.slice(start, start + limit);

  const data = pageRows.map((emp) => {
    const id = String(emp._id);
    const relationship =
      access.relationshipById.get(id)?.relationship || EMPLOYEE_RELATIONSHIPS.OTHER;
    return serializeDirectoryCard(emp, relationship);
  });

  assertNoSensitiveLeak({ data });

  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      totalEmployees,
      totalPages: Math.ceil(totalEmployees / limit) || 0,
    },
  };
}

export {
  DIRECTORY_ALLOWED_LIMITS,
  DIRECTORY_DEFAULT_LIMIT,
  DIRECTORY_MAX_SEARCH_LENGTH,
  DIRECTORY_SELECT,
  escapeRegex,
};

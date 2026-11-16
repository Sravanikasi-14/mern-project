import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import {
  EMPLOYEE_RELATIONSHIPS,
  collectHierarchyVisibleEmployeeIds,
  resolveRelationshipsForTargets,
  resolveViewerEmployee,
} from "./employeeRelationshipService.js";
import {
  assertNoSensitiveLeak,
  serializeDirectoryCard,
} from "./employeeVisibilityService.js";
import { isStrictObjectId } from "./reportingManagerService.js";
import { buildPrefixCiRegex, escapeRegex } from "../utils/searchRegex.js";

const DIRECTORY_SELECT =
  "_id fullName preferredName employeeCode email phoneNumber avatar job.jobTitle job.department job.workLocation job.employmentType job.joiningDate job.reportingManagerId";

const DIRECTORY_ALLOWED_LIMITS = new Set([10, 20, 50]);
const DIRECTORY_DEFAULT_LIMIT = 20;
const DIRECTORY_MAX_SEARCH_LENGTH = 100;

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
    // F58: prefix-anchored directory search.
    const regex = buildPrefixCiRegex(search);
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

function toObjectIdList(idSet) {
  const out = [];
  for (const id of idSet) {
    if (isStrictObjectId(id)) {
      out.push(new mongoose.Types.ObjectId(String(id)));
    }
  }
  return out;
}

/**
 * Company-wide DB-paginated directory page (HR portal operators).
 * Cards use OTHER relationship serialization (unchanged from prior bypass path).
 */
async function buildPortalOperatorDirectoryPage({
  Employee,
  query,
  page,
  limit,
}) {
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

/**
 * Tenant-scoped, relationship-aware directory page.
 * Non-HR users only see hierarchy-visible colleagues; pagination counts match.
 * HR_ADMIN / COMPANY_ADMIN use DB-side pagination (company-wide or scoped).
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

  // Portal operators: never full-fetch; paginate in MongoDB.
  // HR_ADMIN retains ENFORCED scope via mergeEmployeeScopeFilter.
  // COMPANY_ADMIN sees company-wide ACTIVE directory (prior bypass semantics).
  if (isHrPortalOperator(user.role)) {
    if (user.role === USER_ROLES.HR_ADMIN && hrAccess) {
      const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
      query = mergeEmployeeScopeFilter(hrAccess, query);
    }
    return buildPortalOperatorDirectoryPage({ Employee, query, page, limit });
  }

  // Employees: resolve visible IDs first, then count/page only that set.
  const viewer = await resolveViewerEmployee(Employee, user);
  if (!viewer) {
    throw new HttpError(403, "No employee profile is linked to this account.", {
      code: "VIEWER_EMPLOYEE_MISSING",
    });
  }

  const visibleIds = await collectHierarchyVisibleEmployeeIds({
    Employee,
    viewerEmployeeId: viewer._id,
  });
  const visibleObjectIds = toObjectIdList(visibleIds);

  const pageQuery =
    visibleObjectIds.length === 0
      ? { ...query, _id: { $in: [] } }
      : { ...query, _id: { $in: visibleObjectIds } };

  const [totalEmployees, employees] = await Promise.all([
    Employee.countDocuments(pageQuery),
    Employee.find(pageQuery)
      .select(DIRECTORY_SELECT)
      .sort({ fullName: 1, employeeCode: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const relationshipById = await resolveRelationshipsForTargets({
    Employee,
    viewerEmployeeId: viewer._id,
    targets: employees,
  });

  const data = employees.map((emp) => {
    const id = String(emp._id);
    const relationship =
      relationshipById.get(id)?.relationship || EMPLOYEE_RELATIONSHIPS.OTHER;
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

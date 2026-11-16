import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import {
  EMPLOYEE_RELATIONSHIPS,
  resolveRelationshipsForTargets,
  resolveViewerEmployee,
} from "./employeeRelationshipService.js";
import {
  assertNoSensitiveLeak,
  serializePeopleSearchHit,
} from "./employeeVisibilityService.js";
import { escapeRegex } from "../utils/searchRegex.js";

const PEOPLE_SEARCH_SELECT =
  "_id fullName preferredName employeeCode email phoneNumber avatar status job.jobTitle job.department job.workLocation job.employmentType job.reportingManagerId";

const PEOPLE_SEARCH_MAX_Q = 100;
const PEOPLE_SEARCH_DEFAULT_LIMIT = 10;
const PEOPLE_SEARCH_MAX_LIMIT = 20;
/** Fetch extra Mongo candidates so auth-aware post-filter can still fill `limit`. */
const PEOPLE_SEARCH_CANDIDATE_MULTIPLIER = 5;
const PEOPLE_SEARCH_CANDIDATE_CAP = 80;

/**
 * String fields that may appear on a serialized people-search hit.
 * Only values present on the hit are used for match — restricted attrs cannot leak.
 */
const AUTHORIZED_HIT_SEARCH_KEYS = Object.freeze([
  "fullName",
  "preferredName",
  "employeeCode",
  "jobTitle",
  "department",
  "workLocation",
  "employmentType",
  "email",
  "phoneNumber",
  "status",
]);

function parseQuery(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string") {
    throw new HttpError(400, "Invalid search query.", {
      field: "q",
      code: "INVALID_SEARCH",
    });
  }
  const trimmed = raw.trim();
  if (trimmed.length > PEOPLE_SEARCH_MAX_Q) {
    throw new HttpError(400, `Search query must be at most ${PEOPLE_SEARCH_MAX_Q} characters.`, {
      field: "q",
      code: "SEARCH_TOO_LONG",
    });
  }
  return trimmed;
}

function parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return PEOPLE_SEARCH_DEFAULT_LIMIT;
  return Math.min(n, PEOPLE_SEARCH_MAX_LIMIT);
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/** Loose contains regex for phone / email fragments (candidates only; auth post-filter still required). */
function buildContainsCiRegex(raw) {
  const term = String(raw || "").trim();
  if (!term) return null;
  return new RegExp(escapeRegex(term), "i");
}

function buildPhoneDigitsRegex(raw) {
  const digits = digitsOnly(raw);
  if (digits.length < 3) return null;
  return new RegExp(digits.split("").map(escapeRegex).join("\\D*"));
}

/**
 * Broad candidate filter (ACTIVE employees). May match fields the viewer cannot see;
 * callers must post-filter with {@link hitMatchesAuthorizedQuery}.
 * Uses substring match so designation / email / phone fragments all work.
 */
export function buildPeopleSearchQuery(q) {
  const query = { status: EMPLOYEE_STATUSES.ACTIVE };
  if (!q) return query;
  const contains = buildContainsCiRegex(q);
  const phoneDigits = buildPhoneDigitsRegex(q);
  if (!contains && !phoneDigits) return query;

  query.$or = [];
  if (contains) {
    query.$or.push(
      { fullName: contains },
      { preferredName: contains },
      { employeeCode: contains },
      { email: contains },
      { phoneNumber: contains },
      { "job.jobTitle": contains },
      { "job.department": contains },
      { "job.workLocation": contains },
      { "job.employmentType": contains }
    );
  }
  if (phoneDigits) {
    query.$or.push({ phoneNumber: phoneDigits });
  }
  return query;
}

function valueMatchesQuery(key, value, needle) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  if (key === "phoneNumber") {
    const hay = digitsOnly(raw);
    const nd = digitsOnly(needle);
    if (nd.length >= 3 && hay.includes(nd)) return true;
    return lower.includes(needle);
  }

  // Partial match for every authorized text field (name, title, dept, email, …).
  return lower.includes(needle);
}

/**
 * True when `q` matches a value that is actually present on the authorized hit.
 * Preferred name is treated as a name alias when fullName is visible.
 */
export function hitMatchesAuthorizedQuery(hit, q, rawEmployee = null) {
  if (!q) return true;
  if (!hit || typeof hit !== "object") return false;
  const needle = String(q).trim().toLowerCase();
  if (!needle) return true;

  for (const key of AUTHORIZED_HIT_SEARCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(hit, key)) continue;
    if (valueMatchesQuery(key, hit[key], needle)) return true;
  }

  // Name-tier viewers: preferredName may match even when not echoed on the hit.
  if (Object.prototype.hasOwnProperty.call(hit, "fullName") && rawEmployee?.preferredName) {
    if (valueMatchesQuery("fullName", rawEmployee.preferredName, needle)) return true;
  }

  return false;
}

/**
 * Escape-safe prefix test for unit tests / callers without rebuilding RegExp.
 */
export function authorizedFieldPrefixMatch(value, q) {
  const needle = String(q || "").trim();
  if (!needle) return true;
  const v = String(value || "").trim();
  if (!v) return false;
  return new RegExp(`^${escapeRegex(needle)}`, "i").test(v);
}

/**
 * Global people search: every ACTIVE employee is discoverable; fields are
 * redacted server-side from reportingManagerId hierarchy (not job titles).
 * Candidates may match restricted attributes in Mongo, but results are kept
 * only when `q` matches an attribute present on the authorized payload.
 * HR portal operators with people access receive expanded professional fields.
 */
export async function buildPeopleSearch({
  Employee,
  user,
  q: qRaw,
  limit: limitRaw,
  hrAccess = null,
}) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }

  const q = parseQuery(qRaw);
  const limit = parseLimit(limitRaw);

  if (q.length < 2) {
    return { success: true, data: [], query: q, limit };
  }

  let filter = buildPeopleSearchQuery(q);

  if (user.role === USER_ROLES.HR_ADMIN && hrAccess) {
    const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
    filter = mergeEmployeeScopeFilter(hrAccess, filter);
  }

  const candidateLimit = Math.min(
    PEOPLE_SEARCH_CANDIDATE_CAP,
    Math.max(limit * PEOPLE_SEARCH_CANDIDATE_MULTIPLIER, limit)
  );

  const employees = await Employee.find(filter)
    .select(PEOPLE_SEARCH_SELECT)
    .sort({ fullName: 1, employeeCode: 1 })
    .limit(candidateLimit)
    .lean();

  const hrExpanded = isHrPortalOperator(user.role);

  if (hrExpanded) {
    const data = [];
    for (const emp of employees) {
      const hit = serializePeopleSearchHit(emp, EMPLOYEE_RELATIONSHIPS.OTHER, {
        hrExpanded: true,
      });
      if (!hitMatchesAuthorizedQuery(hit, q, emp)) continue;
      data.push(hit);
      if (data.length >= limit) break;
    }
    assertNoSensitiveLeak({ data });
    return { success: true, data, query: q, limit };
  }

  const viewer = await resolveViewerEmployee(Employee, user);
  if (!viewer) {
    throw new HttpError(403, "No employee profile is linked to this account.", {
      code: "VIEWER_EMPLOYEE_MISSING",
    });
  }

  const relationshipById = await resolveRelationshipsForTargets({
    Employee,
    viewerEmployeeId: viewer._id,
    targets: employees,
  });

  const data = [];
  for (const emp of employees) {
    const id = String(emp._id);
    const relationship =
      relationshipById.get(id)?.relationship || EMPLOYEE_RELATIONSHIPS.OTHER;
    const hit = serializePeopleSearchHit(emp, relationship, { hrExpanded: false });
    if (!hitMatchesAuthorizedQuery(hit, q, emp)) continue;
    data.push(hit);
    if (data.length >= limit) break;
  }

  assertNoSensitiveLeak({ data });
  return { success: true, data, query: q, limit };
}

export {
  PEOPLE_SEARCH_DEFAULT_LIMIT,
  PEOPLE_SEARCH_MAX_LIMIT,
  PEOPLE_SEARCH_MAX_Q,
  PEOPLE_SEARCH_SELECT,
  AUTHORIZED_HIT_SEARCH_KEYS,
};

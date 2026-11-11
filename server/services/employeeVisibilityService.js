import { isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { isStrictObjectId } from "./reportingManagerService.js";
import {
  EMPLOYEE_RELATIONSHIPS,
  isHierarchyVisibleRelationship,
  resolveRelationshipForAuthenticatedUser,
  resolveRelationshipsForTargets,
  resolveViewerEmployee,
} from "./employeeRelationshipService.js";

/**
 * Directional field tiers for relationship-based visibility.
 * Explicit allowlists only — never spread Mongoose documents into responses.
 *
 * UPWARD  = viewer looking at their manager / senior chain (restricted)
 * DOWNWARD = viewer looking at their reports (expanded)
 * PEER / OTHER / UNRESOLVED = basic professional cards (OTHER omits manager ref)
 */

const SAFE_MANAGER_REF_FIELDS = Object.freeze([
  "_id",
  "fullName",
  "employeeCode",
  "jobTitle",
  "department",
  "avatar",
]);

/** Viewing DIRECT_MANAGER / INDIRECT_MANAGER — no phone, joining date, or employment type. */
const UPWARD_MANAGER_VISIBLE_FIELDS = Object.freeze([
  "_id",
  "fullName",
  "employeeCode",
  "email",
  "avatar",
  "job.jobTitle",
  "job.department",
  "job.workLocation",
  "job.reportingManagerId",
]);

/**
 * Viewing DIRECT_REPORT / INDIRECT_REPORT — expanded manager-of-report fields.
 * Official work email is included; generic phoneNumber is not (no dedicated
 * work-contact field exists on Employee).
 */
const DOWNWARD_REPORT_VISIBLE_FIELDS = Object.freeze([
  "_id",
  "fullName",
  "employeeCode",
  "email",
  "avatar",
  "job.jobTitle",
  "job.department",
  "job.workLocation",
  "job.reportingManagerId",
  "job.employmentType",
  "job.joiningDate",
]);

/** Peers share a manager — include a safe manager reference. */
const PEER_VISIBLE_FIELDS = Object.freeze([
  "_id",
  "fullName",
  "employeeCode",
  "email",
  "avatar",
  "job.jobTitle",
  "job.department",
  "job.workLocation",
  "job.reportingManagerId",
]);

/** OTHER / UNRESOLVED — basic professional info only (no manager ref). */
const OTHER_VISIBLE_FIELDS = Object.freeze([
  "_id",
  "fullName",
  "employeeCode",
  "email",
  "avatar",
  "job.jobTitle",
  "job.department",
  "job.workLocation",
]);

/**
 * @deprecated Prefer UPWARD/DOWNWARD field sets. Kept as alias of downward expand
 * for any residual imports during transition.
 */
const CHAIN_VISIBLE_FIELDS = DOWNWARD_REPORT_VISIBLE_FIELDS;

/** @deprecated Prefer PEER_VISIBLE_FIELDS / OTHER_VISIBLE_FIELDS. */
const DIRECTORY_VISIBLE_FIELDS = PEER_VISIBLE_FIELDS;

/**
 * SELF allowlist mirrors existing getMyProfile employee payload without invitation tokens
 * or authentication secrets. Intentionally excludes invitation.token.
 */
const SELF_VISIBLE_FIELDS = Object.freeze([
  "_id",
  "employeeCode",
  "fullName",
  "preferredName",
  "email",
  "personalEmail",
  "phoneNumber",
  "personalPhone",
  "dateOfBirth",
  "gender",
  "city",
  "status",
  "avatar",
  "job",
  "residentialAddress",
  "emergencyContact",
  "bankDetails",
  "taxDetails",
  "identityDetails",
  "documents",
  "attendance",
]);

const SENSITIVE_TOP_LEVEL_DENY = Object.freeze([
  "invitation",
  "userId",
  "exit",
  "previousEmploymentPeriods",
  "customFields",
  "passwordHash",
  "schemaVersion",
]);

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

function getByPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setByPath(out, path, value) {
  const parts = path.split(".");
  let cur = out;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function allowlistForTier(tier) {
  switch (tier) {
    case "UPWARD":
      return UPWARD_MANAGER_VISIBLE_FIELDS;
    case "DOWNWARD":
      return DOWNWARD_REPORT_VISIBLE_FIELDS;
    case "PEER":
      return PEER_VISIBLE_FIELDS;
    case "OTHER":
      return OTHER_VISIBLE_FIELDS;
    default:
      return OTHER_VISIBLE_FIELDS;
  }
}

/**
 * Serialize reportingManagerId as a safe reference object or null.
 * Accepts ObjectId, populated doc, or null.
 */
export function serializeSafeManagerRef(managerValue) {
  if (managerValue == null || managerValue === "") return null;

  if (typeof managerValue === "object" && managerValue._id) {
    return {
      _id: managerValue._id,
      fullName: managerValue.fullName || "",
      employeeCode: managerValue.employeeCode || "",
      jobTitle: managerValue.job?.jobTitle || managerValue.jobTitle || "",
      department: managerValue.job?.department || managerValue.department || "",
      avatar: managerValue.avatar || "",
    };
  }

  if (isStrictObjectId(managerValue)) {
    return { _id: String(managerValue) };
  }

  return null;
}

export function visibilityTierForRelationship(relationship) {
  switch (relationship) {
    case EMPLOYEE_RELATIONSHIPS.SELF:
      return "SELF";
    case EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER:
    case EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER:
      return "UPWARD";
    case EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT:
    case EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT:
      return "DOWNWARD";
    case EMPLOYEE_RELATIONSHIPS.PEER:
      return "PEER";
    case EMPLOYEE_RELATIONSHIPS.OTHER:
    case EMPLOYEE_RELATIONSHIPS.UNRESOLVED:
      return "OTHER";
    default:
      return "OTHER";
  }
}

/**
 * Build an allowlisted employee projection for a relationship tier.
 * Never includes invitation tokens, auth secrets, or unlisted fields.
 */
export function serializeEmployeeByRelationship(employeeDoc, relationship, options = {}) {
  if (!employeeDoc) return null;

  const lean =
    typeof employeeDoc.toObject === "function" ? employeeDoc.toObject() : { ...employeeDoc };

  for (const key of SENSITIVE_TOP_LEVEL_DENY) {
    delete lean[key];
  }
  if (lean.invitation) delete lean.invitation;

  const tier = visibilityTierForRelationship(relationship);

  if (tier === "SELF") {
    const selfPayload = pick(lean, [
      "_id",
      "employeeCode",
      "fullName",
      "preferredName",
      "email",
      "personalEmail",
      "phoneNumber",
      "personalPhone",
      "dateOfBirth",
      "gender",
      "city",
      "status",
      "avatar",
      "residentialAddress",
      "emergencyContact",
      "bankDetails",
      "taxDetails",
      "identityDetails",
      "documents",
      "attendance",
    ]);
    selfPayload.avatar = selfPayload.avatar || "";
    selfPayload.job = lean.job
      ? {
          jobTitle: lean.job.jobTitle || "",
          department: lean.job.department || "",
          jobGrade: lean.job.jobGrade || "",
          employmentType: lean.job.employmentType || "",
          workLocation: lean.job.workLocation || "",
          joiningDate: lean.job.joiningDate || null,
          terminationDate: lean.job.terminationDate || null,
          reportingManagerId: serializeSafeManagerRef(lean.job.reportingManagerId),
          project: lean.job.project
            ? {
                projectName: lean.job.project.projectName || "",
                projectType: lean.job.project.projectType || "",
              }
            : { projectName: "", projectType: "" },
        }
      : null;
    if (options.compensation !== undefined) {
      selfPayload.compensation = options.compensation;
    }
    return selfPayload;
  }

  const allow = allowlistForTier(tier);
  const includesManagerRef = allow.includes("job.reportingManagerId");
  const out = {};
  for (const path of allow) {
    if (path === "job.reportingManagerId") {
      setByPath(out, path, serializeSafeManagerRef(getByPath(lean, path)));
      continue;
    }
    const value = getByPath(lean, path);
    if (value !== undefined) setByPath(out, path, value);
  }

  out.job = {
    jobTitle: out.job?.jobTitle || "",
    department: out.job?.department || "",
    workLocation: out.job?.workLocation || "",
    ...(includesManagerRef
      ? { reportingManagerId: out.job?.reportingManagerId ?? null }
      : {}),
    ...(tier === "DOWNWARD"
      ? {
          employmentType: out.job?.employmentType || "",
          joiningDate: out.job?.joiningDate || null,
        }
      : {}),
  };
  out.avatar = out.avatar || "";

  return out;
}

/**
 * Assert a response object never contains forbidden secrets.
 */
export function assertNoSensitiveLeak(payload) {
  const json = JSON.stringify(payload);
  if (!json) return;
  if (/"token"\s*:/.test(json) && /invitation/i.test(json)) {
    throw new HttpError(500, "Refusing to expose invitation token in employee response.", {
      code: "SENSITIVE_LEAK_BLOCKED",
    });
  }
  if (/"passwordHash"\s*:/.test(json)) {
    throw new HttpError(500, "Refusing to expose password hash in employee response.", {
      code: "SENSITIVE_LEAK_BLOCKED",
    });
  }
}

/**
 * Strip invitation.token from HR employee payloads without otherwise changing HR access.
 */
export function sanitizeHrEmployeePayload(employeeLike) {
  if (!employeeLike || typeof employeeLike !== "object") return employeeLike;
  const copy = { ...employeeLike };
  if (copy.invitation && typeof copy.invitation === "object") {
    const { token, ...restInvitation } = copy.invitation;
    copy.invitation = restInvitation;
  }
  delete copy.passwordHash;
  return copy;
}

/**
 * Build a relationship-aware visible profile for an authenticated viewer.
 * Relationship is always resolved server-side — never trusted from the client.
 */
export async function buildVisibleEmployeeProfile({
  Employee,
  user,
  targetEmployeeId,
}) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }

  if (!isStrictObjectId(targetEmployeeId)) {
    throw new HttpError(400, "Invalid employee reference.", {
      code: "INVALID_EMPLOYEE_ID",
    });
  }

  const target = await Employee.findById(targetEmployeeId)
    .populate("job.reportingManagerId", "fullName employeeCode avatar job.jobTitle job.department")
    .lean();

  if (!target) {
    throw new HttpError(404, "Employee not found", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }

  if (isHrPortalOperator(user.role)) {
    const hrSafe = sanitizeHrEmployeePayload({
      _id: target._id,
      employeeCode: target.employeeCode,
      fullName: target.fullName,
      preferredName: target.preferredName || "",
      email: target.email,
      phoneNumber: target.phoneNumber || "",
      personalEmail: target.personalEmail || "",
      personalPhone: target.personalPhone || "",
      dateOfBirth: target.dateOfBirth || null,
      gender: target.gender || "",
      city: target.city || "",
      status: target.status,
      avatar: target.avatar || "",
      job: {
        ...(target.job || {}),
        reportingManagerId: serializeSafeManagerRef(target.job?.reportingManagerId),
      },
      residentialAddress: target.residentialAddress || null,
      emergencyContact: target.emergencyContact || null,
      bankDetails: target.bankDetails || null,
      taxDetails: target.taxDetails || null,
      identityDetails: target.identityDetails || null,
      documents: target.documents || [],
      attendance: target.attendance || null,
      invitation: target.invitation
        ? {
            status: target.invitation.status,
            sentAt: target.invitation.sentAt || null,
            acceptedAt: target.invitation.acceptedAt || null,
          }
        : null,
    });
    assertNoSensitiveLeak(hrSafe);
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.OTHER,
      visibilityTier: "HR_ADMIN",
      employee: hrSafe,
    };
  }

  const relation = await resolveRelationshipForAuthenticatedUser({
    Employee,
    user,
    targetEmployeeId,
  });

  // Batch A: unrelated / unresolved profiles are not discoverable (404, not 403).
  if (!isHierarchyVisibleRelationship(relation.relationship)) {
    throw new HttpError(404, "Employee not found", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }

  const employee = serializeEmployeeByRelationship(target, relation.relationship);
  assertNoSensitiveLeak(employee);

  return {
    relationship: relation.relationship,
    visibilityTier: visibilityTierForRelationship(relation.relationship),
    employee,
  };
}

/**
 * Resolve which employee ids a viewer may discover under hierarchy rules.
 * HR_ADMIN bypasses filtering (full tenant access).
 *
 * @param {object} params
 * @param {import("mongoose").Model} params.Employee
 * @param {object} params.user
 * @param {Array<{_id: unknown, job?: { reportingManagerId?: unknown }}>} params.employees
 * @returns {Promise<{
 *   bypass: boolean,
 *   visibleIds: Set<string>,
 *   relationshipById: Map<string, { relationship: string }>,
 *   viewer: object|null,
 * }>}
 */
export async function resolveVisibleEmployeeAccess({ Employee, user, employees }) {
  if (!user) {
    throw new HttpError(401, "Authentication required");
  }

  const list = Array.isArray(employees) ? employees : [];

  if (isHrPortalOperator(user.role)) {
    return {
      bypass: true,
      visibleIds: new Set(list.map((doc) => String(doc._id))),
      relationshipById: new Map(),
      viewer: null,
    };
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
    targets: list,
  });

  const visibleIds = new Set();
  for (const doc of list) {
    const id = String(doc._id);
    const relationship =
      relationshipById.get(id)?.relationship || EMPLOYEE_RELATIONSHIPS.OTHER;
    if (isHierarchyVisibleRelationship(relationship)) {
      visibleIds.add(id);
    }
  }

  return {
    bypass: false,
    visibleIds,
    relationshipById,
    viewer,
  };
}

/**
 * Directory list card: never uses the full SELF allowlist.
 * DOWNWARD relationships may include employmentType / joiningDate (not phone).
 * OTHER / UNRESOLVED omit reportingManagerId.
 */
export function serializeDirectoryCard(employeeDoc, relationship) {
  const effectiveRelationship =
    relationship === EMPLOYEE_RELATIONSHIPS.SELF
      ? EMPLOYEE_RELATIONSHIPS.OTHER
      : relationship;

  const serialized = serializeEmployeeByRelationship(employeeDoc, effectiveRelationship);
  if (!serialized) return null;

  const card = {
    _id: serialized._id,
    fullName: serialized.fullName || "",
    employeeCode: serialized.employeeCode || "",
    email: serialized.email || "",
    avatar: serialized.avatar || "",
    jobTitle: serialized.job?.jobTitle || "",
    department: serialized.job?.department || "",
    workLocation: serialized.job?.workLocation || "",
    relationship:
      relationship === EMPLOYEE_RELATIONSHIPS.SELF
        ? EMPLOYEE_RELATIONSHIPS.SELF
        : effectiveRelationship,
  };

  if (Object.prototype.hasOwnProperty.call(serialized.job || {}, "reportingManagerId")) {
    card.reportingManagerId = serialized.job.reportingManagerId ?? null;
  }

  const tier = visibilityTierForRelationship(effectiveRelationship);
  if (tier === "DOWNWARD") {
    if (serialized.job?.employmentType !== undefined) {
      card.employmentType = serialized.job.employmentType || "";
    }
    if (serialized.job?.joiningDate !== undefined) {
      card.joiningDate = serialized.job.joiningDate || null;
    }
  }

  assertNoSensitiveLeak(card);
  return card;
}

export {
  UPWARD_MANAGER_VISIBLE_FIELDS,
  DOWNWARD_REPORT_VISIBLE_FIELDS,
  PEER_VISIBLE_FIELDS,
  OTHER_VISIBLE_FIELDS,
  CHAIN_VISIBLE_FIELDS,
  DIRECTORY_VISIBLE_FIELDS,
  SELF_VISIBLE_FIELDS,
  SAFE_MANAGER_REF_FIELDS,
  resolveViewerEmployee,
};

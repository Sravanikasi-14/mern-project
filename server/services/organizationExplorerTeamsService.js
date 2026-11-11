import mongoose from "mongoose";
import Company from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import {
  assertNoSensitiveLeak,
  resolveVisibleEmployeeAccess,
} from "./employeeVisibilityService.js";
import { resolveOrganizationExplorerConfig } from "./organizationExplorerConfigService.js";
import { HR_SCOPE_MODES } from "../constants/hrAccessCatalog.js";
import { assertEmployeeInScope } from "./hrAccessEnforcementService.js";

export const TEAM_EMPLOYEE_ALLOWED_KEYS = Object.freeze([
  "id",
  "fullName",
  "employeeCode",
  "jobTitle",
  "department",
  "reportingManagerId",
  "avatar",
]);

const TEAM_EMPLOYEE_SELECT =
  "_id fullName employeeCode status job.jobTitle job.department job.reportingManagerId avatar";

const MAX_TEAM_NAME_LENGTH = 200;

/**
 * Ensure Organization Explorer has the teams view enabled for this tenant.
 */
export async function assertTeamsViewEnabled(company) {
  if (!company?._id) {
    throw new HttpError(401, "Authentication required");
  }

  let rawConfig = company.config?.organizationExplorer;
  if (rawConfig === undefined) {
    const fresh = await Company.findById(company._id).select("config.organizationExplorer").lean();
    rawConfig = fresh?.config?.organizationExplorer;
  }

  const config = resolveOrganizationExplorerConfig(rawConfig);
  if (!config.enabledViews.includes("teams")) {
    throw new HttpError(403, "Teams view is not enabled for this organization.", {
      code: "ORGANIZATION_EXPLORER_VIEW_DISABLED",
      field: "teams",
    });
  }
  return config;
}

function isHrAdmin(user) {
  return user?.role === USER_ROLES.HR_ADMIN || user?.role === USER_ROLES.COMPANY_ADMIN;
}

function parseObjectId(value, field) {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(str)) {
    throw new HttpError(400, `Invalid ${field}.`, {
      field,
      code: "INVALID_EMPLOYEE_ID",
    });
  }
  return new mongoose.Types.ObjectId(str);
}

function parseTeamId(raw) {
  const str = typeof raw === "string" ? raw.trim() : String(raw || "");
  if (!mongoose.Types.ObjectId.isValid(str)) {
    throw new HttpError(400, "Invalid team id.", {
      field: "teamId",
      code: "INVALID_TEAM_ID",
    });
  }
  return str;
}

function normalizeTeamName(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpError(400, "Team name is required.", {
      field: "name",
      code: "INVALID_TEAM_NAME",
    });
  }
  const name = raw.trim();
  if (name.length > MAX_TEAM_NAME_LENGTH) {
    throw new HttpError(400, "Team name is too long.", {
      field: "name",
      code: "INVALID_TEAM_NAME",
    });
  }
  return name;
}

function normalizeDepartment(raw) {
  if (raw == null) return "";
  if (typeof raw !== "string") {
    throw new HttpError(400, "Department must be a string.", {
      field: "department",
      code: "INVALID_DEPARTMENT",
    });
  }
  return raw.trim();
}

function dedupeObjectIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/**
 * Validate lead + members against tenant ACTIVE employees.
 * Ensures lead is included in members. Rejects duplicates / inactive / missing.
 */
async function resolveMembership(Employee, { leadEmployeeId, memberEmployeeIds }) {
  const leadId = leadEmployeeId == null ? null : parseObjectId(leadEmployeeId, "leadEmployeeId");

  if (!Array.isArray(memberEmployeeIds)) {
    throw new HttpError(400, "memberEmployeeIds must be an array.", {
      field: "memberEmployeeIds",
      code: "INVALID_MEMBERS",
    });
  }

  const parsedMembers = memberEmployeeIds.map((id, index) =>
    parseObjectId(id, `memberEmployeeIds[${index}]`)
  );

  if (parsedMembers.some((id) => id == null)) {
    throw new HttpError(400, "memberEmployeeIds entries must be valid employee ids.", {
      field: "memberEmployeeIds",
      code: "INVALID_MEMBERS",
    });
  }

  const asStrings = parsedMembers.map(String);
  if (new Set(asStrings).size !== asStrings.length) {
    throw new HttpError(400, "memberEmployeeIds must not contain duplicates.", {
      field: "memberEmployeeIds",
      code: "DUPLICATE_MEMBERS",
    });
  }

  let memberIds = [...parsedMembers];
  if (leadId) {
    if (!memberIds.some((id) => String(id) === String(leadId))) {
      memberIds.push(leadId);
    }
  }
  memberIds = dedupeObjectIds(memberIds);

  if (memberIds.length === 0) {
    return { leadEmployeeId: null, memberEmployeeIds: [] };
  }

  const docs = await Employee.find({ _id: { $in: memberIds } })
    .select("_id status")
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  for (const id of memberIds) {
    const doc = byId.get(String(id));
    if (!doc) {
      throw new HttpError(400, "One or more member employee ids were not found in this company.", {
        field: "memberEmployeeIds",
        code: "EMPLOYEE_NOT_FOUND",
      });
    }
    if (doc.status !== EMPLOYEE_STATUSES.ACTIVE) {
      throw new HttpError(400, "Team members must be active employees.", {
        field: "memberEmployeeIds",
        code: "INACTIVE_EMPLOYEE",
      });
    }
  }

  if (leadId) {
    const lead = byId.get(String(leadId));
    if (!lead) {
      throw new HttpError(400, "Team lead was not found in this company.", {
        field: "leadEmployeeId",
        code: "EMPLOYEE_NOT_FOUND",
      });
    }
    if (lead.status !== EMPLOYEE_STATUSES.ACTIVE) {
      throw new HttpError(400, "Team lead must be an active employee.", {
        field: "leadEmployeeId",
        code: "INACTIVE_EMPLOYEE",
      });
    }
  }

  return {
    leadEmployeeId: leadId,
    memberEmployeeIds: memberIds,
  };
}

/** Reject lead and member ids outside an enforced CUSTOM scope before they are stored. */
function assertTeamMembershipInScope(hrAccess, membership) {
  const ids = [];
  if (membership?.leadEmployeeId) ids.push(membership.leadEmployeeId);
  for (const id of membership?.memberEmployeeIds || []) ids.push(id);
  for (const id of ids) {
    assertEmployeeInScope(
      hrAccess,
      id,
      "You cannot add an employee outside your access scope to this team."
    );
  }
}

function projectTeamEmployee(doc) {
  if (!doc) return null;
  const departmentRaw = doc.job?.department;
  const projected = {
    id: String(doc._id),
    fullName: doc.fullName || "",
    employeeCode: doc.employeeCode || "",
    jobTitle: doc.job?.jobTitle || "",
    department: typeof departmentRaw === "string" ? departmentRaw.trim() : "",
    reportingManagerId: doc.job?.reportingManagerId
      ? String(doc.job.reportingManagerId)
      : null,
    avatar: doc.avatar || "",
  };
  for (const key of Object.keys(projected)) {
    if (!TEAM_EMPLOYEE_ALLOWED_KEYS.includes(key)) delete projected[key];
  }
  return projected;
}

async function loadEmployeesByIds(Employee, ids, { activeOnly = false } = {}) {
  if (!ids.length) return new Map();
  const query = { _id: { $in: ids } };
  if (activeOnly) query.status = EMPLOYEE_STATUSES.ACTIVE;
  const docs = await Employee.find(query).select(TEAM_EMPLOYEE_SELECT).lean();
  return new Map(docs.map((d) => [String(d._id), d]));
}

function isActiveEmployeeDoc(doc) {
  return Boolean(doc) && doc.status === EMPLOYEE_STATUSES.ACTIVE;
}

/**
 * Serialize a team for the viewer.
 * - Stored member/lead IDs are never mutated.
 * - EMPLOYEE: only ACTIVE employees in `members` / `lead`.
 * - HR_ADMIN: ACTIVE in `members`/`lead`; inactive historical IDs as
 *   `inactiveMembers` / `inactiveLead` with the same safe projection.
 */
function serializeTeam(teamDoc, employeeById, { forHr = false, visibleIds = null } = {}) {
  const memberIds = (teamDoc.memberEmployeeIds || []).map(String);
  const activeMembers = [];
  const inactiveMembers = [];
  const allowId = (id) => (visibleIds ? visibleIds.has(String(id)) : true);

  for (const id of memberIds) {
    if (!allowId(id)) continue;
    const doc = employeeById.get(id);
    if (!doc) continue;
    const projected = projectTeamEmployee(doc);
    if (!projected) continue;
    if (isActiveEmployeeDoc(doc)) {
      activeMembers.push(projected);
    } else if (forHr) {
      inactiveMembers.push(projected);
    }
  }

  const leadId = teamDoc.leadEmployeeId ? String(teamDoc.leadEmployeeId) : null;
  const leadDoc = leadId && allowId(leadId) ? employeeById.get(leadId) : null;
  let lead = null;
  let inactiveLead = null;
  if (leadDoc) {
    const projectedLead = projectTeamEmployee(leadDoc);
    if (isActiveEmployeeDoc(leadDoc)) {
      lead = projectedLead;
    } else if (forHr) {
      inactiveLead = projectedLead;
    }
  }

  const payload = {
    id: String(teamDoc._id),
    name: teamDoc.name || "",
    department: teamDoc.department || "",
    lead,
    members: activeMembers,
    memberCount: activeMembers.length,
  };

  if (forHr) {
    payload.isActive = Boolean(teamDoc.isActive);
    payload.inactiveMembers = inactiveMembers;
    payload.inactiveLead = inactiveLead;
  }

  return payload;
}

function hrTeamVisibleIds(hrAccess) {
  if (!hrAccess?.enforced || hrAccess.role !== USER_ROLES.HR_ADMIN) return null;
  if (!hrAccess.configured) return new Set();
  if (hrAccess.scopeMode === HR_SCOPE_MODES.CUSTOM) {
    return hrAccess.allowedEmployeeIdSet || new Set();
  }
  return null;
}

async function serializeTeams(Employee, teamDocs, { forHr = false, user = null, hrAccess = null } = {}) {
  const allIds = [];
  for (const team of teamDocs) {
    if (team.leadEmployeeId) allIds.push(team.leadEmployeeId);
    for (const id of team.memberEmployeeIds || []) allIds.push(id);
  }
  const uniqueIds = dedupeObjectIds(allIds);
  // Load without status filter so HR can surface inactive historical members.
  const employeeById = await loadEmployeesByIds(Employee, uniqueIds, { activeOnly: false });

  let visibleIds = hrTeamVisibleIds(hrAccess);
  if (!visibleIds && !forHr && user) {
    const docs = [...employeeById.values()];
    const access = await resolveVisibleEmployeeAccess({
      Employee,
      user,
      employees: docs,
    });
    visibleIds = access.bypass ? null : access.visibleIds;
  }

  const teams = teamDocs.map((team) =>
    serializeTeam(team, employeeById, { forHr, visibleIds })
  );
  assertNoSensitiveLeak({ teams });
  return teams;
}

async function assertUniqueActiveName(Team, name, { excludeTeamId = null } = {}) {
  const nameNormalized = name.trim().toLowerCase();
  const query = { isActive: true, nameNormalized };
  if (excludeTeamId) {
    query._id = { $ne: excludeTeamId };
  }
  const existing = await Team.findOne(query).select("_id").lean();
  if (existing) {
    throw new HttpError(409, "An active team with this name already exists.", {
      field: "name",
      code: "DUPLICATE_TEAM_NAME",
    });
  }
}

/**
 * List teams. Employees: active only. HR may pass includeInactive.
 */
export async function listOrganizationExplorerTeams(Team, Employee, user, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  if (includeInactive && !isHrAdmin(user)) {
    throw new HttpError(403, "Only HR admins can list inactive teams.", {
      code: "FORBIDDEN",
    });
  }

  const filter = includeInactive ? {} : { isActive: true };
  const docs = await Team.find(filter).sort({ name: 1 }).lean();
  const forHr = isHrAdmin(user);
  const teams = await serializeTeams(Employee, docs, {
    forHr,
    user: forHr ? null : user,
    hrAccess: options.hrAccess || null,
  });

  return {
    teams,
    meta: {
      total: teams.length,
      includeInactive,
    },
  };
}

export async function getOrganizationExplorerTeam(Team, Employee, user, teamIdRaw, options = {}) {
  const teamId = parseTeamId(teamIdRaw);
  const team = await Team.findById(teamId).lean();
  if (!team) {
    throw new HttpError(404, "Team not found.", { code: "TEAM_NOT_FOUND" });
  }
  if (!team.isActive && !isHrAdmin(user)) {
    throw new HttpError(404, "Team not found.", { code: "TEAM_NOT_FOUND" });
  }

  const forHr = isHrAdmin(user);
  const [serialized] = await serializeTeams(Employee, [team], {
    forHr,
    user: forHr ? null : user,
    hrAccess: options.hrAccess || null,
  });
  return { team: serialized };
}

export async function createOrganizationExplorerTeam(Team, Employee, input = {}, options = {}) {
  const name = normalizeTeamName(input.name);
  const department = normalizeDepartment(input.department);
  await assertUniqueActiveName(Team, name);

  const membership = await resolveMembership(Employee, {
    leadEmployeeId: Object.prototype.hasOwnProperty.call(input, "leadEmployeeId")
      ? input.leadEmployeeId
      : null,
    memberEmployeeIds: Array.isArray(input.memberEmployeeIds) ? input.memberEmployeeIds : [],
  });
  assertTeamMembershipInScope(options.hrAccess, membership);

  let created;
  try {
    created = await Team.create({
      name,
      department,
      leadEmployeeId: membership.leadEmployeeId,
      memberEmployeeIds: membership.memberEmployeeIds,
      isActive: true,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "An active team with this name already exists.", {
        field: "name",
        code: "DUPLICATE_TEAM_NAME",
      });
    }
    throw err;
  }

  const [serialized] = await serializeTeams(Employee, [created.toObject()], {
    forHr: true,
    hrAccess: options.hrAccess || null,
  });
  return { team: serialized };
}

export async function updateOrganizationExplorerTeam(Team, Employee, teamIdRaw, input = {}, options = {}) {
  const teamId = parseTeamId(teamIdRaw);
  const team = await Team.findById(teamId);
  if (!team) {
    throw new HttpError(404, "Team not found.", { code: "TEAM_NOT_FOUND" });
  }

  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = normalizeTeamName(input.name);
    await assertUniqueActiveName(Team, name, { excludeTeamId: team._id });
    team.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(input, "department")) {
    team.department = normalizeDepartment(input.department);
  }

  const touchingMembership =
    Object.prototype.hasOwnProperty.call(input, "leadEmployeeId") ||
    Object.prototype.hasOwnProperty.call(input, "memberEmployeeIds");

  if (touchingMembership) {
    const membership = await resolveMembership(Employee, {
      leadEmployeeId: Object.prototype.hasOwnProperty.call(input, "leadEmployeeId")
        ? input.leadEmployeeId
        : team.leadEmployeeId,
      memberEmployeeIds: Object.prototype.hasOwnProperty.call(input, "memberEmployeeIds")
        ? input.memberEmployeeIds
        : (team.memberEmployeeIds || []).map(String),
    });
    assertTeamMembershipInScope(options.hrAccess, membership);
    team.leadEmployeeId = membership.leadEmployeeId;
    team.memberEmployeeIds = membership.memberEmployeeIds;
  }

  try {
    await team.save();
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "An active team with this name already exists.", {
        field: "name",
        code: "DUPLICATE_TEAM_NAME",
      });
    }
    throw err;
  }

  const [serialized] = await serializeTeams(Employee, [team.toObject()], {
    forHr: true,
    hrAccess: options.hrAccess || null,
  });
  return { team: serialized };
}

/**
 * Soft-deactivate a team. Membership and lead are retained for history.
 */
export async function deactivateOrganizationExplorerTeam(Team, Employee, teamIdRaw, options = {}) {
  const teamId = parseTeamId(teamIdRaw);
  const team = await Team.findById(teamId);
  if (!team) {
    throw new HttpError(404, "Team not found.", { code: "TEAM_NOT_FOUND" });
  }
  if (!team.isActive) {
    const [already] = await serializeTeams(Employee, [team.toObject()], {
      forHr: true,
      hrAccess: options.hrAccess || null,
    });
    return { team: already, alreadyInactive: true };
  }

  team.isActive = false;
  await team.save();

  const [serialized] = await serializeTeams(Employee, [team.toObject()], {
    forHr: true,
    hrAccess: options.hrAccess || null,
  });
  return { team: serialized, alreadyInactive: false };
}

/**
 * Assert reportingManagerId values for the given employees are unchanged.
 * Used by tests / callers that need an explicit non-mutation check after team ops.
 */
export async function snapshotReportingManagers(Employee, employeeIds) {
  const ids = dedupeObjectIds(
    (employeeIds || [])
      .filter(Boolean)
      .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? String(id) : null))
      .filter(Boolean)
  );
  if (!ids.length) return {};
  const docs = await Employee.find({ _id: { $in: ids } })
    .select("_id job.reportingManagerId")
    .lean();
  const out = {};
  for (const doc of docs) {
    out[String(doc._id)] = doc.job?.reportingManagerId
      ? String(doc.job.reportingManagerId)
      : null;
  }
  return out;
}

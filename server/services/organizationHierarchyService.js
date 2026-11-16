import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { HttpError } from "../utils/httpError.js";
import { isStrictObjectId } from "./reportingManagerService.js";
import { walkManagerAncestors } from "./employeeRelationshipService.js";

export const ORG_SELECT =
  "_id fullName preferredName employeeCode status avatar job.jobTitle job.department job.employmentType job.workLocation job.reportingManagerId";

const SEARCH_MAX_LENGTH = 100;
const SEARCH_RESULT_LIMIT = 25;
const UNASSIGNED_PAGE_LIMIT = 100;

function escapeRegex(text) {
  return String(text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Normalize status query into a Mongo filter fragment (no HR scope yet).
 */
export function buildOrganizationStatusFilter(statusRaw) {
  if (statusRaw === "ALL") return {};
  if (statusRaw === EMPLOYEE_STATUSES.INACTIVE) {
    return { status: EMPLOYEE_STATUSES.INACTIVE };
  }
  return { status: EMPLOYEE_STATUSES.ACTIVE };
}

export function resolveOrganizationStatusParam(raw) {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "ACTIVE";
  if (value === "ALL") return "ALL";
  if (value === EMPLOYEE_STATUSES.INACTIVE) return EMPLOYEE_STATUSES.INACTIVE;
  return EMPLOYEE_STATUSES.ACTIVE;
}

async function applyHrScope(statusFilter, hrAccess) {
  if (!hrAccess) return statusFilter;
  const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
  return mergeEmployeeScopeFilter(hrAccess, statusFilter);
}

function docToNodeFields(doc) {
  return {
    id: String(doc._id),
    fullName: doc.fullName || "",
    preferredName: doc.preferredName || "",
    employeeCode: doc.employeeCode || "",
    status: doc.status || EMPLOYEE_STATUSES.ACTIVE,
    avatar: doc.avatar || "",
    jobTitle: doc.job?.jobTitle || "",
    department: doc.job?.department || "",
    employmentType: doc.job?.employmentType || "",
    workLocation: doc.job?.workLocation || "",
    reportingManagerId: doc.job?.reportingManagerId
      ? String(doc.job.reportingManagerId)
      : null,
  };
}

/**
 * Build org-chart structures from an already-loaded employee document set.
 * Cycle edges are broken for rendering only (DB relationships are not mutated).
 *
 * @param {Array<object>} docs lean Employee docs with ORG_SELECT fields
 * @param {{ statusFilterLabel?: string }} [options]
 */
export function buildOrganizationHierarchyFromDocs(docs, options = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const byId = new Map();
  for (const doc of list) {
    byId.set(String(doc._id), doc);
  }

  /** @type {Map<string, string|null>} */
  const effectiveManager = new Map();
  for (const doc of list) {
    const id = String(doc._id);
    let managerId = doc.job?.reportingManagerId ? String(doc.job.reportingManagerId) : null;
    if (managerId && !byId.has(managerId)) managerId = null;
    if (managerId && managerId === id) managerId = null;
    effectiveManager.set(id, managerId);
  }

  const cycleEdgesBroken = [];
  for (const startId of effectiveManager.keys()) {
    const seen = new Set();
    let prev = null;
    let cur = startId;
    while (cur) {
      if (seen.has(cur)) {
        if (prev && effectiveManager.get(prev) === cur) {
          effectiveManager.set(prev, null);
          cycleEdgesBroken.push({ from: prev, to: cur });
        }
        break;
      }
      seen.add(cur);
      prev = cur;
      cur = effectiveManager.get(cur) || null;
    }
  }

  /** @type {Map<string, string[]>} */
  const childrenByManagerId = new Map();
  for (const [id, managerId] of effectiveManager.entries()) {
    if (!managerId) continue;
    if (!childrenByManagerId.has(managerId)) childrenByManagerId.set(managerId, []);
    childrenByManagerId.get(managerId).push(id);
  }

  for (const [managerId, childIds] of childrenByManagerId.entries()) {
    childIds.sort((a, b) => {
      const na = byId.get(a)?.fullName || "";
      const nb = byId.get(b)?.fullName || "";
      return na.localeCompare(nb, undefined, { sensitivity: "base" });
    });
    childrenByManagerId.set(managerId, childIds);
  }

  const employees = list.map((doc) => {
    const id = String(doc._id);
    const childIds = childrenByManagerId.get(id) || [];
    const rawManager = doc.job?.reportingManagerId ? String(doc.job.reportingManagerId) : null;
    const treeManager = effectiveManager.get(id) || null;
    return {
      ...docToNodeFields(doc),
      reportingManagerId: rawManager,
      treeManagerId: treeManager,
      directReportCount: childIds.length,
      childIds,
    };
  });

  const rootIds = employees.filter((e) => !e.treeManagerId).map((e) => e.id);
  const unassignedIds = employees
    .filter((e) => !e.treeManagerId && e.directReportCount === 0)
    .map((e) => e.id);
  const hierarchyRootIds = employees
    .filter((e) => !e.treeManagerId && e.directReportCount > 0)
    .map((e) => e.id);

  return {
    employees,
    rootIds,
    hierarchyRootIds,
    unassignedIds,
    childrenByManagerId: Object.fromEntries(childrenByManagerId),
    meta: {
      total: employees.length,
      withManager: employees.filter((e) => Boolean(e.reportingManagerId)).length,
      withoutManager: employees.filter((e) => !e.reportingManagerId).length,
      hierarchyRoots: hierarchyRootIds.length,
      unassigned: unassignedIds.length,
      cycleEdgesBroken: cycleEdgesBroken.length,
      statusFilter: options.statusFilterLabel || "ACTIVE",
    },
  };
}

/**
 * Full-company (or scoped) org chart — legacy complete payload.
 *
 * @param {import("mongoose").Model} Employee
 * @param {{ status?: string, hrAccess?: object, employeeIds?: string[] }} [options]
 */
export async function buildOrganizationHierarchy(Employee, options = {}) {
  let statusFilter = buildOrganizationStatusFilter(
    options.status === "ALL"
      ? "ALL"
      : options.status === EMPLOYEE_STATUSES.INACTIVE
        ? EMPLOYEE_STATUSES.INACTIVE
        : EMPLOYEE_STATUSES.ACTIVE
  );

  statusFilter = await applyHrScope(statusFilter, options.hrAccess);

  if (Array.isArray(options.employeeIds)) {
    const oids = options.employeeIds
      .filter((id) => isStrictObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    statusFilter = {
      $and: [statusFilter, { _id: { $in: oids } }],
    };
  }

  const docs = await Employee.find(statusFilter)
    .select(ORG_SELECT)
    .sort({ fullName: 1 })
    .lean();

  return buildOrganizationHierarchyFromDocs(docs, {
    statusFilterLabel: statusFilter.status || "ALL",
  });
}

function serializeLazyNode(doc, { treeManagerId, directReportCount }) {
  return {
    ...docToNodeFields(doc),
    treeManagerId: treeManagerId ?? null,
    directReportCount: Number(directReportCount) || 0,
    // Lazy mode: children are fetched on expand — never embed full subtree ids.
    childIds: [],
  };
}

async function countDirectReports(Employee, scopedMatch, managerObjectIds) {
  if (!managerObjectIds.length) return new Map();
  const rows = await Employee.aggregate([
    {
      $match: {
        $and: [
          scopedMatch,
          { "job.reportingManagerId": { $in: managerObjectIds } },
        ],
      },
    },
    { $group: { _id: "$job.reportingManagerId", count: { $sum: 1 } } },
  ]);
  const map = new Map();
  for (const row of rows) {
    map.set(String(row._id), Number(row.count) || 0);
  }
  return map;
}

/**
 * F48 Phase B — Bounded HR bootstrap: hierarchy roots + counts (not full workforce).
 */
export async function buildOrganizationBootstrap(Employee, options = {}) {
  const statusKey = resolveOrganizationStatusParam(options.status);
  let statusFilter = buildOrganizationStatusFilter(statusKey);
  statusFilter = await applyHrScope(statusFilter, options.hrAccess);

  const noManagerClause = {
    $or: [
      { "job.reportingManagerId": null },
      { "job.reportingManagerId": { $exists: false } },
    ],
  };

  const activeFilter = await applyHrScope(
    { status: EMPLOYEE_STATUSES.ACTIVE },
    options.hrAccess
  );

  const [
    total,
    activeCount,
    withManager,
    withoutManager,
    noManagerDocs,
  ] = await Promise.all([
    Employee.countDocuments(statusFilter),
    Employee.countDocuments(activeFilter),
    Employee.countDocuments({
      $and: [
        statusFilter,
        { "job.reportingManagerId": { $ne: null, $exists: true } },
      ],
    }),
    Employee.countDocuments({ $and: [statusFilter, noManagerClause] }),
    Employee.find({ $and: [statusFilter, noManagerClause] })
      .select(ORG_SELECT)
      .sort({ fullName: 1 })
      .lean(),
  ]);

  const noManagerOids = noManagerDocs.map((d) => d._id);
  const reportCounts = await countDirectReports(Employee, statusFilter, noManagerOids);

  const hierarchyRootDocs = [];
  let unassignedCount = 0;
  for (const doc of noManagerDocs) {
    const id = String(doc._id);
    const count = reportCounts.get(id) || 0;
    if (count > 0) hierarchyRootDocs.push({ doc, count });
    else unassignedCount += 1;
  }

  const employees = hierarchyRootDocs.map(({ doc, count }) =>
    serializeLazyNode(doc, { treeManagerId: null, directReportCount: count })
  );
  const hierarchyRootIds = employees.map((e) => e.id);

  let filterOptions = {
    departments: [],
    jobTitles: [],
    projects: [],
    employmentTypes: [],
    workLocations: [],
  };
  try {
    const { buildEmployeeFilterOptions } = await import("./employeeFilterOptionsService.js");
    filterOptions = await buildEmployeeFilterOptions({
      Employee,
      hrAccess: options.hrAccess || null,
      status: statusKey === "ALL" ? "ALL" : statusKey,
    });
  } catch {
    /* filter options are additive — bootstrap still succeeds */
  }

  const departmentLabels = (filterOptions.departments || [])
    .map((row) => (typeof row === "string" ? row : row?.name))
    .filter(Boolean);

  return {
    mode: "bootstrap",
    lazy: true,
    employees,
    rootIds: hierarchyRootIds,
    hierarchyRootIds,
    // Unassigned people are loaded via children?managerId=none — IDs omitted to bound payload.
    unassignedIds: [],
    childrenByManagerId: {},
    filterOptions: {
      departments: departmentLabels,
      jobTitles: filterOptions.jobTitles || [],
      titles: filterOptions.jobTitles || [],
      employmentTypes: filterOptions.employmentTypes || [],
      workLocations: filterOptions.workLocations || [],
    },
    meta: {
      total,
      active: activeCount,
      withManager,
      withoutManager,
      hierarchyRoots: hierarchyRootIds.length,
      unassigned: unassignedCount,
      cycleEdgesBroken: 0,
      statusFilter: statusKey === "ALL" ? "ALL" : statusKey,
      mode: "bootstrap",
      lazy: true,
    },
  };
}

/**
 * F48 Phase B — Direct reports for a manager, or unassigned pool when managerId=none.
 */
export async function listOrganizationChildren(Employee, options = {}) {
  const statusKey = resolveOrganizationStatusParam(options.status);
  let statusFilter = buildOrganizationStatusFilter(statusKey);
  statusFilter = await applyHrScope(statusFilter, options.hrAccess);

  const rawManager = options.managerId;
  const managerRaw =
    rawManager == null ? "" : typeof rawManager === "string" ? rawManager.trim() : String(rawManager);

  const noneAliases = new Set(["none", "null", "unassigned", ""]);
  const isUnassignedRequest = noneAliases.has(managerRaw.toLowerCase());

  if (!isUnassignedRequest) {
    if (!isStrictObjectId(managerRaw)) {
      throw new HttpError(400, "Invalid manager reference.", {
        field: "managerId",
        code: "INVALID_MANAGER_ID",
      });
    }

    const { assertEmployeeInScope } = await import("./hrAccessEnforcementService.js");
    assertEmployeeInScope(
      options.hrAccess,
      managerRaw,
      "You do not have access to this manager's organization tree."
    );

    const managerExists = await Employee.findOne({
      $and: [statusFilter, { _id: new mongoose.Types.ObjectId(managerRaw) }],
    })
      .select("_id")
      .lean();

    // Manager may be INACTIVE while status=ACTIVE children are requested — allow if in scope.
    if (!managerExists) {
      const anyManager = await Employee.findById(managerRaw).select("_id status").lean();
      if (!anyManager) {
        throw new HttpError(404, "Manager not found.", { code: "MANAGER_NOT_FOUND" });
      }
      assertEmployeeInScope(options.hrAccess, managerRaw);
    }
  }

  let childQuery;
  if (isUnassignedRequest) {
    childQuery = {
      $and: [
        statusFilter,
        {
          $or: [
            { "job.reportingManagerId": null },
            { "job.reportingManagerId": { $exists: false } },
          ],
        },
      ],
    };
  } else {
    childQuery = {
      $and: [
        statusFilter,
        { "job.reportingManagerId": new mongoose.Types.ObjectId(managerRaw) },
      ],
    };
  }

  const docs = await Employee.find(childQuery)
    .select(ORG_SELECT)
    .sort({ fullName: 1 })
    .limit(isUnassignedRequest ? UNASSIGNED_PAGE_LIMIT : 500)
    .lean();

  // Unassigned pool: only people with zero direct reports (true unassigned leaves).
  // Hierarchy roots (no manager but have reports) are bootstrap-only.
  let workingDocs = docs;
  if (isUnassignedRequest) {
    const counts = await countDirectReports(
      Employee,
      statusFilter,
      docs.map((d) => d._id)
    );
    workingDocs = docs.filter((d) => (counts.get(String(d._id)) || 0) === 0);
  }

  const childOids = workingDocs.map((d) => d._id);
  const reportCounts = await countDirectReports(Employee, statusFilter, childOids);

  const treeManagerId = isUnassignedRequest ? null : managerRaw;
  const employees = workingDocs.map((doc) => {
    const id = String(doc._id);
    // Immediate self-cycle guard
    if (!isUnassignedRequest && id === managerRaw) {
      return null;
    }
    return serializeLazyNode(doc, {
      treeManagerId,
      directReportCount: reportCounts.get(id) || 0,
    });
  }).filter(Boolean);

  return {
    mode: "children",
    managerId: isUnassignedRequest ? null : managerRaw,
    unassigned: isUnassignedRequest,
    employees,
    meta: {
      count: employees.length,
      statusFilter: statusKey === "ALL" ? "ALL" : statusKey,
      truncated: isUnassignedRequest && docs.length >= UNASSIGNED_PAGE_LIMIT,
    },
  };
}

/**
 * F48 Phase B — Search org chart; return matches + ancestor nodes for path expansion.
 */
export async function searchOrganizationHierarchy(Employee, options = {}) {
  const statusKey = resolveOrganizationStatusParam(options.status);
  let statusFilter = buildOrganizationStatusFilter(statusKey);
  statusFilter = await applyHrScope(statusFilter, options.hrAccess);

  const rawQ = options.q;
  if (rawQ == null || typeof rawQ !== "string") {
    throw new HttpError(400, "Search query is required.", {
      field: "q",
      code: "INVALID_SEARCH",
    });
  }
  const q = rawQ.trim();
  if (!q) {
    return {
      mode: "search",
      employees: [],
      ancestorIds: [],
      matchIds: [],
      meta: { count: 0, statusFilter: statusKey === "ALL" ? "ALL" : statusKey },
    };
  }
  if (q.length > SEARCH_MAX_LENGTH) {
    throw new HttpError(400, `Search query must be at most ${SEARCH_MAX_LENGTH} characters.`, {
      field: "q",
      code: "SEARCH_TOO_LONG",
    });
  }

  const regex = new RegExp(escapeRegex(q), "i");
  const matches = await Employee.find({
    $and: [
      statusFilter,
      {
        $or: [
          { fullName: regex },
          { preferredName: regex },
          { employeeCode: regex },
          { "job.jobTitle": regex },
          { "job.department": regex },
        ],
      },
    ],
  })
    .select(ORG_SELECT)
    .sort({ fullName: 1 })
    .limit(SEARCH_RESULT_LIMIT)
    .lean();

  /** @type {Set<string>} */
  const ancestorIdSet = new Set();
  /** @type {Map<string, object>} */
  const ancestorDocs = new Map();

  for (const match of matches) {
    const { ancestors } = await walkManagerAncestors(Employee, match._id);
    for (const ancestorId of ancestors) {
      ancestorIdSet.add(String(ancestorId));
    }
  }

  if (ancestorIdSet.size > 0) {
    const ancestorOids = [...ancestorIdSet]
      .filter((id) => isStrictObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const loaded = await Employee.find({
      $and: [statusFilter, { _id: { $in: ancestorOids } }],
    })
      .select(ORG_SELECT)
      .lean();
    for (const doc of loaded) {
      ancestorDocs.set(String(doc._id), doc);
    }
  }

  const allDocs = [...matches];
  for (const [id, doc] of ancestorDocs.entries()) {
    if (!matches.some((m) => String(m._id) === id)) {
      allDocs.push(doc);
    }
  }

  const reportCounts = await countDirectReports(
    Employee,
    statusFilter,
    allDocs.map((d) => d._id)
  );

  const employees = allDocs.map((doc) => {
    const id = String(doc._id);
    const rawManager = doc.job?.reportingManagerId ? String(doc.job.reportingManagerId) : null;
    // Prefer in-set manager for treeManagerId so UI can expand paths.
    let treeManagerId = rawManager && ancestorDocs.has(rawManager) ? rawManager : rawManager;
    if (treeManagerId && !ancestorDocs.has(treeManagerId) && !matches.some((m) => String(m._id) === treeManagerId)) {
      // Manager outside status/scope — treat as root edge for expansion.
      treeManagerId = ancestorDocs.has(id) ? rawManager : rawManager;
    }
    return serializeLazyNode(doc, {
      treeManagerId: rawManager,
      directReportCount: reportCounts.get(id) || 0,
    });
  });

  return {
    mode: "search",
    employees,
    matchIds: matches.map((m) => String(m._id)),
    ancestorIds: [...ancestorIdSet],
    meta: {
      count: matches.length,
      statusFilter: statusKey === "ALL" ? "ALL" : statusKey,
      truncated: matches.length >= SEARCH_RESULT_LIMIT,
    },
  };
}

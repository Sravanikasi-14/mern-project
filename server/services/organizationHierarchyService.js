import { EMPLOYEE_STATUSES } from "../models/Employee.js";

const ORG_SELECT =
  "_id fullName preferredName employeeCode status job.jobTitle job.department job.employmentType job.workLocation job.reportingManagerId";

/**
 * Build a company-scoped org chart payload from Employee.job.reportingManagerId.
 * Flat nodes + child index — clients expand lazily. Cycle edges are broken for
 * rendering only (DB relationships are not mutated).
 *
 * @param {import("mongoose").Model} Employee
 * @param {{ status?: string }} [options]
 */
export async function buildOrganizationHierarchy(Employee, options = {}) {
  let statusFilter =
    options.status === "ALL"
      ? {}
      : options.status === EMPLOYEE_STATUSES.INACTIVE
        ? { status: EMPLOYEE_STATUSES.INACTIVE }
        : { status: EMPLOYEE_STATUSES.ACTIVE };

  if (options.hrAccess) {
    const { mergeEmployeeScopeFilter } = await import("./hrAccessEnforcementService.js");
    statusFilter = mergeEmployeeScopeFilter(options.hrAccess, statusFilter);
  }

  const docs = await Employee.find(statusFilter)
    .select(ORG_SELECT)
    .sort({ fullName: 1 })
    .lean();

  const byId = new Map();
  for (const doc of docs) {
    byId.set(String(doc._id), doc);
  }

  /** @type {Map<string, string|null>} */
  const effectiveManager = new Map();
  for (const doc of docs) {
    const id = String(doc._id);
    let managerId = doc.job?.reportingManagerId ? String(doc.job.reportingManagerId) : null;
    if (managerId && !byId.has(managerId)) managerId = null;
    if (managerId && managerId === id) managerId = null;
    effectiveManager.set(id, managerId);
  }

  // Break cycles for tree rendering: if walking upward revisits a node, clear that edge.
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

  // Stable child order by fullName (already sorted docs, but children may arrive unsorted)
  for (const [managerId, childIds] of childrenByManagerId.entries()) {
    childIds.sort((a, b) => {
      const na = byId.get(a)?.fullName || "";
      const nb = byId.get(b)?.fullName || "";
      return na.localeCompare(nb, undefined, { sensitivity: "base" });
    });
    childrenByManagerId.set(managerId, childIds);
  }

  const employees = docs.map((doc) => {
    const id = String(doc._id);
    const childIds = childrenByManagerId.get(id) || [];
    const rawManager = doc.job?.reportingManagerId ? String(doc.job.reportingManagerId) : null;
    const treeManager = effectiveManager.get(id) || null;
    return {
      id,
      fullName: doc.fullName || "",
      preferredName: doc.preferredName || "",
      employeeCode: doc.employeeCode || "",
      status: doc.status || EMPLOYEE_STATUSES.ACTIVE,
      jobTitle: doc.job?.jobTitle || "",
      department: doc.job?.department || "",
      employmentType: doc.job?.employmentType || "",
      workLocation: doc.job?.workLocation || "",
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
      statusFilter: statusFilter.status || "ALL",
    },
  };
}

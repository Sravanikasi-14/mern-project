import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import {
  assertNoSensitiveLeak,
  resolveVisibleEmployeeAccess,
} from "./employeeVisibilityService.js";
import { walkManagerAncestors } from "./employeeRelationshipService.js";
import { buildOrganizationHierarchy } from "./organizationHierarchyService.js";

/**
 * Approved chart-node fields for employee-facing organization view.
 * Official email and expanded profile fields stay on visible-profile.
 */
const NODE_ALLOWED_KEYS = Object.freeze([
  "id",
  "fullName",
  "employeeCode",
  "jobTitle",
  "department",
  "reportingManagerId",
  "treeManagerId",
  "childIds",
  "directReportCount",
]);

/**
 * Project HR org-hierarchy nodes down to the employee chart allowlist.
 * Reuses cycle-safe tree construction without mutating DB relationships.
 */
export function projectOrganizationViewNodes(hierarchyPayload) {
  const employees = (hierarchyPayload.employees || []).map((node) => {
    const projected = {
      id: node.id,
      fullName: node.fullName || "",
      employeeCode: node.employeeCode || "",
      jobTitle: node.jobTitle || "",
      department: node.department || "",
      reportingManagerId: node.reportingManagerId || null,
      treeManagerId: node.treeManagerId || null,
      childIds: Array.isArray(node.childIds) ? node.childIds : [],
      directReportCount: Number(node.directReportCount) || 0,
    };
    for (const key of Object.keys(projected)) {
      if (!NODE_ALLOWED_KEYS.includes(key)) delete projected[key];
    }
    return projected;
  });

  return {
    employees,
    rootIds: hierarchyPayload.rootIds || [],
    hierarchyRootIds: hierarchyPayload.hierarchyRootIds || [],
    unassignedIds: hierarchyPayload.unassignedIds || [],
    childrenByManagerId: hierarchyPayload.childrenByManagerId || {},
    meta: {
      total: employees.length,
      withManager: employees.filter((e) => Boolean(e.reportingManagerId)).length,
      withoutManager: employees.filter((e) => !e.reportingManagerId).length,
      hierarchyRoots: (hierarchyPayload.hierarchyRootIds || []).length,
      unassigned: (hierarchyPayload.unassignedIds || []).length,
      cycleEdgesBroken: hierarchyPayload.meta?.cycleEdgesBroken || 0,
    },
  };
}

/**
 * Restrict an organization-view payload to hierarchy-visible employees.
 * Prunes child links and rebuilds indexes so unrelated identities never appear.
 */
export function filterOrganizationViewPayload(payload, visibleIds) {
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds || []);
  const employees = (payload.employees || [])
    .filter((node) => visible.has(String(node.id)))
    .map((node) => {
      const childIds = (Array.isArray(node.childIds) ? node.childIds : []).filter((id) =>
        visible.has(String(id))
      );
      let treeManagerId = node.treeManagerId ? String(node.treeManagerId) : null;
      if (treeManagerId && !visible.has(treeManagerId)) treeManagerId = null;
      let reportingManagerId = node.reportingManagerId
        ? String(node.reportingManagerId)
        : null;
      if (reportingManagerId && !visible.has(reportingManagerId)) {
        reportingManagerId = null;
      }
      return {
        ...node,
        id: String(node.id),
        reportingManagerId,
        treeManagerId,
        childIds,
        directReportCount: childIds.length,
      };
    });

  const idSet = new Set(employees.map((e) => e.id));
  /** @type {Record<string, string[]>} */
  const childrenByManagerId = {};
  for (const node of employees) {
    if (!node.treeManagerId || !idSet.has(node.treeManagerId)) continue;
    if (!childrenByManagerId[node.treeManagerId]) {
      childrenByManagerId[node.treeManagerId] = [];
    }
    childrenByManagerId[node.treeManagerId].push(node.id);
  }

  // Match buildOrganizationHierarchy index rules on the filtered set only.
  // Use pruned childIds / directReportCount so invisible reports cannot inflate roots.
  const hierarchyRootIds = employees
    .filter((e) => !e.treeManagerId && e.directReportCount > 0)
    .map((e) => e.id);
  const unassignedIds = employees
    .filter((e) => !e.treeManagerId && e.directReportCount === 0)
    .map((e) => e.id);
  const rootIds = employees.filter((e) => !e.treeManagerId).map((e) => e.id);

  return {
    employees,
    rootIds,
    hierarchyRootIds,
    unassignedIds,
    childrenByManagerId,
    meta: {
      total: employees.length,
      withManager: employees.filter((e) => Boolean(e.reportingManagerId)).length,
      withoutManager: employees.filter((e) => !e.reportingManagerId).length,
      hierarchyRoots: hierarchyRootIds.length,
      unassigned: unassignedIds.length,
      cycleEdgesBroken: payload.meta?.cycleEdgesBroken || 0,
    },
  };
}

/**
 * Active-employee organisation view for authenticated company users.
 * Non-HR viewers receive hierarchy-visible colleagues in BOTH directions:
 * ancestor chain (managers above), peers, and descendants (reports below).
 * HR_ADMIN receives the full ACTIVE chart (People Management unchanged via
 * GET /employees/organization).
 */
export async function buildEmployeeOrganizationView(Employee, user, options = {}) {
  const hierarchy = await buildOrganizationHierarchy(Employee, {
    status: EMPLOYEE_STATUSES.ACTIVE,
    hrAccess: options.hrAccess || null,
  });
  let payload = projectOrganizationViewNodes(hierarchy);

  if (user?.role !== USER_ROLES.HR_ADMIN) {
    const targets = (hierarchy.employees || []).map((node) => ({
      _id: node.id,
      job: { reportingManagerId: node.reportingManagerId || null },
    }));
    const access = await resolveVisibleEmployeeAccess({
      Employee,
      user,
      employees: targets,
    });

    const visibleIds = new Set(access.visibleIds);
    const hierarchyIdSet = new Set((hierarchy.employees || []).map((node) => String(node.id)));
    const viewerId = access.viewer?._id ? String(access.viewer._id) : null;

    // Explicitly keep the viewer's reporting ancestor chain so the chart can
    // render from the highest visible ancestor down to self + descendants.
    // Only ACTIVE company-scoped hierarchy members are added (no inactive /
    // cross-tenant IDs, no unrelated branches).
    if (viewerId) {
      visibleIds.add(viewerId);
      const { ancestors } = await walkManagerAncestors(Employee, viewerId);
      for (const ancestorId of ancestors) {
        const id = String(ancestorId);
        if (hierarchyIdSet.has(id)) visibleIds.add(id);
      }
    }

    payload = filterOrganizationViewPayload(payload, visibleIds);
    payload.meta = {
      ...payload.meta,
      viewerEmployeeId: viewerId,
    };
  } else {
    payload.meta = {
      ...payload.meta,
      viewerEmployeeId: null,
    };
  }

  assertNoSensitiveLeak(payload);
  return payload;
}

export { NODE_ALLOWED_KEYS };

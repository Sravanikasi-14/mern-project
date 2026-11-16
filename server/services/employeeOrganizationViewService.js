import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { assertNoSensitiveLeak } from "./employeeVisibilityService.js";
import {
  collectHierarchyVisibleEmployeeIds,
  resolveViewerEmployee,
} from "./employeeRelationshipService.js";
import {
  ORG_SELECT,
  buildOrganizationBootstrap,
  buildOrganizationHierarchy,
  buildOrganizationHierarchyFromDocs,
} from "./organizationHierarchyService.js";
import { isStrictObjectId } from "./reportingManagerService.js";

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
 * F48 Phase A: EMPLOYEE path loads only hierarchy-visible IDs (F47 collector),
 * then builds the tree from that subset — never a full-company fetch first.
 * F48 residual: HR defaults to lazy bootstrap (roots only). Pass mode=full|legacy
 * for the complete ACTIVE chart (compat / tests). HR UI should use
 * /employees/organization[+children|search] instead of this endpoint.
 */
export async function buildEmployeeOrganizationView(Employee, user, options = {}) {
  if (isHrPortalOperator(user?.role) || user?.role === USER_ROLES.HR_ADMIN) {
    const modeRaw = typeof options.mode === "string" ? options.mode.trim().toLowerCase() : "";
    const legacyFull = modeRaw === "full" || modeRaw === "legacy";

    if (legacyFull) {
      const hierarchy = await buildOrganizationHierarchy(Employee, {
        status: EMPLOYEE_STATUSES.ACTIVE,
        hrAccess: options.hrAccess || null,
      });
      const payload = projectOrganizationViewNodes(hierarchy);
      payload.meta = {
        ...payload.meta,
        viewerEmployeeId: null,
        mode: "full",
        lazy: false,
      };
      assertNoSensitiveLeak(payload);
      return payload;
    }

    const bootstrap = await buildOrganizationBootstrap(Employee, {
      status: EMPLOYEE_STATUSES.ACTIVE,
      hrAccess: options.hrAccess || null,
    });
    const payload = projectOrganizationViewNodes(bootstrap);
    payload.meta = {
      ...payload.meta,
      // Prefer company-wide totals from bootstrap (not just roots in payload.employees).
      total: bootstrap.meta?.total ?? payload.meta.total,
      withManager: bootstrap.meta?.withManager ?? payload.meta.withManager,
      withoutManager: bootstrap.meta?.withoutManager ?? payload.meta.withoutManager,
      hierarchyRoots: bootstrap.meta?.hierarchyRoots ?? payload.meta.hierarchyRoots,
      unassigned: bootstrap.meta?.unassigned ?? payload.meta.unassigned,
      viewerEmployeeId: null,
      mode: "bootstrap",
      lazy: true,
    };
    assertNoSensitiveLeak(payload);
    return payload;
  }

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
  const visibleOids = [...visibleIds]
    .filter((id) => isStrictObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const docs = await Employee.find({
    status: EMPLOYEE_STATUSES.ACTIVE,
    _id: { $in: visibleOids },
  })
    .select(ORG_SELECT)
    .sort({ fullName: 1 })
    .lean();

  const hierarchy = buildOrganizationHierarchyFromDocs(docs, {
    statusFilterLabel: EMPLOYEE_STATUSES.ACTIVE,
  });
  const payload = projectOrganizationViewNodes(hierarchy);
  payload.meta = {
    ...payload.meta,
    viewerEmployeeId: String(viewer._id),
  };

  assertNoSensitiveLeak(payload);
  return payload;
}

export { NODE_ALLOWED_KEYS };

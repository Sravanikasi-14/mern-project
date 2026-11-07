import mongoose from "mongoose";
import { isStrictObjectId } from "./reportingManagerService.js";
import { HttpError } from "../utils/httpError.js";

/** Keep aligned with reportingManagerService hierarchy walk bound. */
export const MAX_RELATIONSHIP_WALK = 64;

export const EMPLOYEE_RELATIONSHIPS = Object.freeze({
  SELF: "SELF",
  DIRECT_MANAGER: "DIRECT_MANAGER",
  INDIRECT_MANAGER: "INDIRECT_MANAGER",
  DIRECT_REPORT: "DIRECT_REPORT",
  INDIRECT_REPORT: "INDIRECT_REPORT",
  PEER: "PEER",
  OTHER: "OTHER",
  /**
   * Hierarchy walk hit the depth ceiling before the relationship could be
   * proven. Must not be treated as PEER/OTHER. Visibility uses DIRECTORY tier.
   */
  UNRESOLVED: "UNRESOLVED",
});

/**
 * Relationships that non-HR employees may discover / open under hierarchy
 * visibility rules. OTHER and UNRESOLVED are excluded.
 */
export const HIERARCHY_VISIBLE_RELATIONSHIPS = Object.freeze([
  EMPLOYEE_RELATIONSHIPS.SELF,
  EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER,
  EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER,
  EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT,
  EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT,
  EMPLOYEE_RELATIONSHIPS.PEER,
]);

const HIERARCHY_VISIBLE_SET = new Set(HIERARCHY_VISIBLE_RELATIONSHIPS);

export function isHierarchyVisibleRelationship(relationship) {
  return HIERARCHY_VISIBLE_SET.has(relationship);
}

const CHAIN_SELECT = "_id job.reportingManagerId";

function toIdString(value) {
  if (value == null) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

/**
 * Resolve the authenticated user's Employee document in the current tenant DB.
 */
export async function resolveViewerEmployee(Employee, user) {
  if (!user) return null;

  if (user.employeeId && isStrictObjectId(user.employeeId)) {
    const linked = await Employee.findById(user.employeeId).select(CHAIN_SELECT).lean();
    if (linked) return linked;
  }

  return Employee.findOne({
    $or: [{ userId: user._id }, { email: user.email }],
  })
    .select(CHAIN_SELECT)
    .lean();
}

/**
 * Walk upward via job.reportingManagerId.
 * Returns ordered ancestor ids (immediate manager first).
 * Stops on missing refs, cycles, or depth limit.
 */
export async function walkManagerAncestors(Employee, startEmployeeId, options = {}) {
  const maxDepth = options.maxDepth ?? MAX_RELATIONSHIP_WALK;
  const ancestors = [];
  const visited = new Set([String(startEmployeeId)]);
  let current = startEmployeeId;
  let depthExceeded = false;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const node = await Employee.findById(current).select(CHAIN_SELECT).lean();
    if (!node) break;

    const managerId = toIdString(node.job?.reportingManagerId);
    if (!managerId) break;
    if (!isStrictObjectId(managerId)) break;
    if (visited.has(managerId)) break; // cycle — stop without looping

    // Only follow managers that exist in this tenant collection.
    const manager = await Employee.findById(managerId).select(CHAIN_SELECT).lean();
    if (!manager) break;

    ancestors.push(managerId);
    visited.add(managerId);
    current = managerId;

    if (depth === maxDepth - 1) {
      const nextManagerId = toIdString(manager.job?.reportingManagerId);
      if (nextManagerId && isStrictObjectId(nextManagerId) && !visited.has(nextManagerId)) {
        const tipExists = await Employee.exists({
          _id: new mongoose.Types.ObjectId(nextManagerId),
        });
        if (tipExists) depthExceeded = true;
      }
    }
  }

  return { ancestors, depthExceeded, visited };
}

/**
 * Batch upward walks for many start ids.
 * Uses shared $in fetches per depth level instead of per-employee N+1 walks.
 *
 * @returns {Map<string, { ancestors: string[], depthExceeded: boolean }>}
 */
export async function batchWalkManagerAncestors(Employee, startEmployeeIds, options = {}) {
  const maxDepth = options.maxDepth ?? MAX_RELATIONSHIP_WALK;
  const starts = [
    ...new Set(
      (startEmployeeIds || [])
        .map((id) => String(id))
        .filter((id) => isStrictObjectId(id))
    ),
  ];

  /** @type {Map<string, { ancestors: string[], depthExceeded: boolean }>} */
  const results = new Map();
  if (starts.length === 0) return results;

  /** @type {Map<string, string|null>} employeeId -> managerId */
  const managerOf = new Map();
  /** @type {Set<string>} ids confirmed missing in tenant */
  const missing = new Set();

  async function ensureLoaded(ids) {
    const need = ids.filter(
      (id) => isStrictObjectId(id) && !managerOf.has(id) && !missing.has(id)
    );
    if (need.length === 0) return;
    const docs = await Employee.find({
      _id: { $in: need.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select(CHAIN_SELECT)
      .lean();

    const found = new Set();
    for (const doc of docs) {
      const id = String(doc._id);
      found.add(id);
      managerOf.set(id, toIdString(doc.job?.reportingManagerId));
    }
    for (const id of need) {
      if (!found.has(id)) missing.add(id);
    }
  }

  await ensureLoaded(starts);

  // Frontier per start: current tip id being walked.
  const state = new Map();
  for (const startId of starts) {
    state.set(startId, {
      ancestors: [],
      depthExceeded: false,
      visited: new Set([startId]),
      current: startId,
      done: missing.has(startId),
    });
  }

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const tipsNeedingManagers = [];
    for (const st of state.values()) {
      if (st.done) continue;
      tipsNeedingManagers.push(st.current);
    }
    if (tipsNeedingManagers.length === 0) break;

    await ensureLoaded(tipsNeedingManagers);

    const nextManagerIds = [];
    for (const st of state.values()) {
      if (st.done) continue;
      if (missing.has(st.current) || !managerOf.has(st.current)) {
        st.done = true;
        continue;
      }
      const managerId = managerOf.get(st.current);
      if (!managerId || !isStrictObjectId(managerId) || st.visited.has(managerId)) {
        st.done = true;
        continue;
      }
      nextManagerIds.push(managerId);
    }

    if (nextManagerIds.length > 0) {
      await ensureLoaded(nextManagerIds);
    }

    for (const st of state.values()) {
      if (st.done) continue;
      const managerId = managerOf.get(st.current);
      if (!managerId || !isStrictObjectId(managerId) || st.visited.has(managerId)) {
        st.done = true;
        continue;
      }
      if (missing.has(managerId) || !managerOf.has(managerId)) {
        st.done = true;
        continue;
      }

      st.ancestors.push(managerId);
      st.visited.add(managerId);
      st.current = managerId;

      if (depth === maxDepth - 1) {
        const nextId = managerOf.get(managerId);
        if (nextId && isStrictObjectId(nextId) && !st.visited.has(nextId)) {
          // Defer existence check — gather below.
          st._checkNext = nextId;
        }
        st.done = true;
      }
    }
  }

  const tipChecks = [];
  for (const [startId, st] of state.entries()) {
    if (st._checkNext) tipChecks.push(st._checkNext);
    results.set(startId, {
      ancestors: st.ancestors,
      depthExceeded: false,
      _checkNext: st._checkNext || null,
    });
  }

  if (tipChecks.length > 0) {
    await ensureLoaded(tipChecks);
    for (const [startId, entry] of results.entries()) {
      const nextId = entry._checkNext;
      if (nextId && managerOf.has(nextId) && !missing.has(nextId)) {
        entry.depthExceeded = true;
      }
      delete entry._checkNext;
      results.set(startId, {
        ancestors: entry.ancestors,
        depthExceeded: entry.depthExceeded,
      });
    }
  } else {
    for (const [startId, entry] of results.entries()) {
      delete entry._checkNext;
      results.set(startId, {
        ancestors: entry.ancestors,
        depthExceeded: false,
      });
    }
  }

  return results;
}

/**
 * Classify a single viewer/target pair using already-loaded walk results.
 */
export function classifyRelationshipFromWalks({
  viewerId,
  targetId,
  viewer,
  target,
  viewerUp,
  targetUp,
}) {
  const vId = String(viewerId);
  const tId = String(targetId);

  if (vId === tId) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.SELF,
      viewerId: vId,
      targetId: tId,
    };
  }

  const managerIndex = viewerUp.ancestors.indexOf(tId);
  if (managerIndex === 0) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER,
      viewerId: vId,
      targetId: tId,
      depthExceeded: viewerUp.depthExceeded,
    };
  }
  if (managerIndex > 0) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER,
      viewerId: vId,
      targetId: tId,
      depthExceeded: viewerUp.depthExceeded,
    };
  }

  const reportIndex = targetUp.ancestors.indexOf(vId);
  if (reportIndex === 0) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT,
      viewerId: vId,
      targetId: tId,
      depthExceeded: targetUp.depthExceeded,
    };
  }
  if (reportIndex > 0) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.INDIRECT_REPORT,
      viewerId: vId,
      targetId: tId,
      depthExceeded: targetUp.depthExceeded,
    };
  }

  const viewerManagerId = toIdString(viewer?.job?.reportingManagerId);
  const targetManagerId = toIdString(target?.job?.reportingManagerId);
  if (
    viewerManagerId &&
    targetManagerId &&
    isStrictObjectId(viewerManagerId) &&
    isStrictObjectId(targetManagerId) &&
    viewerManagerId === targetManagerId
  ) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.PEER,
      viewerId: vId,
      targetId: tId,
    };
  }

  // Incomplete walks must not silently become OTHER (or PEER above only when proven).
  if (viewerUp.depthExceeded || targetUp.depthExceeded) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.UNRESOLVED,
      viewerId: vId,
      targetId: tId,
      depthExceeded: true,
    };
  }

  return {
    relationship: EMPLOYEE_RELATIONSHIPS.OTHER,
    viewerId: vId,
    targetId: tId,
  };
}

/**
 * Classify relationship between viewer and target using reportingManagerId only.
 */
export async function resolveEmployeeRelationship({
  Employee,
  viewerEmployeeId,
  targetEmployeeId,
}) {
  if (!isStrictObjectId(viewerEmployeeId) || !isStrictObjectId(targetEmployeeId)) {
    throw new HttpError(400, "Invalid employee reference.", {
      code: "INVALID_EMPLOYEE_ID",
    });
  }

  const viewerId = String(viewerEmployeeId);
  const targetId = String(targetEmployeeId);

  if (viewerId === targetId) {
    return {
      relationship: EMPLOYEE_RELATIONSHIPS.SELF,
      viewerId,
      targetId,
    };
  }

  const [viewer, target] = await Promise.all([
    Employee.findById(viewerId).select(CHAIN_SELECT).lean(),
    Employee.findById(targetId).select(CHAIN_SELECT).lean(),
  ]);

  if (!viewer || !target) {
    throw new HttpError(404, "Employee not found", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }

  const walks = await batchWalkManagerAncestors(Employee, [viewerId, targetId]);
  const viewerUp = walks.get(viewerId) || { ancestors: [], depthExceeded: false };
  const targetUp = walks.get(targetId) || { ancestors: [], depthExceeded: false };

  return classifyRelationshipFromWalks({
    viewerId,
    targetId,
    viewer,
    target,
    viewerUp,
    targetUp,
  });
}

/**
 * Batch-classify many targets against one viewer (directory page optimization).
 * Viewer ancestor chain is walked once; remaining targets share batched walks.
 *
 * @returns {Promise<Map<string, { relationship: string, viewerId: string, targetId: string, depthExceeded?: boolean }>>}
 */
export async function resolveRelationshipsForTargets({
  Employee,
  viewerEmployeeId,
  targets,
}) {
  if (!isStrictObjectId(viewerEmployeeId)) {
    throw new HttpError(400, "Invalid employee reference.", {
      code: "INVALID_EMPLOYEE_ID",
    });
  }

  const viewerId = String(viewerEmployeeId);
  const viewer = await Employee.findById(viewerId).select(CHAIN_SELECT).lean();
  if (!viewer) {
    throw new HttpError(404, "Employee not found", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }

  const targetList = (targets || []).filter((t) => t && t._id);
  /** @type {Map<string, object>} */
  const out = new Map();

  if (targetList.length === 0) return out;

  const viewerUpMap = await batchWalkManagerAncestors(Employee, [viewerId]);
  const viewerUp = viewerUpMap.get(viewerId) || { ancestors: [], depthExceeded: false };
  const viewerAncestorSet = new Set(viewerUp.ancestors);

  const needsTargetWalk = [];

  for (const target of targetList) {
    const targetId = String(target._id);
    if (targetId === viewerId) {
      out.set(targetId, {
        relationship: EMPLOYEE_RELATIONSHIPS.SELF,
        viewerId,
        targetId,
      });
      continue;
    }

    if (viewerUp.ancestors[0] === targetId) {
      out.set(targetId, {
        relationship: EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER,
        viewerId,
        targetId,
        depthExceeded: viewerUp.depthExceeded,
      });
      continue;
    }
    if (viewerAncestorSet.has(targetId)) {
      out.set(targetId, {
        relationship: EMPLOYEE_RELATIONSHIPS.INDIRECT_MANAGER,
        viewerId,
        targetId,
        depthExceeded: viewerUp.depthExceeded,
      });
      continue;
    }

    const targetManagerId = toIdString(target.job?.reportingManagerId);
    if (targetManagerId && targetManagerId === viewerId) {
      out.set(targetId, {
        relationship: EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT,
        viewerId,
        targetId,
      });
      continue;
    }

    needsTargetWalk.push(target);
  }

  if (needsTargetWalk.length === 0) return out;

  const walkIds = needsTargetWalk.map((t) => String(t._id));
  const targetWalks = await batchWalkManagerAncestors(Employee, walkIds);

  for (const target of needsTargetWalk) {
    const targetId = String(target._id);
    const targetUp = targetWalks.get(targetId) || { ancestors: [], depthExceeded: false };
    out.set(
      targetId,
      classifyRelationshipFromWalks({
        viewerId,
        targetId,
        viewer,
        target,
        viewerUp,
        targetUp,
      })
    );
  }

  return out;
}

/**
 * Resolve relationship for an authenticated user against a target employee id
 * in the current tenant Employee collection.
 */
export async function resolveRelationshipForAuthenticatedUser({
  Employee,
  user,
  targetEmployeeId,
}) {
  const viewer = await resolveViewerEmployee(Employee, user);
  if (!viewer) {
    throw new HttpError(403, "No employee profile is linked to this account.", {
      code: "VIEWER_EMPLOYEE_MISSING",
    });
  }

  if (!isStrictObjectId(targetEmployeeId)) {
    throw new HttpError(400, "Invalid employee reference.", {
      code: "INVALID_EMPLOYEE_ID",
    });
  }

  const targetExists = await Employee.exists({
    _id: new mongoose.Types.ObjectId(String(targetEmployeeId)),
  });
  if (!targetExists) {
    throw new HttpError(404, "Employee not found", {
      code: "EMPLOYEE_NOT_FOUND",
    });
  }

  return resolveEmployeeRelationship({
    Employee,
    viewerEmployeeId: viewer._id,
    targetEmployeeId,
  });
}

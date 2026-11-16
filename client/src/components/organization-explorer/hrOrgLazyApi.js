import api from "../../services/api";

/**
 * F48 — Merge lazy org nodes into a by-id map and wire parent.childIds.
 */
export function mergeOrgNodes(prevById, nodes, { parentId = null } = {}) {
  const next = new Map(prevById);
  const ids = [];
  for (const node of nodes || []) {
    if (!node?.id) continue;
    const id = String(node.id);
    ids.push(id);
    const existing = next.get(id) || {};
    next.set(id, {
      ...existing,
      ...node,
      id,
      childIds: Array.isArray(node.childIds)
        ? node.childIds
        : Array.isArray(existing.childIds)
          ? existing.childIds
          : [],
    });
  }
  if (parentId) {
    const parent = next.get(String(parentId));
    if (parent) {
      next.set(String(parentId), {
        ...parent,
        childIds: ids,
        childrenLoaded: true,
      });
    }
  }
  return next;
}

export async function fetchOrgBootstrap({ status = "ALL" } = {}) {
  const res = await api.get("/employees/organization", { params: { status } });
  return res.data;
}

export async function fetchOrgChildren({ managerId, status = "ALL" } = {}) {
  const res = await api.get("/employees/organization/children", {
    params: { managerId: managerId == null ? "none" : managerId, status },
  });
  return res.data;
}

export async function fetchOrgSearch({ q, status = "ALL" } = {}) {
  const res = await api.get("/employees/organization/search", {
    params: { q, status },
  });
  return res.data;
}

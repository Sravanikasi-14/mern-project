import api from "./api";

export async function loadActivePolicy(asOfDate) {
  const res = await api.get("/policies/active", asOfDate ? { params: { asOfDate } } : undefined);
  return res.data?.policy || res.data;
}

/** All CompanyHrPolicy revisions (newest effective date first, as returned by the API). */
export async function loadPolicyHistory() {
  const res = await api.get("/policies/history");
  return Array.isArray(res.data?.policies) ? res.data.policies : [];
}

export async function loadPolicyById(id) {
  const res = await api.get(`/policies/${id}`);
  return res.data?.policy || null;
}

export async function deletePolicyRevision(id) {
  const res = await api.delete(`/policies/${id}`);
  return res.data;
}

/** YYYY-MM-DD for a revision's effectiveFromDate (same convention as the web editor). */
export function revisionDateKey(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

export function todayKey() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Timeline status of a revision: ACTIVE_NOW | FUTURE_SCHEDULED | HISTORICAL | UNKNOWN.
 * Mirrors AdminPolicies.jsx currentRevisionStatus.
 */
export function revisionStatus(revision, revisions = [], today = todayKey()) {
  const eff = revisionDateKey(revision?.effectiveFromDate);
  if (!eff) return "UNKNOWN";
  if (eff > today) return "FUTURE_SCHEDULED";
  const newer = revisions.some((r) => {
    if (r._id === revision._id) return false;
    const d = revisionDateKey(r.effectiveFromDate);
    return d && d <= today && d > eff;
  });
  return newer ? "HISTORICAL" : "ACTIVE_NOW";
}

/** Create a new (e.g. scheduled) revision cloned from `policy`, via POST /policies. */
export async function createPolicyRevision(policy, { effectiveFromDate, notes = "" }) {
  const body = { ...toPayload(policy), effectiveFromDate, notes: String(notes || "").trim() };
  const res = await api.post("/policies", body);
  return res.data?.policy || null;
}

const KEYS = [
  "effectiveFromDate",
  "notes",
  "attendanceRules",
  "workHoursRules",
  "leaveTypes",
  "leaveRules",
  "holidays",
  "weekendRules",
  "locationRules",
  "payrollRules",
  "salaryComponentRules",
  "taxStatutoryRules",
  "lifecycleRules",
  "recruitmentRules",
  "documentRules",
  "generalRules",
  "impactPointRules",
];

function toPayload(policy) {
  const body = {};
  for (const key of KEYS) {
    if (policy?.[key] !== undefined) body[key] = policy[key];
  }
  return body;
}

export async function savePolicy(policy) {
  const id = policy?._id || policy?.id;
  const body = toPayload(policy);
  if (!id) {
    const res = await api.post("/policies", body);
    return res.data?.policy || res.data;
  }
  const res = await api.put(`/policies/${id}`, body);
  return res.data?.policy || policy;
}

export function mergePolicy(base, patch) {
  return {
    ...base,
    ...patch,
    effectiveFromDate: base?.effectiveFromDate,
    notes: base?.notes || "",
  };
}

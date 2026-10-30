import api from "./api";

export async function loadActivePolicy() {
  const res = await api.get("/policies/active");
  return res.data?.policy || res.data;
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

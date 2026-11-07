/**
 * Fields to send for an employee department change.
 * Omitting every field leaves the stored assignment untouched.
 * clearDepartment is the only way to remove one.
 */
export function departmentPayload({
  clearDepartment = false,
  departmentId = "",
  legacyName = "",
  submitLegacy = false,
} = {}) {
  if (clearDepartment) return { clearDepartment: true };
  if (departmentId) return { departmentId: String(departmentId) };
  const legacy = String(legacyName || "").trim();
  if (submitLegacy && legacy) return { department: legacy };
  return {};
}

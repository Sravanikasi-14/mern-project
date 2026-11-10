/** Client-side mirror of HR portal authorization. Backend checks remain mandatory. */

export function isHrPortalRole(role) {
  return role === "HR_ADMIN" || role === "COMPANY_ADMIN";
}

/**
 * Company Admin is company-wide. HR Admin is unrestricted while enforcement is OFF
 * and limited to the saved allow-list when enforcement is ENFORCED.
 */
export function hrPortalAllows(user, company, permission) {
  if (!user || !permission) return false;
  if (user.role === "COMPANY_ADMIN") return true;
  if (user.role !== "HR_ADMIN") return false;
  if (company?.hrAccessEnforcement?.mode !== "ENFORCED") return true;
  const permissions = Array.isArray(user.hrAccess?.permissions) ? user.hrAccess.permissions : [];
  return permissions.includes(permission);
}

export function hrPortalAllowsAny(user, company, permissions = []) {
  return permissions.some((permission) => hrPortalAllows(user, company, permission));
}

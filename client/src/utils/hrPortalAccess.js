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

/**
 * Company Admin order. HR Management is company-admin only.
 * Work Management uses people.view because the catalog has no separate work permission.
 */
export const HR_PORTAL_MODULES = Object.freeze([
  { id: "dashboard", label: "Dashboard", path: "/admin/dashboard", permission: "dashboard.view" },
  { id: "hr-management", label: "HR Management", path: "/admin/hr-management", companyAdminOnly: true },
  { id: "people", label: "Employees", path: "/admin", permission: "people.view" },
  { id: "attendance", label: "Attendance", path: "/admin/attendance", permission: "attendance.view" },
  { id: "live-tracking", label: "Live Tracking", path: "/admin/live-tracking", permission: "attendance.view" },
  { id: "leave", label: "Leave", path: "/admin/leave", permission: "leave.view" },
  { id: "payroll", label: "Payroll", path: "/admin/payroll", permission: "payroll.view" },
  { id: "settlements", label: "Settlements", path: "/admin/payroll?tab=ff_settlements", permission: "settlements.view" },
  { id: "hiring", label: "Hiring & Onboarding", path: "/admin/hiring", permission: "hiring.view" },
  { id: "assets", label: "Assets", path: "/admin/assets", permission: "assets.view" },
  { id: "organization", label: "Organization", path: "/admin/organization", permission: "organization.view" },
  {
    id: "policies-settings",
    label: "Policies & Settings",
    path: "/admin/policies",
    permissions: ["policies.view", "settings.view"],
  },
  { id: "reports", label: "AI Reports", path: "/admin/reports", permission: "reports.view" },
  { id: "impact-points", label: "Impact Points", path: "/admin/impact-points", permission: "impact.view" },
  { id: "work", label: "Work", path: "/admin/work-management", permission: "people.view" },
]);

export function isHrModuleVisible(user, company, module) {
  if (!user || !module) return false;
  if (module.companyAdminOnly) return user.role === "COMPANY_ADMIN";
  if (user.role !== "HR_ADMIN" && user.role !== "COMPANY_ADMIN") return false;
  if (Array.isArray(module.permissions) && module.permissions.length) {
    return hrPortalAllowsAny(user, company, module.permissions);
  }
  if (!module.permission) return true;
  return hrPortalAllows(user, company, module.permission);
}

/** Policies and Account & Workspace share one nav entry. Open the first permitted tab. */
export function policiesSettingsPath(user, company) {
  if (hrPortalAllows(user, company, "policies.view")) return "/admin/policies";
  if (hrPortalAllows(user, company, "settings.view")) return "/admin/settings";
  return "/admin/policies";
}

export function visibleHrPortalModules(user, company) {
  return HR_PORTAL_MODULES.filter((module) => isHrModuleVisible(user, company, module)).map((module) => {
    if (module.id !== "policies-settings") return module;
    return { ...module, path: policiesSettingsPath(user, company) };
  });
}

export function isSettlementsLocation(pathname, search = "") {
  if (pathname !== "/admin/payroll") return false;
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return params.get("tab") === "ff_settlements" || Boolean(params.get("settlementId"));
}

/** Catalog permission required to open this HR portal URL. Null means no module permission applies. */
export function permissionForAdminPath(pathname = "", search = "") {
  const path = String(pathname || "");
  if (path === "/admin/hr-management" || path.startsWith("/admin/hr-management/")) return null;
  if (path === "/admin/messages" || path.startsWith("/admin/messages/")) return null;
  if (/^\/admin\/employees\/[^/]+\/edit\/?$/.test(path)) return "people.edit";
  if (path === "/admin" || path.startsWith("/admin/employees")) return "people.view";
  if (path.startsWith("/admin/payroll")) {
    return isSettlementsLocation(path, search) ? "settlements.view" : "payroll.view";
  }
  if (path.startsWith("/admin/attendance") || path.startsWith("/admin/live-tracking")) return "attendance.view";
  if (path.startsWith("/admin/leave")) return "leave.view";
  if (path.startsWith("/admin/hiring") || path.startsWith("/admin/offers") || path.startsWith("/admin/onboarding")) {
    return "hiring.view";
  }
  if (path.startsWith("/admin/assets")) return "assets.view";
  if (path.startsWith("/admin/organization")) return "organization.view";
  if (path.startsWith("/admin/policies")) return "policies.view";
  if (path.startsWith("/admin/reports")) return "reports.view";
  if (path.startsWith("/admin/settings")) return "settings.view";
  if (path.startsWith("/admin/impact-points")) return "impact.view";
  if (path.startsWith("/admin/work-management") || path.startsWith("/admin/work-impact")) return "people.view";
  if (path === "/admin/dashboard" || path.startsWith("/admin/dashboard/")) return "dashboard.view";
  return null;
}

export function adminLocationAllowed(user, company, pathname, search = "") {
  if (user?.role === "COMPANY_ADMIN") return true;
  if (user?.role !== "HR_ADMIN") return false;
  if (pathname === "/admin/hr-management" || String(pathname).startsWith("/admin/hr-management/")) return false;
  const permission = permissionForAdminPath(pathname, search);
  if (!permission) return true;
  return hrPortalAllows(user, company, permission);
}

/**
 * When a payroll or policies workspace tab is blocked, stay in that workspace
 * on the first permitted tab instead of leaving for another module.
 */
export function preferredWorkspacePath(user, company, pathname = "", search = "") {
  const path = String(pathname || "");
  const query = String(search || "");
  if (adminLocationAllowed(user, company, path, query)) return null;
  if (path === "/admin/payroll" || path.startsWith("/admin/payroll/")) {
    if (hrPortalAllows(user, company, "payroll.view")) return "/admin/payroll";
    if (hrPortalAllows(user, company, "settlements.view")) return "/admin/payroll?tab=ff_settlements";
    return null;
  }
  if (path.startsWith("/admin/policies") || path.startsWith("/admin/settings")) {
    if (hrPortalAllows(user, company, "policies.view")) return "/admin/policies";
    if (hrPortalAllows(user, company, "settings.view")) return "/admin/settings";
  }
  return null;
}

/** First module this user may open, excluding the current URL. */
export function firstAccessibleHrPath(user, company, currentPath = "") {
  const current = String(currentPath || "");
  const queryIndex = current.indexOf("?");
  const pathname = queryIndex === -1 ? current : current.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : current.slice(queryIndex);
  const sibling = preferredWorkspacePath(user, company, pathname, search);
  if (sibling && sibling !== current) return sibling;
  const match = visibleHrPortalModules(user, company).find((module) => module.path !== current);
  return match?.path || null;
}

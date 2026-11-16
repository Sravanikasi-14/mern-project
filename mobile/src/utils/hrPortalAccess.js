/** Client-side mirror of HR portal authorization. Backend checks remain mandatory. */

export function isHrPortalRole(role) {
  return role === "HR_ADMIN" || role === "COMPANY_ADMIN";
}

/** Map portal nav module id → platform entitlement module key. */
const PORTAL_TO_PLATFORM_MODULE = Object.freeze({
  dashboard: "dashboard",
  people: "people",
  attendance: "attendance",
  live: "liveTracking",
  "live-tracking": "liveTracking",
  leave: "leave",
  payroll: "payroll",
  payslips: "payroll",
  settlements: "settlements",
  hiring: "hiring",
  assets: "assets",
  organization: "organization",
  policies: "policies",
  company: "settings",
  settings: "settings",
  reports: "reports",
  impact: "impact",
  "impact-points": "impact",
  work: "work",
  tasks: "work",
  messages: "chat",
  documents: "people",
});

/**
 * Platform entitlements from /auth/me. Missing snapshot fails closed for gated modules.
 */
export function platformModuleAllowed(company, platformModuleKey) {
  if (!platformModuleKey) return true;
  const modules = company?.entitlements?.modules;
  if (!modules || typeof modules !== "object") return false;
  return modules[platformModuleKey] === true;
}

export function platformCapabilityAllowed(company, capabilityKey) {
  if (!capabilityKey) return true;
  const caps = company?.entitlements?.capabilities;
  if (!caps || typeof caps !== "object") return false;
  return caps[capabilityKey] === true;
}

/**
 * Company Admin is company-wide. HR Admin is unrestricted while enforcement is OFF
 * and limited to the saved allow-list when enforcement is ENFORCED.
 * Platform entitlements always apply on top.
 */
export function hrPortalAllows(user, company, permission) {
  if (!user || !permission) return false;
  const platformKey =
    permission.startsWith("hiring.send") || permission.startsWith("hiring.withdraw")
      ? "offers"
      : permission.startsWith("hiring.approve")
        ? "onboarding"
        : permission.split(".")[0];
  const mapped =
    platformKey === "announcements"
      ? null
      : PORTAL_TO_PLATFORM_MODULE[platformKey] || platformKey;
  if (mapped && !platformModuleAllowed(company, mapped)) return false;
  if (user.role === "COMPANY_ADMIN") return true;
  if (user.role !== "HR_ADMIN") return false;
  if (company?.hrAccessEnforcement?.mode !== "ENFORCED") return true;
  const permissions = Array.isArray(user.hrAccess?.permissions) ? user.hrAccess.permissions : [];
  return permissions.includes(permission);
}

export function hrPortalAllowsAny(user, company, permissions = []) {
  return permissions.some((permission) => hrPortalAllows(user, company, permission));
}

export function isSettlementsLocation(pathname = "", search = "") {
  const path = String(pathname || "");
  if (path !== "/admin/payroll" && !path.startsWith("/admin/payroll/")) return false;
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return (
    params.get("tab") === "ff_settlements" ||
    params.get("tab") === "settlements" ||
    Boolean(params.get("settlementId"))
  );
}

/**
 * Platform module key for a mobile deep-link path.
 * Null = shell / ungated (home, more, personal settings, company HR admins).
 */
export function platformModuleForPath(pathname = "", search = "") {
  const path = String(pathname || "");

  // Company Admin shell
  if (path === "/company" || path === "/company/") return null;
  if (path.startsWith("/company/hr-admins")) return null;
  if (path.startsWith("/company/organization")) return "organization";
  if (path.startsWith("/company/messages")) return "chat";

  // Employee app
  if (path === "/app" || path === "/app/" || path === "/app/dashboard" || path.startsWith("/app/dashboard/")) {
    return null; // home shell stays reachable
  }
  if (path === "/app/more" || path.startsWith("/app/more/")) return null;
  if (path === "/app/settings" || path.startsWith("/app/settings/")) return null; // personal prefs
  if (path === "/app/profile" || path.startsWith("/app/profile")) return null; // own profile
  if (path.startsWith("/app/documents")) return "people";
  if (path.startsWith("/app/attendance")) return "attendance";
  if (path.startsWith("/app/leave")) return "leave";
  if (path.startsWith("/app/tasks")) return "work";
  // Mobile employee /app/work-impact renders ImpactPage (not Work Management).
  if (path.startsWith("/app/work-impact") || path.startsWith("/app/impact-points")) return "impact";
  if (path.startsWith("/app/payslips")) return "payroll";
  if (path.startsWith("/app/assets")) return "assets";
  if (path.startsWith("/app/policies")) return "policies";
  if (path.startsWith("/app/organization")) return "organization";
  if (path.startsWith("/app/messages")) return "chat";

  // HR Admin portal (mobile paths)
  if (path === "/admin/more" || path.startsWith("/admin/more/")) return null;
  if (path === "/admin/messages" || path.startsWith("/admin/messages/")) return "chat";
  if (/^\/admin\/employees\/[^/]+\/edit\/?$/.test(path)) return "people";
  if (path === "/admin" || path.startsWith("/admin/employees")) return "people";
  if (path.startsWith("/admin/payroll")) {
    return isSettlementsLocation(path, search) ? "settlements" : "payroll";
  }
  // Mobile live tracking is nested under attendance; must not inherit attendance-only gate.
  if (path === "/admin/attendance/live" || path.startsWith("/admin/attendance/live/")) {
    return "liveTracking";
  }
  if (path.startsWith("/admin/live-tracking")) return "liveTracking";
  if (path.startsWith("/admin/attendance")) return "attendance";
  if (path.startsWith("/admin/leave")) return "leave";
  if (
    path.startsWith("/admin/hiring") ||
    path.startsWith("/admin/offers") ||
    path.startsWith("/admin/onboarding")
  ) {
    return "hiring";
  }
  if (path.startsWith("/admin/assets")) return "assets";
  if (path.startsWith("/admin/organization")) return "organization";
  if (path.startsWith("/admin/policies")) return "policies";
  if (path.startsWith("/admin/reports")) return "reports";
  if (path.startsWith("/admin/settings")) return "settings";
  if (path.startsWith("/admin/impact-points")) return "impact";
  if (path.startsWith("/admin/work-management") || path.startsWith("/admin/work-impact")) return "work";
  if (path === "/admin/dashboard" || path.startsWith("/admin/dashboard/")) return "dashboard";

  return null;
}

/** HR catalog permission for admin paths. Null = no HR permission gate. */
export function permissionForAdminPath(pathname = "", search = "") {
  const path = String(pathname || "");
  if (path === "/admin/more" || path.startsWith("/admin/more/")) return null;
  if (path === "/admin/messages" || path.startsWith("/admin/messages/")) return null;
  if (/^\/admin\/employees\/[^/]+\/edit\/?$/.test(path)) return "people.edit";
  if (path === "/admin" || path.startsWith("/admin/employees")) return "people.view";
  if (path.startsWith("/admin/payroll")) {
    return isSettlementsLocation(path, search) ? "settlements.view" : "payroll.view";
  }
  if (path === "/admin/attendance/live" || path.startsWith("/admin/attendance/live/")) {
    return "attendance.view";
  }
  if (path.startsWith("/admin/attendance") || path.startsWith("/admin/live-tracking")) {
    return "attendance.view";
  }
  if (path.startsWith("/admin/leave")) return "leave.view";
  if (
    path.startsWith("/admin/hiring") ||
    path.startsWith("/admin/offers") ||
    path.startsWith("/admin/onboarding")
  ) {
    return "hiring.view";
  }
  if (path.startsWith("/admin/assets")) return "assets.view";
  if (path.startsWith("/admin/organization")) return "organization.view";
  if (path.startsWith("/admin/policies")) return "policies.view";
  if (path.startsWith("/admin/reports")) return "reports.view";
  if (path.startsWith("/admin/settings")) return "settings.view";
  if (path.startsWith("/admin/impact-points")) return "impact.view";
  if (path.startsWith("/admin/work-management") || path.startsWith("/admin/work-impact")) {
    return "people.view";
  }
  if (path === "/admin/dashboard" || path.startsWith("/admin/dashboard/")) return "dashboard.view";
  return null;
}

/**
 * Whether the current user may open this mobile path (entitlements + HR permissions).
 * Employees are gated by platform module only; HR/CA also use permission checks on /admin/*.
 */
export function locationAllowed(user, company, pathname, search = "") {
  if (!user) return false;
  const platformKey = platformModuleForPath(pathname, search);
  if (platformKey && !platformModuleAllowed(company, platformKey)) return false;

  if (user.role === "EMPLOYEE") return true;
  if (user.role === "COMPANY_ADMIN") return true;
  if (user.role !== "HR_ADMIN") return false;

  if (!String(pathname || "").startsWith("/admin")) return true;
  const permission = permissionForAdminPath(pathname, search);
  if (!permission) return true;
  return hrPortalAllows(user, company, permission);
}

/** Safe fallback homes that are not module-gated shells. */
export function homePathForRole(role) {
  if (role === "COMPANY_ADMIN") return "/company";
  if (role === "HR_ADMIN") return "/admin/dashboard";
  return "/app";
}

/**
 * First alternative path when the current deep link is blocked.
 * Prefers role home; for HR, tries dashboard then more.
 */
export function firstAccessiblePath(user, company, currentPath = "") {
  const current = String(currentPath || "");
  const home = homePathForRole(user?.role);
  if (home && home !== current && locationAllowed(user, company, home, "")) return home;
  if (user?.role === "HR_ADMIN") {
    if (locationAllowed(user, company, "/admin/more", "")) return "/admin/more";
  }
  if (user?.role === "EMPLOYEE") {
    if (locationAllowed(user, company, "/app/more", "")) return "/app/more";
  }
  return home;
}

/** Whether a More-menu tile should be shown (module entitlement; HR also needs permission). */
export function moreItemVisible(user, company, item) {
  if (!item?.path) return true;
  const moduleKey =
    item.platformModule ||
    PORTAL_TO_PLATFORM_MODULE[item.id] ||
    platformModuleForPath(item.path, item.search || "");
  if (moduleKey && !platformModuleAllowed(company, moduleKey)) return false;
  if (user?.role === "HR_ADMIN" && item.permission) {
    return hrPortalAllows(user, company, item.permission);
  }
  if (user?.role === "HR_ADMIN" && Array.isArray(item.permissions) && item.permissions.length) {
    return hrPortalAllowsAny(user, company, item.permissions);
  }
  return true;
}

/**
 * Mobile back-navigation helpers.
 */

export function homeForRole(role) {
  if (role === "COMPANY_ADMIN") return "/company";
  if (role === "HR_ADMIN") return "/admin/dashboard";
  if (role === "EMPLOYEE") return "/app";
  return "/login";
}

/**
 * Logical parent for nested mobile routes.
 */
export function resolveMobileFallback(pathname = "", search = "") {
  const path = String(pathname || "");
  const params = new URLSearchParams(search || "");

  if (/^\/admin\/employees\/[^/]+\/edit$/.test(path)) {
    return path.replace(/\/edit$/, "");
  }
  if (/^\/admin\/employees\/[^/]+$/.test(path)) {
    return "/admin";
  }
  if (/^\/admin\/attendance\/live$/.test(path)) {
    return "/admin/attendance";
  }
  if (/^\/admin\/attendance\/[^/]+$/.test(path)) {
    return "/admin/attendance";
  }
  if (/^\/admin\/payroll\/payslips\//.test(path)) {
    return "/admin/payroll";
  }
  if (/^\/admin\/policies\/[^/]+$/.test(path)) {
    return "/admin/policies";
  }
  if (/^\/app\/policies\/[^/]+$/.test(path)) {
    return "/app/policies";
  }
  if (path === "/admin/leave") return "/admin/more";
  if (path === "/admin/settings") return "/admin/more";
  if (path === "/admin/reports") return "/admin/more";
  if (path === "/admin/assets") return "/admin/more";
  if (path === "/admin/organization") return "/admin/more";
  if (path === "/admin/hiring") return "/admin/more";
  if (path === "/admin/hiring/offer-editor" || path.startsWith("/admin/hiring?")) return "/admin/hiring";
  if (path === "/admin/offers") return "/admin/more";
  if (path === "/admin/onboarding") return "/admin/more";
  if (path === "/admin/payroll") return "/admin/more";
  if (path === "/admin/policies") return "/admin/more";
  if (path === "/admin/attendance") return "/admin/more";
  if (path === "/admin/impact-points") return "/admin/more";
  if (path === "/admin/work-management" || path === "/admin/work-impact") return "/admin/more";

  if (path === "/app/leave" && params.get("apply") === "1") return "/app/leave";
  if (path === "/app/profile" && params.get("edit") === "1") return "/app/profile";
  if (path === "/app/leave") return "/app/more";
  if (path === "/app/attendance") return "/app";
  if (path === "/app/profile") return "/app/more";
  if (path === "/app/organization") return "/app/more";
  if (path === "/app/settings") return "/app/more";
  if (path === "/app/assets") return "/app/more";
  if (path === "/app/payslips") return "/app/more";
  if (path === "/app/policies") return "/app/more";
  if (path === "/app/impact-points" || path === "/app/work-impact") return "/app/more";
  if (path === "/app/tasks") return "/app";

  if (path.startsWith("/company")) return "/company";
  if (path.startsWith("/admin/")) return "/admin/dashboard";
  if (path.startsWith("/app/")) return "/app";
  return "/";
}

export function canGoBackInApp(location) {
  try {
    if (typeof window !== "undefined" && window.history.state?.idx != null) {
      return Number(window.history.state.idx) > 0;
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.history.length > 1 && location?.key !== "default") {
    return true;
  }
  return false;
}

export function smartBack(navigate, location, options = {}) {
  const fallback =
    options.fallback ||
    location?.state?.from ||
    resolveMobileFallback(location?.pathname, location?.search);
  const replaceFallback = options.replaceFallback !== false;

  if (canGoBackInApp(location)) {
    navigate(-1);
    return { mode: "pop" };
  }
  navigate(fallback, { replace: replaceFallback });
  return { mode: "fallback", fallback };
}

/** Tab roots — hardware back should not walk endlessly through tab hops. */
export function isTabRootPath(pathname) {
  return [
    "/app",
    "/app/dashboard",
    "/app/more",
    "/admin",
    "/admin/dashboard",
    "/admin/more",
  ].includes(pathname);
}

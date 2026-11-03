/**
 * Desktop back-navigation helpers.
 * Prefer popping in-app history; fall back to a logical parent route.
 */

/** Role-aware home paths */
export function homeForRole(role) {
  if (role === "HR_ADMIN") return "/admin/dashboard";
  if (role === "EMPLOYEE") return "/app/dashboard";
  return "/login";
}

/**
 * Logical parent for nested desktop routes (direct entry / empty history).
 */
export function resolveDesktopFallback(pathname = "", search = "") {
  const path = String(pathname || "");
  const params = new URLSearchParams(search || "");

  if (/^\/admin\/employees\/[^/]+\/edit$/.test(path)) {
    return path.replace(/\/edit$/, "");
  }
  if (/^\/admin\/employees\/[^/]+$/.test(path)) {
    return "/admin";
  }
  if (path === "/admin/payroll" && params.get("settlementId")) {
    return "/admin/payroll?tab=ff_settlements";
  }
  if (path.startsWith("/admin/")) {
    if (path === "/admin" || path === "/admin/dashboard") return "/admin/dashboard";
    return "/admin/dashboard";
  }
  if (path.startsWith("/app/")) {
    if (path === "/app" || path === "/app/dashboard") return "/app/dashboard";
    return "/app/dashboard";
  }
  return "/";
}

/**
 * True when React Router has a previous in-app entry we can pop.
 * Works for data and browser routers that set location.key / history.state.idx.
 */
export function canGoBackInApp(location) {
  if (!location) return false;
  if (location.key && location.key !== "default") {
    // If the user landed via a fresh load, key is often "default".
    // When they have navigated within the SPA, key is a random string.
    // Still allow history.length check as a secondary signal.
  }
  try {
    if (typeof window !== "undefined" && window.history.state?.idx != null) {
      return Number(window.history.state.idx) > 0;
    }
  } catch {
    /* ignore */
  }
  // Heuristic: more than one entry and not a cold deep-link with default key
  if (typeof window !== "undefined" && window.history.length > 1 && location.key !== "default") {
    return true;
  }
  return false;
}

/**
 * Navigate back, or replace to fallback.
 * @param {import('react-router-dom').NavigateFunction} navigate
 * @param {import('react-router-dom').Location} location
 * @param {{ fallback?: string, replaceFallback?: boolean }} options
 */
export function smartBack(navigate, location, options = {}) {
  const fallback =
    options.fallback ||
    location?.state?.from ||
    resolveDesktopFallback(location?.pathname, location?.search);
  const replaceFallback = options.replaceFallback !== false;

  if (canGoBackInApp(location)) {
    navigate(-1);
    return { mode: "pop" };
  }
  navigate(fallback, { replace: replaceFallback });
  return { mode: "fallback", fallback };
}

export function getPlatformAuthCookieName() {
  return process.env.PLATFORM_AUTH_COOKIE_NAME || "hrms_platform_auth";
}

function cookieBaseOptions(maxAgeMs = 8 * 60 * 60 * 1000) {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.CLIENT_URL && !process.env.CLIENT_URL.includes("localhost"));

  // Prefer Strict when PLATFORM_COOKIE_SAMESITE=strict (same-site SPA+API).
  // Default remains None in production for split frontend/API hosts, with
  // platformOriginGuard mitigating cookie CSRF from wildcard preview origins.
  const sameSiteEnv = String(process.env.PLATFORM_COOKIE_SAMESITE || "")
    .trim()
    .toLowerCase();
  let sameSite = isProduction ? "none" : "lax";
  if (sameSiteEnv === "strict" || sameSiteEnv === "lax" || sameSiteEnv === "none") {
    sameSite = sameSiteEnv;
  }

  return {
    httpOnly: true,
    secure: isProduction || sameSite === "none",
    sameSite,
    path: "/",
    maxAge: Math.max(60_000, Number(maxAgeMs) || 8 * 60 * 60 * 1000),
  };
}

export function setPlatformAuthCookie(res, token, { maxAgeMs } = {}) {
  res.cookie(getPlatformAuthCookieName(), token, cookieBaseOptions(maxAgeMs));
}

export function clearPlatformAuthCookie(res) {
  res.clearCookie(getPlatformAuthCookieName(), {
    ...cookieBaseOptions(),
    maxAge: 0,
  });
}

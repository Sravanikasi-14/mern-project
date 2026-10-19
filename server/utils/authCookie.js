export function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME || "hrms_auth";
}

export function getAuthCookieOptions() {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.IS_RENDER) ||
    Boolean(process.env.CLIENT_URL && !process.env.CLIENT_URL.includes("localhost")) ||
    Boolean(process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"));

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res, token) {
  res.cookie(getAuthCookieName(), token, getAuthCookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(getAuthCookieName(), {
    ...getAuthCookieOptions(),
    maxAge: 0,
  });
}

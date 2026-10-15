export function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME || "hrms_auth";
}

export function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
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

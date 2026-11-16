import { HttpError } from "../utils/httpError.js";

/**
 * CSRF-style origin check for Platform Admin cookie sessions.
 * Allows requests with no Origin (same-site navigation, server-to-server, curl)
 * and Bearer-authenticated API clients. Rejects credentialed cross-origin
 * browser calls from hosts outside the explicit allowlist.
 */
function allowedOrigins() {
  const origins = new Set([
    "https://mern-project-nu-nine.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ]);
  for (const key of ["CLIENT_URL", "FRONTEND_URL", "PLATFORM_ADMIN_ORIGIN"]) {
    const raw = process.env[key];
    if (raw) origins.add(String(raw).trim().replace(/\/+$/, ""));
  }
  return origins;
}

function isLocalDevHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function platformOriginGuard(req, _res, next) {
  try {
    // Non-browser / same-origin / mobile-style clients often omit Origin.
    const origin = req.get("origin");
    if (!origin) return next();

    // Explicit Bearer auth is not a cookie CSRF vector.
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return next();
    }

    const clean = origin.trim().replace(/\/+$/, "");
    if (allowedOrigins().has(clean)) return next();

    try {
      const url = new URL(clean);
      if (isLocalDevHost(url.hostname)) return next();
    } catch {
      /* fall through */
    }

    // Production preview hosts (*.vercel.app / *.onrender.com) are intentionally
    // NOT accepted here — platform cookie sessions must use an exact allowlisted origin.
    throw new HttpError(403, "Platform origin is not allowed for this request", {
      code: "PLATFORM_ORIGIN_DENIED",
    });
  } catch (err) {
    next(err);
  }
}

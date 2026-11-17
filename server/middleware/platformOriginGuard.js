import { HttpError } from "../utils/httpError.js";
import { isOriginAllowed } from "../utils/corsOrigins.js";

/**
 * CSRF-style origin check for Platform Admin cookie sessions.
 * Allows requests with no Origin (same-site navigation, server-to-server, curl)
 * and Bearer-authenticated API clients. Rejects credentialed cross-origin
 * browser calls from hosts outside the explicit allowlist (F80).
 */
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

    if (isOriginAllowed(origin)) return next();

    throw new HttpError(403, "Platform origin is not allowed for this request", {
      code: "PLATFORM_ORIGIN_DENIED",
    });
  } catch (err) {
    next(err);
  }
}

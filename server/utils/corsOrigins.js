/**
 * F80 — Explicit CORS / platform-origin allowlist.
 * Production uses exact origins only (env + built-in prod frontends).
 * Localhost is allowed automatically outside production.
 */

const BUILTIN_PRODUCTION_ORIGINS = Object.freeze([
  "https://mern-project.vercel.app",
  "https://mern-project-nu-nine.vercel.app",
  "https://mern-project-backend-woad.vercel.app",
  "https://localhost",
]);

const DEV_LOCAL_ORIGINS = Object.freeze([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]);

export function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") return "";
  return origin.trim().replace(/\/+$/, "");
}

function pushEnvOrigin(set, raw) {
  const normalized = normalizeOrigin(raw);
  if (normalized) set.add(normalized);
}

/**
 * Exact allowlist for credentialed browser origins.
 * @returns {Set<string>}
 */
export function getCorsAllowlist() {
  const origins = new Set(BUILTIN_PRODUCTION_ORIGINS);

  for (const key of ["CLIENT_URL", "FRONTEND_URL", "PLATFORM_ADMIN_ORIGIN"]) {
    pushEnvOrigin(origins, process.env[key]);
  }

  const extras = process.env.CORS_ALLOWED_ORIGINS || "";
  for (const part of extras.split(",")) {
    pushEnvOrigin(origins, part);
  }

  if (process.env.NODE_ENV !== "production") {
    for (const origin of DEV_LOCAL_ORIGINS) origins.add(origin);
  }

  return origins;
}

export function isLocalDevHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function isLocalDevOrigin(origin) {
  try {
    const url = new URL(normalizeOrigin(origin));
    return isLocalDevHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string|undefined|null} origin
 * @returns {boolean}
 */
export function isOriginAllowed(origin) {
  // Non-browser / same-origin / mobile / curl often omit Origin.
  if (!origin) return true;

  const clean = normalizeOrigin(origin);
  if (!clean) return false;
  if (getCorsAllowlist().has(clean)) return true;

  // Extra localhost variants in non-production (any port).
  if (process.env.NODE_ENV !== "production" && isLocalDevOrigin(clean)) {
    return true;
  }

  return false;
}

/**
 * cors package origin callback — never throws; rejects with `false`.
 */
export function corsOriginDelegate(origin, callback) {
  if (isOriginAllowed(origin)) {
    return callback(null, true);
  }
  return callback(null, false);
}

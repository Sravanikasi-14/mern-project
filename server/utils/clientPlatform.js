import crypto from "node:crypto";

/**
 * Server-validated client platform helpers.
 *
 * AuthSession.clientPlatform is informational for audit / live-tracking UX.
 * It is NEVER treated as proof of device authenticity for attendance Wi-Fi.
 * Client-reported body/header platform values are never trusted for punch gates.
 *
 * Shared-secret HMAC is DISABLED in production — VITE_* secrets must never ship in APKs.
 * Legacy HMAC is available only when NODE_ENV=test AND ALLOW_LEGACY_NATIVE_HMAC_PROOF=true
 * (automated tests / live-tracking privacy tests).
 */

export const CLIENT_PLATFORMS = Object.freeze({
  WEB: "web",
  ANDROID: "android",
  IOS: "ios",
});

const NATIVE_PLATFORMS = new Set([CLIENT_PLATFORMS.ANDROID, CLIENT_PLATFORMS.IOS]);
const PROOF_MAX_SKEW_MS = 5 * 60 * 1000;

export const CLIENT_PLATFORM_HEADERS = Object.freeze({
  PLATFORM: "x-hrms-client-platform",
  TIMESTAMP: "x-hrms-client-timestamp",
  PROOF: "x-hrms-client-proof",
});

function legacyHmacAllowed() {
  return process.env.NODE_ENV === "test" && process.env.ALLOW_LEGACY_NATIVE_HMAC_PROOF === "true";
}

function getNativeClientSecret() {
  if (!legacyHmacAllowed()) return null;
  const secret = process.env.HRMS_NATIVE_CLIENT_SECRET;
  if (typeof secret === "string" && secret.trim().length >= 16) {
    return secret.trim();
  }
  return null;
}

function normalizePlatform(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === CLIENT_PLATFORMS.ANDROID) return CLIENT_PLATFORMS.ANDROID;
  if (raw === CLIENT_PLATFORMS.IOS) return CLIENT_PLATFORMS.IOS;
  if (raw === CLIENT_PLATFORMS.WEB) return CLIENT_PLATFORMS.WEB;
  return null;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** @deprecated Test-only. Do not use in production clients. */
export function buildNativeClientProof(platform, timestampMs, secret = getNativeClientSecret()) {
  if (!secret) return null;
  const normalized = normalizePlatform(platform);
  if (!normalized || !NATIVE_PLATFORMS.has(normalized)) return null;
  const ts = String(timestampMs);
  return crypto.createHmac("sha256", secret).update(`${normalized}:${ts}`).digest("hex");
}

/**
 * Verify legacy native HMAC proof (test-only).
 * Returns a native platform on success; otherwise null (caller treats as web).
 */
export function verifyNativeClientPlatformFromHeaders(headers = {}) {
  const secret = getNativeClientSecret();
  if (!secret) return null;

  const platform = normalizePlatform(
    headers[CLIENT_PLATFORM_HEADERS.PLATFORM] || headers["X-HRMS-Client-Platform"]
  );
  if (!platform || !NATIVE_PLATFORMS.has(platform)) return null;

  const timestampRaw =
    headers[CLIENT_PLATFORM_HEADERS.TIMESTAMP] || headers["X-HRMS-Client-Timestamp"];
  const proof =
    headers[CLIENT_PLATFORM_HEADERS.PROOF] || headers["X-HRMS-Client-Proof"];

  const timestampMs = Number(timestampRaw);
  if (!Number.isFinite(timestampMs)) return null;
  if (Math.abs(Date.now() - timestampMs) > PROOF_MAX_SKEW_MS) return null;

  const expected = buildNativeClientProof(platform, timestampMs, secret);
  if (!expected || !proof || !timingSafeEqualHex(String(proof).toLowerCase(), expected)) {
    return null;
  }

  return platform;
}

/**
 * Resolve platform for a new AuthSession at login / token issue time.
 * Production always starts as WEB (informational). Test harness may elevate via HMAC.
 */
export function resolveClientPlatformForAuthSession(req) {
  const verified = verifyNativeClientPlatformFromHeaders(req?.headers || {});
  return verified || CLIENT_PLATFORMS.WEB;
}

export function isWebClientPlatform(platform) {
  const normalized = normalizePlatform(platform) || CLIENT_PLATFORMS.WEB;
  return !NATIVE_PLATFORMS.has(normalized);
}

/**
 * Read platform previously bound to the active AuthSession for this token.
 * Defaults to WEB when session is missing or platform unset.
 * Never trusts request body or client-supplied platform headers.
 * Informational only — must not be used as device authenticity proof.
 */
export async function resolveClientPlatformFromAuthSession(models, token) {
  if (!token || !models?.AuthSession) {
    return CLIENT_PLATFORMS.WEB;
  }
  try {
    const session = await models.AuthSession.findOne({ token, isActive: true })
      .select("clientPlatform")
      .lean();
    const normalized = normalizePlatform(session?.clientPlatform);
    return normalized || CLIENT_PLATFORMS.WEB;
  } catch {
    return CLIENT_PLATFORMS.WEB;
  }
}

export function extractRequestAuthToken(req, cookieName = process.env.AUTH_COOKIE_NAME || "hrms_auth") {
  const authHeader = req?.headers?.authorization;
  const headerToken =
    authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
  if (headerToken) return headerToken;
  return req?.cookies?.[cookieName] || null;
}

import crypto from "node:crypto";

/**
 * Server-validated client platform for live-tracking policy (allowWebTracking).
 *
 * Android/native clients prove identity at login with HMAC headers using
 * HRMS_NATIVE_CLIENT_SECRET (never trust body/query platform or User-Agent alone).
 * The verified platform is stored on AuthSession and reused for tracking start.
 *
 * Web builds do not ship the native secret, so they cannot forge ANDROID/IOS.
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

function getNativeClientSecret() {
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

export function buildNativeClientProof(platform, timestampMs, secret = getNativeClientSecret()) {
  if (!secret) return null;
  const normalized = normalizePlatform(platform);
  if (!normalized || !NATIVE_PLATFORMS.has(normalized)) return null;
  const ts = String(timestampMs);
  return crypto.createHmac("sha256", secret).update(`${normalized}:${ts}`).digest("hex");
}

/**
 * Verify native client proof from request headers.
 * Returns a native platform on success; otherwise null (caller should treat as web).
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
 * Unverified or missing native proof → WEB (fail closed for web-tracking bypass).
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
 */
export async function resolveClientPlatformFromAuthSession(models, token) {
  if (!token || !models?.AuthSession) {
    return CLIENT_PLATFORMS.WEB;
  }
  const session = await models.AuthSession.findOne({ token, isActive: true })
    .select("clientPlatform")
    .lean();
  const normalized = normalizePlatform(session?.clientPlatform);
  return normalized || CLIENT_PLATFORMS.WEB;
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

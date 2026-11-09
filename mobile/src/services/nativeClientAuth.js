import { Capacitor } from "@capacitor/core";

/**
 * Builds HMAC proof headers so the backend can bind AuthSession.clientPlatform
 * to android/ios at login. Web builds must not ship HRMS_NATIVE_CLIENT_SECRET.
 *
 * Secret: VITE_HRMS_NATIVE_CLIENT_SECRET (must match server HRMS_NATIVE_CLIENT_SECRET).
 */

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function resolveNativeClientPlatform() {
  if (!Capacitor.isNativePlatform?.()) return null;
  const platform = String(Capacitor.getPlatform?.() || "").toLowerCase();
  if (platform === "android" || platform === "ios") return platform;
  return null;
}

/**
 * @returns {Promise<Record<string, string>>}
 */
export async function buildNativeClientAuthHeaders() {
  const platform = resolveNativeClientPlatform();
  if (!platform) return {};

  const headers = {
    "X-HRMS-Client-Platform": platform,
  };

  const secret = import.meta?.env?.VITE_HRMS_NATIVE_CLIENT_SECRET;
  if (typeof secret !== "string" || secret.trim().length < 16) {
    return headers;
  }

  const timestamp = String(Date.now());
  const proof = await hmacSha256Hex(secret.trim(), `${platform}:${timestamp}`);
  headers["X-HRMS-Client-Timestamp"] = timestamp;
  headers["X-HRMS-Client-Proof"] = proof;
  return headers;
}

import { Capacitor } from "@capacitor/core";

/**
 * Native client helpers (informational platform only).
 *
 * Do NOT embed shared secrets (no VITE_HRMS_NATIVE_CLIENT_SECRET).
 * Client-reported platform is never treated as proof of device authenticity.
 * Wi-Fi attendance uses server-issued single-use challenges + OS-reported evidence.
 */

export function resolveNativeClientPlatform() {
  if (!Capacitor.isNativePlatform?.()) return null;
  const platform = String(Capacitor.getPlatform?.() || "").toLowerCase();
  if (platform === "android" || platform === "ios") return platform;
  return null;
}

/**
 * No APK shared-secret proofs. Returns empty headers.
 * @returns {Promise<Record<string, string>>}
 */
export async function buildNativeClientAuthHeaders() {
  return {};
}

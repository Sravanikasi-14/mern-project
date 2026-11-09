import axios from "axios";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { getApiBaseUrl } from "./api.js";

const SESSION_KEY = "hrms.native.session";

export function isNativeApp() {
  return Boolean(Capacitor.isNativePlatform?.());
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

export async function readNativeSession() {
  if (!isNativeApp() || typeof window === "undefined") return null;
  try {
    const stored = await withTimeout(Preferences.get({ key: SESSION_KEY }));
    const value = stored?.value;
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeNativeSession(session) {
  if (!isNativeApp()) return;
  await Preferences.set({
    key: SESSION_KEY,
    value: JSON.stringify({
      accessToken: session?.accessToken || "",
      refreshToken: session?.refreshToken || "",
      companyId: session?.companyId ? String(session.companyId) : "",
    }),
  });
}

export async function clearNativeSession() {
  if (!isNativeApp()) return;
  try {
    await Preferences.remove({ key: SESSION_KEY });
  } catch {
    // Plugin missing until the native project is synced.
  }
}

/** Copy the durable access token into localStorage before the first API call. */
export async function hydrateAccessToken() {
  const stored = await readNativeSession();
  if (stored?.accessToken && typeof window !== "undefined") {
    localStorage.setItem("hrms_token", stored.accessToken);
  }
  return stored;
}

let refreshLock = null;

/**
 * Exchange a still-valid refresh session for a new access token.
 * Network failures do not wipe the stored session.
 */
export function refreshNativeAccessToken() {
  if (!refreshLock) {
    refreshLock = refreshOnce().finally(() => {
      refreshLock = null;
    });
  }
  return refreshLock;
}

async function refreshOnce() {
  const stored = await readNativeSession();
  if (!stored?.refreshToken || !stored?.companyId) {
    return { ok: false, revoked: false, attempted: false };
  }

  try {
    const response = await axios.post(
      `${getApiBaseUrl()}/auth/refresh`,
      {
        refreshToken: stored.refreshToken,
        companyId: stored.companyId,
      },
      { timeout: 30000, withCredentials: true }
    );
    const token = response.data?.token;
    if (!token) {
      return { ok: false, revoked: true, attempted: true };
    }
    await writeNativeSession({
      accessToken: token,
      refreshToken: stored.refreshToken,
      companyId: stored.companyId,
    });
    if (typeof window !== "undefined") {
      localStorage.setItem("hrms_token", token);
    }
    return { ok: true, token, revoked: false, attempted: true };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      await clearNativeSession();
      if (typeof window !== "undefined") {
        localStorage.removeItem("hrms_token");
      }
      return { ok: false, revoked: true, attempted: true };
    }
    return { ok: false, revoked: false, attempted: true };
  }
}

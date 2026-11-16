import axios from "axios";
import { getApiBaseUrl } from "./api";

const PLATFORM_TOKEN_KEY = "hrms_platform_token";

export function getPlatformToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLATFORM_TOKEN_KEY);
}

export function setPlatformToken(token) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(PLATFORM_TOKEN_KEY, token);
  else localStorage.removeItem(PLATFORM_TOKEN_KEY);
}

export function clearPlatformToken() {
  setPlatformToken(null);
}

const platformApi = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  timeout: 60000,
});

platformApi.interceptors.request.use((config) => {
  const token = getPlatformToken();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

platformApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || "");
    const isAuthChallenge =
      url.includes("/platform/auth/login") ||
      url.includes("/platform/auth/mfa/");
    if (status === 401 && !isAuthChallenge && typeof window !== "undefined") {
      clearPlatformToken();
      if (!window.location.pathname.startsWith("/platform/login")) {
        window.dispatchEvent(new CustomEvent("hrms:platform-session-expired"));
      }
    }
    return Promise.reject(error);
  }
);

export default platformApi;

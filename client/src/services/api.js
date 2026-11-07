import axios from "axios";
import { clearUserQueries } from "../lib/queryClient";
import {
  ACCESS_RESTRICTED_MESSAGE,
  announceAccessRestricted,
  isHrPermissionDenial,
  shouldAnnouncePermissionDenial,
} from "../utils/accessNotice";

function resolveApiBaseUrl() {
  const envUrl = import.meta?.env?.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  if (import.meta?.env?.PROD) {
    const errorMsg =
      "CRITICAL CONFIGURATION ERROR: VITE_API_URL is missing or empty in production. " +
      "Production deployment requires an explicitly configured backend URL (e.g. your Vercel backend API service). " +
      "Please set VITE_API_URL in your Vercel project environment variables.";
    if (typeof console !== "undefined" && console.error) {
      console.error(errorMsg);
    }
    throw new Error(errorMsg);
  }
  return "http://localhost:5000/api";
}

export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  timeout: 30000,
});

/** Send/resend can exceed the default 30s (SMTP alone is often 11–13s). */
export const OFFER_LETTER_SEND_TIMEOUT_MS = 120000;

export function postOfferLetterSend(offerId) {
  return api.post(`/offer-letters/${offerId}/send`, null, {
    timeout: OFFER_LETTER_SEND_TIMEOUT_MS,
  });
}

export function isRequestTimeoutError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "ECONNABORTED" || message.includes("timeout");
}

// Request interceptor: attach Bearer token from localStorage when present.
// withCredentials: true simultaneously transmits credentials cookies.
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("hrms_token");
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor: clear user-scoped cache on hard auth failures.
// Does not treat cached data as authorization — only wipes stale user data.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || "");
    const isAuthMe = url.includes("/auth/me");
    const isLogin = url.includes("/auth/login");
    if (status === 401 && !isLogin) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("hrms_token");
      }
      clearUserQueries();
      // /auth/me failures are handled by AuthContext restoreSession
      if (!isAuthMe && typeof window !== "undefined") {
        // Soft signal for listeners; AuthProvider still owns routing
        window.dispatchEvent(new CustomEvent("hrms:session-expired"));
      }
    }
    if (status === 403 && !isLogin && error.response && isHrPermissionDenial(error)) {
      error.accessRestricted = true;
      error.userMessage = ACCESS_RESTRICTED_MESSAGE;
      error.message = ACCESS_RESTRICTED_MESSAGE;
      const data = error.response.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const next = { ...data, message: ACCESS_RESTRICTED_MESSAGE };
        delete next.stack;
        delete next.stackTrace;
        delete next.trace;
        error.response.data = next;
      } else {
        error.response.data = { message: ACCESS_RESTRICTED_MESSAGE };
      }
      if (shouldAnnouncePermissionDenial(error)) {
        announceAccessRestricted();
      }
    } else if (status === 403 && !isLogin && error.response?.data && typeof error.response.data === "object") {
      delete error.response.data.stack;
      delete error.response.data.stackTrace;
      delete error.response.data.trace;
    }
    return Promise.reject(error);
  }
);

/**
 * Classifies API and authentication errors into accurate user-facing messages
 * strictly distinguishing:
 * 1. error.response exists (HTTP status code received from server)
 * 2. error.request exists without response (network / connection failure / CORS)
 * 3. Neither exists (client-side configuration / setup error)
 */
export function classifyLoginError(error) {
  // Case 1: Server returned an HTTP response
  if (error?.response) {
    const { status, data } = error.response;
    const code = data?.code;
    const message = data?.message;

    // 1. Confirmed inactive account (403 with ACCOUNT_DISABLED)
    if (code === "ACCOUNT_DISABLED") {
      return "Your account is inactive. Please contact your administrator.";
    }

    // 2. Suspended / inactive company workspace (403 with COMPANY_SUSPENDED / COMPANY_INACTIVE)
    if (code === "COMPANY_SUSPENDED" || code === "COMPANY_INACTIVE") {
      return message || "This company workspace is suspended or inactive. Please contact support.";
    }
    if (status === 403) {
      return "Your account is inactive. Please contact your administrator.";
    }

    // 3. Invalid credentials (401 or INVALID_CREDENTIALS)
    if (code === "INVALID_CREDENTIALS" || status === 401) {
      return "The email or password you entered is incorrect.";
    }

    // 4. Unknown company (404 or COMPANY_NOT_FOUND)
    if (code === "COMPANY_NOT_FOUND" || status === 404) {
      return message || "We couldn't find this company workspace. Check your company code.";
    }

    // 5. Rate limit exceeded (429 or RATE_LIMITED)
    if (status === 429 || code === "RATE_LIMITED") {
      return "Too many login attempts. Please wait before trying again.";
    }

    // 6. Validation / bad request (400)
    if (status === 400 || code === "INVALID_INPUT" || code === "VALIDATION_ERROR") {
      return message || "Please check your details and try again.";
    }

    // 7. Service Unavailable (503) or unexpected server error (500)
    if (status >= 500) {
      return "We're unable to sign you in right now. Please try again shortly.";
    }

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }

    return "An unexpected error occurred. Please try again.";
  }

  // Case 2: Request was made but no response received (backend unreachable, network down, CORS)
  if (error?.request) {
    return "Unable to connect to the server. Please check your connection and try again.";
  }

  // Case 3: Request configuration error or client-side exception
  return "We're unable to sign you in right now. Please try again shortly.";
}

function safeUserMessage(value) {
  if (typeof value !== "string") return "";
  const message = value.trim();
  if (!message || message.length > 280) return "";
  if (message.startsWith("{") || message.startsWith("[")) return "";
  if (/at\s+.+\(.+:\d+:\d+\)/.test(message)) return "";
  if (message.includes("\n") && /stack/i.test(message)) return "";
  return message;
}

/**
 * Clean sentence for a failed API call. 403 stays a rejection with this text;
 * raw JSON and stack traces are not shown.
 */
export function userFacingApiError(error, fallback = "You do not have permission to perform this action.") {
  if (error?.accessRestricted || isHrPermissionDenial(error)) return ACCESS_RESTRICTED_MESSAGE;
  const status = error?.response?.status;
  const data = error?.response?.data;
  const code = data?.code;
  const message = safeUserMessage(data?.message) || safeUserMessage(error?.userMessage);
  if (status === 403) {
    if (code === "ACCOUNT_DISABLED") {
      return "Your account is inactive. Please contact your administrator.";
    }
    if (code === "COMPANY_SUSPENDED" || code === "COMPANY_INACTIVE") {
      return message || "This company workspace is suspended or inactive. Please contact support.";
    }
    return message || fallback;
  }
  if (message) return message;
  if (status >= 500) return "Something went wrong. Please try again.";
  if (!error?.response && error?.request) return "Unable to connect. Check your connection and try again.";
  return fallback;
}

/**
 * User-facing message for HR Admin access denials (CA4-C).
 * Prefer server message; never treat these as login/session failures.
 */
export function getHrAccessDeniedMessage(error, fallback = "You do not have access to perform this action.") {
  if (error?.accessRestricted || isHrPermissionDenial(error)) return ACCESS_RESTRICTED_MESSAGE;
  return userFacingApiError(error, fallback);
}

export default api;

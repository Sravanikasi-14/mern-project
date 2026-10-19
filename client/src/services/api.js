import axios from "axios";

function resolveApiBaseUrl() {
  const envUrl = import.meta?.env?.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  return import.meta?.env?.PROD ? "/api" : "http://localhost:5000/api";
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
});

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

// Response interceptor: preserves original status, response data, and error codes
// without replacing all errors with a generic exception or breaking response rejection.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // If a global 401 redirect was ever needed, never redirect /auth/login or /auth/me
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

    // 1. Invalid credentials (401 or INVALID_CREDENTIALS)
    if (code === "INVALID_CREDENTIALS" || status === 401) {
      return "The company code, email, or password is incorrect. Please check your details and try again.";
    }

    // 2. Unknown company (404 or COMPANY_NOT_FOUND)
    if (code === "COMPANY_NOT_FOUND" || status === 404) {
      return "We couldn't find this company workspace. Check your company code.";
    }

    // 3. Suspended company or disabled account (403)
    if (code === "COMPANY_SUSPENDED" || code === "COMPANY_INACTIVE") {
      return (
        message || "This company workspace is suspended or inactive. Please contact support."
      );
    }
    if (code === "ACCOUNT_DISABLED") {
      return (
        message || "This account is inactive. Please contact your company administrator."
      );
    }
    if (status === 403) {
      return message || "This company workspace is suspended or inactive. Please contact support.";
    }

    // 4. Invalid input / validation error (400)
    if (status === 400 || code === "INVALID_INPUT" || code === "VALIDATION_ERROR") {
      return message || "Please check your details and try again.";
    }

    // 5. Rate limiting (429)
    if (status === 429 || code === "RATE_LIMITED") {
      return message || "Too many login attempts. Please try again later.";
    }

    // 6. Service Unavailable (503)
    if (status === 503 || code === "SERVICE_UNAVAILABLE") {
      return "We're unable to connect right now. Please try again in a moment.";
    }

    // 7. Database or unexpected server error (500)
    if (status >= 500) {
      return "Something went wrong on our side. Please try again later.";
    }

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }

    return "An unexpected error occurred. Please try again.";
  }

  // Case 2: Request was made but no response received (backend unreachable, network down, CORS)
  if (error?.request) {
    return "We're unable to connect right now. Please try again in a moment.";
  }

  // Case 3: Request configuration error or client-side exception
  return error?.message || "Something went wrong on our side. Please try again later.";
}

export default api;

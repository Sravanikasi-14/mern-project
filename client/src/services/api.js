import axios from "axios";

function resolveApiBaseUrl() {
  const envUrl = import.meta?.env?.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim().length > 0) {
    const trimmed = envUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  return import.meta?.env?.PROD
    ? "https://mern-project-rvdl.onrender.com/api"
    : "http://localhost:5000/api";
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

export default api;

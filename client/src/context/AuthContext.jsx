import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);

  const applySession = (payload) => {
    setUser(payload?.user ?? null);
    setCompany(payload?.company ?? null);
    if (payload?.token) {
      localStorage.setItem("hrms_token", payload.token);
    }
  };

  const restoreSession = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setSessionError(null);
    }
    try {
      const response = await api.get("/auth/me");
      applySession(response.data);
      if (silent) {
        setSessionError(null);
      }
      return { success: true, data: response.data };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        // Clear unauthenticated local state
        localStorage.removeItem("hrms_token");
        applySession(null);
      } else if (status === 403) {
        // Inactive account or company
        setSessionError({
          status: 403,
          type: "forbidden",
          message:
            err.response?.data?.message ||
            "Your account or company workspace is currently inactive. Please contact your administrator.",
        });
      } else if (!err?.response && err?.request) {
        // Network failure / server offline - do not wipe token on temporary connection loss
        if (!silent) {
          setSessionError({
            status: 0,
            type: "network",
            message:
              "Unable to connect to the server. Please check your connection and try again.",
          });
        }
      } else if (status >= 500) {
        // 5xx Server Error - do not wipe token on temporary server error
        if (!silent) {
          setSessionError({
            status,
            type: "server",
            message:
              "We're unable to verify your session right now. Please try again shortly.",
          });
        }
      } else {
        localStorage.removeItem("hrms_token");
        applySession(null);
      }
      return { success: false, error: err };
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    restoreSession();

    const handlePopState = () => {
      // Re-evaluate session on browser Back/Forward navigation
      const token = localStorage.getItem("hrms_token");
      if (token) {
        restoreSession({ silent: true });
      }
    };

    const handlePageShow = (event) => {
      // Re-verify if restored from bfcache (Back/Forward cache)
      if (event.persisted) {
        restoreSession({ silent: true });
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      cancelled = true;
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const login = async ({ companyCode, slug, email, password }) => {
    const code = (companyCode || slug || "").trim();
    const response = await api.post("/auth/login", {
      companyCode: code,
      slug: code,
      email,
      password,
    });
    setSessionError(null);
    applySession(response.data);
    return response.data;
  };

  const setupInitialAdmin = async (setupData) => {
    const response = await api.post("/auth/setup-initial-admin", setupData);
    setSessionError(null);
    applySession(response.data);
    return response.data;
  };

  const logout = async () => {
    let serverRevoked = false;
    let logoutError = null;
    try {
      await api.post("/auth/logout");
      serverRevoked = true;
    } catch (err) {
      logoutError = err;
      serverRevoked = false;
    } finally {
      localStorage.removeItem("hrms_token");
      applySession(null);
      setSessionError(null);
    }
    return { success: true, serverRevoked, error: logoutError };
  };

  const value = useMemo(
    () => ({
      user,
      company,
      loading,
      sessionError,
      isAuthenticated: Boolean(user),
      login,
      setupInitialAdmin,
      logout,
      restoreSession,
      applySession,
    }),
    [user, company, loading, sessionError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}


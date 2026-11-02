import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import { clearUserQueries } from "./queryClient";
import { clearCompanyLogoCache } from "../utils/companyLogo";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const sessionGeneration = useRef(0);
  const companyRef = useRef(null);
  companyRef.current = company;

  const applySession = (payload) => {
    setUser(payload?.user ?? null);
    setCompany(payload?.company ?? null);
    if (payload?.token) {
      localStorage.setItem("hrms_token", payload.token);
    }
  };

  /** Merge branding into the in-memory company so headers update without waiting on /auth/me. */
  const updateCompanyBranding = (branding = {}) => {
    const nextLogoUrl = branding?.logoUrl;
    setCompany((prev) => {
      if (!prev) return prev;
      const prevLogoUrl = prev.branding?.logoUrl || "";
      if (nextLogoUrl !== undefined && String(nextLogoUrl) !== String(prevLogoUrl)) {
        clearCompanyLogoCache();
      }
      return {
        ...prev,
        branding: {
          ...(prev.branding || {}),
          ...branding,
        },
      };
    });
  };

  const restoreSession = async ({ silent = false } = {}) => {
    const generation = ++sessionGeneration.current;
    if (!silent) {
      setLoading(true);
      setSessionError(null);
    }
    try {
      const response = await api.get("/auth/me");
      if (generation !== sessionGeneration.current) {
        return { success: false, stale: true };
      }
      const prevLogo = companyRef.current?.branding?.logoUrl || "";
      const nextLogo = response.data?.company?.branding?.logoUrl || "";
      if (String(prevLogo) !== String(nextLogo)) {
        clearCompanyLogoCache();
      }
      applySession(response.data);
      if (silent) {
        setSessionError(null);
      }
      return { success: true, data: response.data };
    } catch (err) {
      if (generation !== sessionGeneration.current) {
        return { success: false, stale: true, error: err };
      }
      const status = err?.response?.status;
      if (status === 401) {
        localStorage.removeItem("hrms_token");
        clearUserQueries();
        clearCompanyLogoCache();
        applySession(null);
      } else if (status === 403) {
        localStorage.removeItem("hrms_token");
        clearUserQueries();
        clearCompanyLogoCache();
        applySession(null);
        setSessionError({
          status: 403,
          type: "forbidden",
          message:
            err.response?.data?.message ||
            "Your account or company workspace is currently inactive. Please contact your administrator.",
        });
      } else if (!err?.response && err?.request) {
        if (!silent) {
          setSessionError({
            status: 0,
            type: "network",
            message:
              "Unable to connect to the server. Please check your connection and try again.",
          });
        }
      } else if (status >= 500) {
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
        clearUserQueries();
        applySession(null);
      }
      return { success: false, error: err };
    } finally {
      if (!silent && generation === sessionGeneration.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    restoreSession();

    const handlePageShow = (event) => {
      if (event.persisted) {
        restoreSession({ silent: true });
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
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
    clearUserQueries();
    setSessionError(null);
    applySession(response.data);
    return response.data;
  };

  const setupInitialAdmin = async (setupData) => {
    const response = await api.post("/auth/setup-initial-admin", setupData);
    clearUserQueries();
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
      clearUserQueries();
      clearCompanyLogoCache();
      applySession(null);
      setSessionError(null);
    }
    return { success: true, serverRevoked, error: logoutError };
  };

  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem("hrms_token");
      clearUserQueries();
      clearCompanyLogoCache();
      applySession(null);
      setSessionError({
        status: 401,
        type: "expired",
        message: "Your session expired. Please sign in again.",
      });
    };
    window.addEventListener("hrms:session-expired", onExpired);
    return () => window.removeEventListener("hrms:session-expired", onExpired);
  }, []);

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
      updateCompanyBranding,
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

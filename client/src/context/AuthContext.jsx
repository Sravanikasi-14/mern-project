import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = (payload) => {
    setUser(payload?.user ?? null);
    setCompany(payload?.company ?? null);
  };

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const response = await api.get("/auth/me");
        if (!cancelled) {
          applySession(response.data);
        }
      } catch {
        if (!cancelled) {
          applySession(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    restore();
    return () => {
      cancelled = true;
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
    applySession(response.data);
    return response.data;
  };

  const setupInitialAdmin = async (setupData) => {
    const response = await api.post("/auth/setup-initial-admin", setupData);
    applySession(response.data);
    return response.data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      applySession(null);
    }
  };

  const value = useMemo(
    () => ({
      user,
      company,
      loading,
      isAuthenticated: Boolean(user),
      login,
      setupInitialAdmin,
      logout,
      applySession,
    }),
    [user, company, loading]
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


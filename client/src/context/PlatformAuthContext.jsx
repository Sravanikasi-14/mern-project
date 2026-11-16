import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import platformApi, {
  clearPlatformToken,
  getPlatformToken,
  setPlatformToken,
} from "../services/platformApi";

const PlatformAuthContext = createContext(null);

export function PlatformAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mfaChallenge, setMfaChallenge] = useState(null);

  const restore = useCallback(async () => {
    const token = getPlatformToken();
    if (!token) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const res = await platformApi.get("/platform/auth/me");
      setAdmin(res.data?.admin || null);
    } catch {
      clearPlatformToken();
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restore();
    const onExpired = () => {
      setAdmin(null);
      setMfaChallenge(null);
    };
    window.addEventListener("hrms:platform-session-expired", onExpired);
    return () => window.removeEventListener("hrms:platform-session-expired", onExpired);
  }, [restore]);

  const login = useCallback(async ({ email, password }) => {
    const res = await platformApi.post("/platform/auth/login", { email, password });
    const data = res.data || {};
    // Development may return a full session after password verification.
    if (data.token && data.admin) {
      setPlatformToken(data.token);
      setAdmin(data.admin);
      setMfaChallenge(null);
      return data;
    }
    if (data.requiresMfaSetup || data.requiresMfa) {
      setMfaChallenge({
        mfaToken: data.mfaToken,
        requiresMfaSetup: Boolean(data.requiresMfaSetup),
        requiresMfa: Boolean(data.requiresMfa),
        admin: data.admin || null,
      });
      setAdmin(null);
      return data;
    }
    throw new Error("Unexpected login response");
  }, []);

  const startMfaSetup = useCallback(async () => {
    if (!mfaChallenge?.mfaToken) throw new Error("Missing MFA challenge");
    const res = await platformApi.post("/platform/auth/mfa/setup/start", {
      mfaToken: mfaChallenge.mfaToken,
    });
    return res.data;
  }, [mfaChallenge]);

  const confirmMfaSetup = useCallback(
    async (code) => {
      if (!mfaChallenge?.mfaToken) throw new Error("Missing MFA challenge");
      const res = await platformApi.post("/platform/auth/mfa/setup/confirm", {
        mfaToken: mfaChallenge.mfaToken,
        code,
      });
      // Persist token but keep challenge cleared only after the UI stores recovery codes.
      setPlatformToken(res.data.token);
      return res.data;
    },
    [mfaChallenge]
  );

  const verifyMfa = useCallback(
    async ({ code, recoveryCode } = {}) => {
      if (!mfaChallenge?.mfaToken) throw new Error("Missing MFA challenge");
      const res = await platformApi.post("/platform/auth/mfa/verify", {
        mfaToken: mfaChallenge.mfaToken,
        code,
        recoveryCode,
      });
      setPlatformToken(res.data.token);
      setAdmin(res.data.admin);
      setMfaChallenge(null);
      return res.data;
    },
    [mfaChallenge]
  );

  const clearMfaChallenge = useCallback(() => setMfaChallenge(null), []);

  const logout = useCallback(async () => {
    try {
      await platformApi.post("/platform/auth/logout");
    } catch {
      /* ignore */
    }
    clearPlatformToken();
    setAdmin(null);
    setMfaChallenge(null);
  }, []);

  const value = useMemo(
    () => ({
      admin,
      loading,
      isAuthenticated: Boolean(admin),
      mfaChallenge,
      login,
      startMfaSetup,
      confirmMfaSetup,
      verifyMfa,
      clearMfaChallenge,
      logout,
      refresh: restore,
    }),
    [
      admin,
      loading,
      mfaChallenge,
      login,
      startMfaSetup,
      confirmMfaSetup,
      verifyMfa,
      clearMfaChallenge,
      logout,
      restore,
    ]
  );

  return (
    <PlatformAuthContext.Provider value={value}>{children}</PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth() {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error("usePlatformAuth must be used within PlatformAuthProvider");
  return ctx;
}

import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import { usePlatformAuth } from "../../context/PlatformAuthContext";
import { getPlatformToken } from "../../services/platformApi";
import "./PlatformAuth.css";

function getPlatformTokenSafe() {
  return Boolean(getPlatformToken());
}

export default function PlatformMfaSetup() {
  const {
    mfaChallenge,
    isAuthenticated,
    startMfaSetup,
    confirmMfaSetup,
    clearMfaChallenge,
    refresh,
  } = usePlatformAuth();
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!mfaChallenge?.requiresMfaSetup) return;
      try {
        const data = await startMfaSetup();
        if (cancelled) return;
        setSecret(data.secret || "");
        setOtpauthUrl(data.otpauthUrl || "");
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || "Unable to start MFA setup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [mfaChallenge, startMfaSetup]);

  if (isAuthenticated && !recoveryCodes) return <Navigate to="/platform" replace />;
  if (!mfaChallenge?.requiresMfaSetup && !recoveryCodes && !getPlatformTokenSafe()) {
    return <Navigate to="/platform/login" replace />;
  }

  const onConfirm = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await confirmMfaSetup(code.trim());
      setRecoveryCodes(data.recoveryCodes || []);
      clearMfaChallenge();
    } catch (err) {
      setError(err?.response?.data?.message || "Invalid MFA code.");
    } finally {
      setSubmitting(false);
    }
  };

  if (recoveryCodes) {
    return (
      <AuthShell portal="platform" title="Save recovery codes">
        <ul className="hrms-auth-recovery-list">
          {recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button
          className="hrms-auth-submit"
          type="button"
          onClick={async () => {
            await refresh();
            navigate("/platform", { replace: true });
          }}
        >
          Continue to platform
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      portal="platform"
      title="Set up MFA"
    >
      {loading ? <p className="hrms-auth-note">Preparing authenticator…</p> : null}
      {error ? (
        <div role="alert" className="hrms-auth-alert" data-kind="error">
          <Shield size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <form className="hrms-auth-form" onSubmit={onConfirm}>
        {!loading && secret ? (
          <>
            <label>
              Secret key
              <input readOnly value={secret} onFocus={(e) => e.target.select()} />
            </label>
            <p className="hrms-auth-note" style={{ textAlign: "left", wordBreak: "break-all" }}>
              otpauth: {otpauthUrl}
            </p>
          </>
        ) : null}
        <label>
          Authentication code
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="6-digit code"
          />
        </label>
        <button className="hrms-auth-submit" type="submit" disabled={submitting || loading}>
          {submitting ? "Verifying…" : "Enable MFA and continue"}
        </button>
      </form>
    </AuthShell>
  );
}

import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
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
      <div className="pa-auth-shell">
        <div className="pa-auth-card">
          <div className="pa-auth-eyebrow">
            <Shield size={12} /> Platform MFA
          </div>
          <h1>Save recovery codes</h1>
          <p className="auth-sub">
            Store these one-time codes securely. They will not be shown again.
          </p>
          <ul>
            {recoveryCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <button
            className="btn-primary"
            type="button"
            onClick={async () => {
              await refresh();
              navigate("/platform", { replace: true });
            }}
          >
            Continue to platform
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pa-auth-shell">
      <form className="pa-auth-card" onSubmit={onConfirm}>
        <div className="pa-auth-eyebrow">
          <Shield size={12} /> Platform MFA
        </div>
        <h1>Set up MFA</h1>
        <p className="pa-auth-sub">
          MFA is mandatory for Platform Admin. Add this authenticator key, then enter a 6-digit code.
        </p>
        {loading ? <p>Preparing authenticator…</p> : null}
        {error ? <div className="error">{error}</div> : null}
        {!loading && secret ? (
          <>
            <label>
              Secret key
              <input readOnly value={secret} onFocus={(e) => e.target.select()} />
            </label>
            <p className="auth-sub" style={{ wordBreak: "break-all" }}>
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
          />
        </label>
        <button className="btn-primary" type="submit" disabled={submitting || loading}>
          {submitting ? "Verifying…" : "Enable MFA and continue"}
        </button>
      </form>
    </div>
  );
}

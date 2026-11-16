import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { usePlatformAuth } from "../../context/PlatformAuthContext";
import "./PlatformAuth.css";

export default function PlatformMfaVerify() {
  const { mfaChallenge, isAuthenticated, verifyMfa } = usePlatformAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/platform" replace />;
  if (!mfaChallenge?.requiresMfa) return <Navigate to="/platform/login" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await verifyMfa(
        useRecovery
          ? { recoveryCode: recoveryCode.trim() }
          : { code: code.trim() }
      );
      navigate("/platform", { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Invalid MFA code.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pa-auth-shell">
      <form className="pa-auth-card" onSubmit={onSubmit}>
        <div className="pa-auth-eyebrow">
          <Shield size={12} /> Platform MFA
        </div>
        <h1>Two-factor authentication</h1>
        <p className="pa-auth-sub">Enter the code from your authenticator app to continue.</p>
        {error ? <div className="error">{error}</div> : null}
        {!useRecovery ? (
          <label>
            Authentication code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required={!useRecovery}
            />
          </label>
        ) : (
          <label>
            Recovery code
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              required={useRecovery}
            />
          </label>
        )}
        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? "Use authenticator code" : "Use a recovery code"}
        </button>
      </form>
    </div>
  );
}

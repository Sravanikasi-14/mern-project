import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
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
    <AuthShell portal="platform" title="Two-factor authentication">
      {error ? (
        <div role="alert" className="hrms-auth-alert" data-kind="error">
          <Shield size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <form className="hrms-auth-form" onSubmit={onSubmit}>
        {!useRecovery ? (
          <label>
            Authentication code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required={!useRecovery}
              placeholder="6-digit code"
            />
          </label>
        ) : (
          <label>
            Recovery code
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              required={useRecovery}
              placeholder="One-time recovery code"
            />
          </label>
        )}
        <button className="hrms-auth-submit" type="submit" disabled={submitting}>
          {submitting ? "Verifying…" : "Verify"}
        </button>
        <button
          type="button"
          className="hrms-auth-secondary"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? "Use authenticator code" : "Use a recovery code"}
        </button>
      </form>
    </AuthShell>
  );
}

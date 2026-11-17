import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Shield } from "lucide-react";
import AuthShell from "../../components/auth/AuthShell";
import SessionBoot from "../../components/SessionBoot";
import { usePlatformAuth } from "../../context/PlatformAuthContext";
import "./PlatformAuth.css";

export default function PlatformLogin() {
  const { login, isAuthenticated, loading, mfaChallenge } = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <SessionBoot />;
  if (isAuthenticated) return <Navigate to="/platform" replace />;
  if (mfaChallenge?.requiresMfaSetup) return <Navigate to="/platform/mfa/setup" replace />;
  if (mfaChallenge?.requiresMfa) return <Navigate to="/platform/mfa" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim(), password });
      if (result?.token && result?.admin) {
        navigate("/platform", { replace: true });
        return;
      }
      if (result.requiresMfaSetup) navigate("/platform/mfa/setup", { replace: true });
      else if (result.requiresMfa) navigate("/platform/mfa", { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell portal="platform" title="Welcome back">
      {error ? (
        <div role="alert" className="hrms-auth-alert" data-kind="error">
          <Shield size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <form className="hrms-auth-form" onSubmit={onSubmit} noValidate>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError("");
            }}
            placeholder="admin@platform.com"
            required
          />
        </label>
        <label>
          Password
          <div className="hrms-auth-password">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              placeholder="••••••••"
              required
            />
            <button
              type="button"
              className="hrms-auth-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
            </button>
          </div>
        </label>
        <button className="hrms-auth-submit" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

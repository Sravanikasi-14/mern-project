import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, Eye, EyeOff } from "lucide-react";
import AuthShell from "./AuthShell";
import SessionBoot from "../SessionBoot";
import { useAuth } from "../../context/AuthContext";
import { classifyLoginError } from "../../services/api";
import { homeForRole } from "../../utils/navigation";

function destinationForLogin(returnUrl, role, portal) {
  const home = homeForRole(role);
  const loginPaths = ["/login", "/admin/login"];
  if (!returnUrl || loginPaths.some((p) => returnUrl === p || returnUrl.startsWith(`${p}?`))) {
    return home;
  }
  if (role === "COMPANY_ADMIN") {
    return returnUrl.startsWith("/admin") || returnUrl.startsWith("/company") ? returnUrl : home;
  }
  if (role === "HR_ADMIN") {
    return returnUrl.startsWith("/admin") ? returnUrl : home;
  }
  if (portal === "hr" && role === "EMPLOYEE") {
    return home;
  }
  return returnUrl.startsWith("/app") ? returnUrl : home;
}

/**
 * Shared company-workspace login form for dedicated employee or HR/admin routes.
 * Same /auth/login API — portal only changes presentation and default routing context.
 */
export default function WorkspaceLogin({ portal = "employee" }) {
  const { login, isAuthenticated, user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [warning, setWarning] = useState(location.state?.logoutWarning || "");
  const [error, setError] = useState(
    location.state?.sessionExpired ? "Your session has expired. Please sign in again." : ""
  );

  if (loading) {
    return <SessionBoot />;
  }

  const clearMessages = () => {
    if (error) setError("");
    if (warning) setWarning("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setWarning("");
    setFieldErrors({});

    const trimmedCode = companyCode.trim();
    const trimmedEmail = email.trim();

    const errors = {};
    if (!trimmedCode) errors.companyCode = "Please enter your company code.";
    if (!trimmedEmail) {
      errors.email = "Please enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = "Please enter a valid email address.";
    }
    if (!password) errors.password = "Please enter your password.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const session = await login({
        companyCode: trimmedCode,
        email: trimmedEmail,
        password,
      });
      const from = location.state?.from;
      const returnUrl =
        typeof from === "string"
          ? from
          : from?.pathname
            ? `${from.pathname}${from.search || ""}${from.hash || ""}`
            : null;
      navigate(destinationForLogin(returnUrl, session.user.role, portal), { replace: true });
    } catch (err) {
      setError(classifyLoginError(err));
      if (err?.response?.data?.errors) {
        setFieldErrors(err.response.data.errors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const footer =
    portal === "hr" ? (
      <div className="hrms-auth-footer">
        <span>New company? </span>
        <Link to="/onboard" replace>
          Set up HR Admin
        </Link>
      </div>
    ) : null;

  return (
    <AuthShell portal={portal} title="Welcome back" footer={footer}>
      {warning ? (
        <div role="status" className="hrms-auth-alert" data-kind="warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="hrms-auth-alert" data-kind="error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {isAuthenticated && user ? (
        <>
          <div role="status" className="hrms-auth-alert" data-kind="info">
            <span>Signed in as {user.email}.</span>
          </div>
          <button
            type="button"
            className="hrms-auth-secondary"
            onClick={() => navigate(homeForRole(user.role), { replace: true })}
          >
            Continue to portal
          </button>
        </>
      ) : null}

      <form onSubmit={handleSubmit} className="hrms-auth-form" noValidate>
        <label>
          Company code
          <input
            value={companyCode}
            onChange={(event) => {
              setCompanyCode(event.target.value);
              clearMessages();
              if (fieldErrors.companyCode) {
                setFieldErrors((prev) => ({ ...prev, companyCode: undefined }));
              }
            }}
            placeholder="e.g. acme"
            autoComplete="organization"
            className={fieldErrors.companyCode ? "has-error" : ""}
            aria-invalid={Boolean(fieldErrors.companyCode)}
            required
          />
          {fieldErrors.companyCode ? (
            <span className="hrms-auth-field-error">{fieldErrors.companyCode}</span>
          ) : null}
        </label>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearMessages();
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="you@company.com"
            autoComplete="username"
            className={fieldErrors.email ? "has-error" : ""}
            aria-invalid={Boolean(fieldErrors.email)}
            required
          />
          {fieldErrors.email ? (
            <span className="hrms-auth-field-error">{fieldErrors.email}</span>
          ) : null}
        </label>

        <label>
          Password
          <div className="hrms-auth-password">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearMessages();
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="••••••••"
              autoComplete="current-password"
              className={fieldErrors.password ? "has-error" : ""}
              aria-invalid={Boolean(fieldErrors.password)}
              required
            />
            <button
              type="button"
              className="hrms-auth-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
            </button>
          </div>
          {fieldErrors.password ? (
            <span className="hrms-auth-field-error">{fieldErrors.password}</span>
          ) : null}
        </label>

        <div className="hrms-auth-row">
          <label className="hrms-auth-check">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Remember me
          </label>
        </div>

        <button type="submit" className="hrms-auth-submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

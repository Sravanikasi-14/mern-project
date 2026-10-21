import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { IconAlertCircle, IconAlertTriangle } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { classifyLoginError } from "../services/api";

function homeForRole(role) {
  return role === "HR_ADMIN" ? "/admin" : "/app";
}

export default function Login() {
  const { login, isAuthenticated, user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [warning, setWarning] = useState(
    location.state?.logoutWarning || ""
  );
  const [error, setError] = useState(
    location.state?.sessionExpired ? "Your session has expired. Please sign in again." : ""
  );

  if (loading) {
    return (
      <main className="container" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h2 style={{ margin: "0 0 6px", fontSize: 16, color: "#09090b" }}>Signing in</h2>
        <p className="subtitle">Verifying your session...</p>
      </main>
    );
  }

  if (isAuthenticated && user) {
    const destination = homeForRole(user.role);
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setWarning("");
    setFieldErrors({});

    const trimmedCode = companyCode.trim();
    const trimmedEmail = email.trim();

    const errors = {};
    if (!trimmedCode) {
      errors.companyCode = "Please enter your company code.";
    }
    if (!trimmedEmail) {
      errors.email = "Please enter your email address.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.email = "Please enter a valid email address.";
      }
    }
    if (!password) {
      errors.password = "Please enter your password.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      if (errors.email && !errors.companyCode && !errors.password) {
        setError("Please enter your email address.");
      } else if (errors.password && !errors.companyCode && !errors.email) {
        setError("Please enter your password.");
      } else if (errors.companyCode && !errors.email && !errors.password) {
        setError("Please enter your company code.");
      } else {
        setError("Please fill in all required fields.");
      }
      return;
    }

    setSubmitting(true);

    try {
      const session = await login({ companyCode: trimmedCode, email: trimmedEmail, password });
      const from = location.state?.from;
      const returnUrl =
        typeof from === "string"
          ? from
          : from?.pathname
          ? `${from.pathname}${from.search || ""}${from.hash || ""}`
          : null;

      const destination =
        returnUrl && returnUrl !== "/login" && !returnUrl.startsWith("/login")
          ? returnUrl
          : homeForRole(session.user.role);

      navigate(destination, { replace: true });
    } catch (err) {
      const classifiedMessage = classifyLoginError(err);
      setError(classifiedMessage);
      if (err?.response?.data?.errors) {
        setFieldErrors(err.response.data.errors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container">
      <h1>Sign in</h1>
      <p className="subtitle">Sign in to your account.</p>

      {warning && (
        <div role="status" className="warning-alert">
          <IconAlertTriangle size={16} />
          <span>{warning}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="error">
          <IconAlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label>
          Company Code
          <input
            value={companyCode}
            onChange={(event) => {
              setCompanyCode(event.target.value);
              if (error) setError("");
              if (warning) setWarning("");
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
          {fieldErrors.companyCode && (
            <span className="field-error">{fieldErrors.companyCode}</span>
          )}
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError("");
              if (warning) setWarning("");
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
          {fieldErrors.email && (
            <span className="field-error">{fieldErrors.email}</span>
          )}
        </label>
        <label>
          Password
          <div className="password-input-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError("");
                if (warning) setWarning("");
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
              className="password-toggle-btn"
              onClick={() => setShowPassword((prev) => !prev)}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
          {fieldErrors.password && (
            <span className="field-error">{fieldErrors.password}</span>
          )}
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #eaecf0", fontSize: "14px", color: "#667085", textAlign: "center" }}>
        <span>New company? </span>
        <Link to="/onboard" replace style={{ color: "#18181b", textDecoration: "none", fontWeight: "600" }}>
          Set up HR Admin
        </Link>
      </div>
    </main>
  );
}

import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
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
  const [error, setError] = useState(
    location.state?.sessionExpired ? "Your session has expired. Please sign in again." : ""
  );

  if (loading) {
    return <p className="container">Restoring session...</p>;
  }

  if (isAuthenticated) {
    const destination = location.state?.from?.pathname || homeForRole(user.role);
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const trimmedCode = companyCode.trim();
    const trimmedEmail = email.trim();

    if (!trimmedCode || !trimmedEmail || !password) {
      setError("Please enter your company code, email, and password.");
      const errors = {};
      if (!trimmedCode) errors.companyCode = "Company code is required.";
      if (!trimmedEmail) errors.email = "Email is required.";
      if (!password) errors.password = "Password is required.";
      setFieldErrors(errors);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      setFieldErrors({ email: "Please enter a valid email address." });
      return;
    }

    setSubmitting(true);

    try {
      const session = await login({ companyCode: trimmedCode, email: trimmedEmail, password });
      const destination = location.state?.from?.pathname || homeForRole(session.user.role);
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
      <p className="subtitle">Company HR Admin and Employee login.</p>

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <label>
          Company code
          <input
            value={companyCode}
            onChange={(event) => {
              setCompanyCode(event.target.value);
              if (error) setError("");
              if (fieldErrors.companyCode) {
                setFieldErrors((prev) => ({ ...prev, companyCode: undefined }));
              }
            }}
            placeholder="e.g. acme"
            autoComplete="organization"
            className={fieldErrors.companyCode ? "has-error" : ""}
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
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="you@company.com"
            autoComplete="username"
            className={fieldErrors.email ? "has-error" : ""}
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
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="••••••••"
              autoComplete="current-password"
              className={fieldErrors.password ? "has-error" : ""}
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
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #eaecf0", fontSize: "14px", color: "#667085", textAlign: "center" }}>
        <span>Setting up a provisioned company? </span>
        <Link to="/onboard" style={{ color: "#4338ca", textDecoration: "none", fontWeight: "600" }}>
          Set up initial HR Admin
        </Link>
      </div>
    </main>
  );
}

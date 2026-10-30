import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import { classifyLoginError } from "../../services/api";
import { LeafIcon } from "../../components/Icon";
import SessionBoot from "../../components/SessionBoot";

function homeForRole(role) {
  return role === "HR_ADMIN" ? "/admin/dashboard" : "/app";
}

function destinationForLogin(returnUrl, role) {
  const home = homeForRole(role);
  if (!returnUrl || returnUrl === "/login" || returnUrl.startsWith("/login")) {
    return home;
  }
  if (role === "HR_ADMIN") {
    return returnUrl.startsWith("/admin") ? returnUrl : home;
  }
  return returnUrl.startsWith("/app") ? returnUrl : home;
}

export default function LoginPage() {
  const { login, isAuthenticated, user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [warning, setWarning] = useState(location.state?.logoutWarning || "");
  const [error, setError] = useState(
    location.state?.sessionExpired ? "Your session has expired. Please sign in again." : ""
  );

  if (loading) {
    return <SessionBoot />;
  }

  if (isAuthenticated && user) {
    const returnUrl = location.state?.from?.pathname || location.state?.from || "";
    return <Navigate to={destinationForLogin(returnUrl, user.role)} replace />;
  }


  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setWarning("");
    const errors = {};
    if (!companyCode.trim()) errors.companyCode = "Please enter your company code.";
    if (!email.trim()) errors.email = "Please enter your email address.";
    if (!password) errors.password = "Please enter your password.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    try {
      const session = await login({
        companyCode: companyCode.trim(),
        email: email.trim(),
        password,
      });
      const from = location.state?.from;
      const returnUrl =
        typeof from === "string"
          ? from
          : from?.pathname
          ? `${from.pathname}${from.search || ""}`
          : null;
      navigate(destinationForLogin(returnUrl, session.user.role), { replace: true });
    } catch (err) {
      setError(classifyLoginError(err));
      if (err?.response?.data?.errors) setFieldErrors(err.response.data.errors);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="brand-mark">
          <LeafIcon />
        </div>
        <h1 className="page-title" style={{ textAlign: "center" }}>Verdant HRMS</h1>
        <p className="caption" style={{ textAlign: "center", margin: "6px 0 20px" }}>
          Welcome back
        </p>
        {warning ? <div className="alert alert-warn">{warning}</div> : null}
        {error ? <div role="alert" className="alert alert-error">{error}</div> : null}
        {isAuthenticated && user ? (
          <div className="alert alert-warn">
            Signed in as {user.email}. Continue to your portal or sign in below with a different account.
            <button
              type="button"
              className="btn-secondary btn-block"
              style={{ marginTop: 10 }}
              onClick={() => navigate(homeForRole(user.role), { replace: true })}
            >
              Continue
            </button>
          </div>
        ) : null}
        <form className="form-grid" onSubmit={handleSubmit} noValidate>
          <label>
            Company ID
            <input
              value={companyCode}
              onChange={(event) => setCompanyCode(event.target.value)}
              autoComplete="organization"
              required
            />
            {fieldErrors.companyCode ? <span className="caption">{fieldErrors.companyCode}</span> : null}
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <div className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In"}
          </button>
          <p className="caption" style={{ textAlign: "center" }}>
            <Link to="/onboard">Set up a workspace</Link>
          </p>
        </form>
      </div>
    </main>
  );
}

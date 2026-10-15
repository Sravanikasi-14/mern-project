import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { applySession, setupInitialAdmin } = useAuth();

  // Token-based state
  const [verifying, setVerifying] = useState(Boolean(token));
  const [invitation, setInvitation] = useState(null);
  const [verifyError, setVerifyError] = useState("");

  // Form inputs
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Token verification effect if token is provided
  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const verify = async () => {
      try {
        const response = await api.get(`/auth/onboarding/verify?token=${encodeURIComponent(token)}`);
        if (!cancelled) {
          setInvitation(response.data);
          setCompanyCode(response.data.companyCode || "");
          setEmail(response.data.email || "");
        }
      } catch (err) {
        if (!cancelled) {
          setVerifyError(
            err.response?.data?.message ||
              "This onboarding invitation link is invalid or has expired."
          );
        }
      } finally {
        if (!cancelled) {
          setVerifying(false);
        }
      }
    };

    verify();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!token) {
      if (!companyCode.trim() || !email.trim() || !password) {
        setFormError("Please enter your company code, email, and password.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setFormError("Please enter a valid email address.");
        return;
      }
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match. Please verify and try again.");
      return;
    }

    setSubmitting(true);

    try {
      if (token) {
        const response = await api.post("/auth/onboarding/complete", {
          token,
          password,
        });
        if (applySession && response.data) {
          applySession(response.data);
        }
      } else {
        await setupInitialAdmin({
          companyCode: companyCode.trim().toLowerCase(),
          email: email.trim(),
          password,
          confirmPassword,
        });
      }

      navigate("/admin", { replace: true });
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setFormError("We're unable to connect right now. Please try again in a moment.");
      } else {
        setFormError(
          err.response.data?.message ||
            "Unable to complete setup. Please check your details and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container">
      <h1>Initial HR Admin Setup</h1>
      <p className="subtitle">
        Set up the administrator account for your provisioned company workspace.
      </p>

      {verifying && <p style={{ marginTop: "16px" }}>Verifying invitation details...</p>}

      {!verifying && verifyError && (
        <div style={{ marginTop: "20px" }}>
          <p role="alert" className="error" style={{ marginBottom: "16px" }}>
            {verifyError}
          </p>
          <Link to="/login">
            <button type="button">Go to Sign in</button>
          </Link>
        </div>
      )}

      {!verifying && !verifyError && (
        <>
          {invitation && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "16px",
                marginTop: "20px",
                display: "grid",
                gap: "8px",
                fontSize: "14px",
              }}
            >
              <div>
                <strong style={{ color: "#475569" }}>Company: </strong>
                <span>{invitation.companyName}</span>
              </div>
              <div>
                <strong style={{ color: "#475569" }}>Company code: </strong>
                <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>
                  {invitation.companyCode}
                </code>
              </div>
              <div>
                <strong style={{ color: "#475569" }}>Authorized email: </strong>
                <span>{invitation.email}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {!invitation && (
              <>
                <label>
                  Company code *
                  <input
                    value={companyCode}
                    onChange={(e) => {
                      setCompanyCode(e.target.value);
                      if (formError) setFormError("");
                    }}
                    placeholder="e.g. acme"
                    autoComplete="organization"
                    required
                  />
                </label>
                <label>
                  Authorized Primary Contact Email *
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (formError) setFormError("");
                    }}
                    placeholder="hr@company.com"
                    autoComplete="username"
                    required
                  />
                </label>
              </>
            )}

            <label>
              Create password (minimum 8 characters) *
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (formError) setFormError("");
                  }}
                  placeholder="••••••••"
                  autoComplete="new-password"
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
            </label>

            <label>
              Confirm password *
              <div className="password-input-wrapper">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (formError) setFormError("");
                  }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  title={showConfirmPassword ? "Hide password" : "Show password"}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? (
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
            </label>

            {formError && (
              <p role="alert" className="error">
                {formError}
              </p>
            )}

            <button type="submit" disabled={submitting}>
              {submitting ? "Setting up account..." : "Complete setup & log in"}
            </button>
          </form>

          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid #eaecf0",
              fontSize: "14px",
              color: "#667085",
              textAlign: "center",
            }}
          >
            <span>Already have an account? </span>
            <Link to="/login" style={{ color: "#4338ca", textDecoration: "none", fontWeight: "600" }}>
              Sign in
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

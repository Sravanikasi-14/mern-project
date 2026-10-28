import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { IconAlertCircle, IconCheck, IconEye, IconEyeOff } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function AccountActivation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { applySession } = useAuth();

  const [loading, setLoading] = useState(true);
  const [verifyingError, setVerifyingError] = useState("");
  const [accountInfo, setAccountInfo] = useState(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [activatedSuccess, setActivatedSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerifyingError("Activation link is missing a token. Please use the link provided in your email.");
      setLoading(false);
      return;
    }

    const verifyToken = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/auth/activate/verify?token=${encodeURIComponent(token)}`);
        setAccountInfo(res.data);
      } catch (err) {
        setVerifyingError(err.response?.data?.message || "This activation link is invalid or has expired.");
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!password) {
      setFormError("Please enter a password.");
      return;
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post("/auth/activate/complete", {
        token,
        password,
      });

      setActivatedSuccess(true);
      if (res.data) {
        applySession(res.data);
      }

      // Automatically navigate to employee dashboard
      setTimeout(() => {
        navigate("/app", { replace: true });
      }, 1500);
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to activate account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="container" style={{ textAlign: "center", padding: "64px 24px" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h2 style={{ margin: "0 0 6px", fontSize: 18, color: "#09090b" }}>Verifying link</h2>
        <p className="subtitle">Checking your account…</p>
      </main>
    );
  }

  if (verifyingError) {
    return (
      <main className="container" style={{ maxWidth: 480, margin: "64px auto", padding: "0 16px" }}>
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div style={{ color: "#ef4444", marginBottom: 16 }}>
            <IconAlertCircle style={{ width: 44, height: 44, margin: "0 auto" }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "#09090b", marginBottom: 8 }}>
            Activation Link Invalid
          </h2>
          <p style={{ color: "#71717a", fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
            {verifyingError}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Link to="/login" className="btn btn-primary" style={{ textDecoration: "none" }}>
              Go to Sign In
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (activatedSuccess) {
    return (
      <main className="container" style={{ maxWidth: 480, margin: "64px auto", padding: "0 16px" }}>
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div style={{ color: "#10b981", marginBottom: 16 }}>
            <IconCheck style={{ width: 48, height: 48, margin: "0 auto" }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "#09090b", marginBottom: 8 }}>
            Account Activated
          </h2>
          <p style={{ color: "#71717a", fontSize: 14, marginBottom: 20 }}>
            Your account has been activated successfully. Redirecting you to your employee portal...
          </p>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <div className="card" style={{ padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#09090b", margin: "0 0 6px" }}>
            Welcome to {accountInfo?.company?.name || "HRMS"}
          </h1>
          <p className="subtitle" style={{ fontSize: 14, color: "#71717a", margin: 0 }}>
            Set a password to complete your account activation and access your employee portal.
          </p>
        </div>

        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#64748b" }}>Employee Name</span>
            <strong style={{ color: "#0f172a" }}>{accountInfo?.fullName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#64748b" }}>Work Email</span>
            <strong style={{ color: "#0f172a" }}>{accountInfo?.email}</strong>
          </div>
          {accountInfo?.employeeCode && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#64748b" }}>Employee ID</span>
              <strong style={{ color: "#0f172a" }}>{accountInfo?.employeeCode}</strong>
            </div>
          )}
          {accountInfo?.jobTitle && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b" }}>Position</span>
              <strong style={{ color: "#0f172a" }}>{accountInfo?.jobTitle}</strong>
            </div>
          )}
        </div>

        {formError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <IconAlertCircle className="alert-icon" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label" htmlFor="new-password">
              Password <span className="required">*</span>
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                className="form-control"
                style={{ paddingRight: 40 }}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  padding: 4,
                  display: "flex",
                }}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <IconEyeOff style={{ width: 18, height: 18 }} /> : <IconEye style={{ width: 18, height: 18 }} />}
              </button>
            </div>
            <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
              Must contain at least 8 characters.
            </p>
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label" htmlFor="confirm-password">
              Confirm Password <span className="required">*</span>
            </label>
            <input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              className="form-control"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ width: "100%", padding: "10px 16px" }}
          >
            {submitting ? "Activating Account..." : "Set Password & Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}

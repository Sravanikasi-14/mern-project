import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import api from "../../services/api";

export default function ActivatePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const [loading, setLoading] = useState(true);
  const [verifyError, setVerifyError] = useState("");
  const [info, setInfo] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerifyError("This activation link is missing a token. Use the link from your email.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await api.get(`/auth/activate/verify?token=${encodeURIComponent(token)}`);
        setInfo(res.data);
      } catch (err) {
        setVerifyError(err.response?.data?.message || "This activation link is invalid or has expired.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    try {
      setBusy(true);
      const res = await api.post("/auth/activate/complete", { token, password });
      if (res.data) applySession(res.data);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Could not activate this account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="page-title">Activate account</h1>
        {loading ? <div className="spinner" style={{ margin: "16px auto" }} /> : verifyError ? (
          <>
            <p className="caption" style={{ margin: "8px 0 16px" }}>{verifyError}</p>
            <Link className="btn-primary btn-block" to="/login">Go to sign in</Link>
          </>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <p className="caption">{info?.email || info?.user?.email}</p>
            {error ? <div className="alert alert-error">{error}</div> : null}
            <label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Activating..." : "Activate account"}</button>
          </form>
        )}
      </div>
    </main>
  );
}

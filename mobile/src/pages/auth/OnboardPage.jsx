import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import api from "../../services/api";

export default function OnboardPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { applySession, setupInitialAdmin } = useAuth();
  const [verifying, setVerifying] = useState(Boolean(token));
  const [invitation, setInvitation] = useState(null);
  const [verifyError, setVerifyError] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/auth/onboarding/verify?token=${encodeURIComponent(token)}`);
        if (!cancelled) {
          setInvitation(res.data);
          setCompanyCode(res.data.companyCode || "");
          setEmail(res.data.email || "");
        }
      } catch (err) {
        if (!cancelled) {
          setVerifyError(err.response?.data?.message || "This invitation is invalid or has expired.");
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => { cancelled = true; };
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
      if (token) {
        const payload = invitation?.type === "EMPLOYEE"
          ? { token, password, preferredName: preferredName.trim() || undefined, phoneNumber: phoneNumber.trim() || undefined }
          : { token, password };
        const res = await api.post("/auth/onboarding/complete", payload);
        if (res.data) applySession(res.data);
        navigate(invitation?.type === "EMPLOYEE" ? "/app" : "/admin/dashboard", { replace: true });
      } else {
        await setupInitialAdmin({
          companyCode: companyCode.trim().toLowerCase(),
          email: email.trim(),
          password,
          confirmPassword,
        });
        navigate("/admin/dashboard", { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not complete setup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="page-title">{token ? "Complete onboarding" : "Set up workspace"}</h1>
        {verifying ? <div className="spinner" style={{ margin: "16px auto" }} /> : verifyError ? (
          <>
            <p className="caption" style={{ margin: "8px 0 16px" }}>{verifyError}</p>
            <Link className="btn-primary btn-block" to="/login">Go to sign in</Link>
          </>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            {error ? <div className="alert alert-error">{error}</div> : null}
            {!token ? (
              <>
                <label>Company code<input value={companyCode} onChange={(event) => setCompanyCode(event.target.value)} /></label>
                <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              </>
            ) : (
              <p className="caption">{email || invitation?.email}</p>
            )}
            {invitation?.type === "EMPLOYEE" ? (
              <>
                <label>Preferred name<input value={preferredName} onChange={(event) => setPreferredName(event.target.value)} /></label>
                <label>Phone<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} /></label>
              </>
            ) : null}
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving..." : "Complete setup"}</button>
            <Link to="/login">Back to sign in</Link>
          </form>
        )}
      </div>
    </main>
  );
}

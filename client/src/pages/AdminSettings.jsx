import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { IconClose, IconCheck } from "../components/Icons";
import api from "../services/api";

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [hasAppPassword, setHasAppPassword] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState(null);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(20);
  const [testTo, setTestTo] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/settings/email");
      const s = res.data?.emailSettings || {};
      setFromName(s.fromName || "");
      setFromEmail(s.fromEmail || "");
      setSmtpHost(s.smtpHost || "smtp.gmail.com");
      setSmtpPort(s.smtpPort || 587);
      setSmtpSecure(Boolean(s.smtpSecure));
      setHasAppPassword(Boolean(s.hasAppPassword));
      setIsConfigured(Boolean(s.isConfigured));
      setLastVerifiedAt(s.lastVerifiedAt || null);
      setRateLimitPerMinute(s.rateLimitPerMinute || 20);
      if (s.fromEmail && !testTo) {
        setTestTo(s.fromEmail);
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Failed to load email settings. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!fromEmail.trim()) {
      setError("Sender email is required.");
      return;
    }
    if (!hasAppPassword && !appPassword.trim()) {
      setError("Gmail app password is required.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
        smtpHost: smtpHost.trim() || "smtp.gmail.com",
        smtpPort: Number(smtpPort) || 587,
        smtpSecure: Boolean(smtpSecure),
      };
      if (appPassword.trim()) {
        payload.appPassword = appPassword.trim();
      }

      const res = await api.put("/settings/email", payload);
      setSuccessMsg(res.data?.message || "Email settings saved.");
      setAppPassword("");
      setHasAppPassword(Boolean(res.data?.emailSettings?.hasAppPassword));
      setIsConfigured(Boolean(res.data?.emailSettings?.isConfigured));
      setLastVerifiedAt(res.data?.emailSettings?.lastVerifiedAt || null);
      if (!testTo && fromEmail) setTestTo(fromEmail.trim());
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Could not save email settings. Check your credentials and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError("");
    setSuccessMsg("");
    try {
      setTesting(true);
      const res = await api.post("/settings/email/test", {
        to: testTo.trim() || undefined,
      });
      setSuccessMsg(res.data?.message || "Test email sent successfully.");
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          "Test email failed. Save valid settings first, then try again."
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="container-wide" style={{ maxWidth: "760px", padding: "28px" }}>
      <AppHeader title="Settings" />

      {error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            color: "#991b1b",
            fontSize: "14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            style={{
              background: "none",
              border: "none",
              color: "#991b1b",
              padding: "0 4px",
              cursor: "pointer",
            }}
            aria-label="Dismiss error"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {successMsg && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: "8px",
            color: "#065f46",
            fontSize: "14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <IconCheck size={14} />
            {successMsg}
          </span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            style={{
              background: "none",
              border: "none",
              color: "#065f46",
              padding: "0 4px",
              cursor: "pointer",
            }}
            aria-label="Dismiss message"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      <section
        style={{
          border: "1px solid #e4e4e7",
          borderRadius: "12px",
          padding: "24px",
          background: "#fff",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700 }}>
            Email delivery (Nodemailer / Gmail)
          </h2>
          <p style={{ margin: 0, color: "#71717a", fontSize: "14px", lineHeight: 1.5 }}>
            Offer letters and invitations are sent from the mailbox you configure here.
            Use a Gmail address with an{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#2563eb" }}
            >
              App Password
            </a>{" "}
            (not your normal Google password). Mails can go to any recipient.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: "999px",
              background: isConfigured ? "#ecfdf5" : "#f4f4f5",
              color: isConfigured ? "#047857" : "#52525b",
              border: `1px solid ${isConfigured ? "#a7f3d0" : "#e4e4e7"}`,
            }}
          >
            {isConfigured ? "Configured" : "Not configured"}
          </span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              padding: "4px 10px",
              borderRadius: "999px",
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}
          >
            Rate limit: {rateLimitPerMinute}/min
          </span>
          {lastVerifiedAt && (
            <span style={{ fontSize: "12px", color: "#71717a", alignSelf: "center" }}>
              Last verified: {new Date(lastVerifiedAt).toLocaleString()}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "#71717a" }}>
            Loading settings…
          </div>
        ) : (
          <form onSubmit={handleSave}>
            <div style={{ display: "grid", gap: "16px" }}>
              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#3f3f46" }}>
                  Display name
                </span>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Acme HR"
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#3f3f46" }}>
                  Sender email (Gmail) *
                </span>
                <input
                  type="email"
                  required
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="hr@yourcompany.com"
                  style={inputStyle}
                  autoComplete="username"
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#3f3f46" }}>
                  App password {hasAppPassword ? "(leave blank to keep current)" : "*"}
                </span>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                    placeholder={
                      hasAppPassword ? "••••••••••••••••" : "xxxx xxxx xxxx xxxx"
                    }
                    style={{ ...inputStyle, paddingRight: "72px" }}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: "absolute",
                      right: "8px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      padding: "4px 8px",
                      fontSize: "12px",
                    }}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <span style={{ fontSize: "12px", color: "#71717a" }}>
                  Create at myaccount.google.com/apppasswords after enabling 2-Step Verification.
                </span>
              </label>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ justifySelf: "start" }}
              >
                {showAdvanced ? "Hide" : "Show"} advanced SMTP options
              </button>

              {showAdvanced && (
                <div
                  style={{
                    display: "grid",
                    gap: "14px",
                    padding: "14px",
                    background: "#fafafa",
                    border: "1px solid #e4e4e7",
                    borderRadius: "8px",
                  }}
                >
                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>SMTP host</span>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <label style={{ display: "grid", gap: "6px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 600 }}>Port</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginTop: "22px",
                        fontSize: "13px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={smtpSecure}
                        onChange={(e) => setSmtpSecure(e.target.checked)}
                      />
                      Use TLS (secure / port 465)
                    </label>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "4px" }}>
                <button type="submit" disabled={saving}>
                  {saving ? "Saving & verifying…" : "Save email settings"}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      <section
        style={{
          marginTop: "20px",
          border: "1px solid #e4e4e7",
          borderRadius: "12px",
          padding: "24px",
          background: "#fff",
        }}
      >
        <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700 }}>
          Send test email
        </h2>
        <p style={{ margin: "0 0 16px", color: "#71717a", fontSize: "13px" }}>
          Confirms Nodemailer can deliver to any address using your saved mailbox.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="recipient@example.com"
            style={{ ...inputStyle, flex: "1 1 240px", maxWidth: "360px" }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={handleTest}
            disabled={testing || !isConfigured}
          >
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
      </section>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #d4d4d8",
  fontSize: "14px",
  background: "#fff",
  color: "#09090b",
  outline: "none",
};

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Lock,
  LogOut,
  Palette,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import SegmentedTabs from "../../components/SegmentedTabs";
import Toggle from "../../components/Toggle";
import EmptyState, { Skeleton } from "../../components/EmptyState";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useToast } from "../../components/Toast";
import { getCompanyBrandName } from "../../utils/companyBrand";
import api from "../../services/api";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export default function HrSettingsPage() {
  const navigate = useNavigate();
  const { user, company, restoreSession, logout } = useAuth();
  const toast = useToast();
  const logoInputRef = useRef(null);

  const [tab, setTab] = useState("company");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const [hasSavedLogo, setHasSavedLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [logs, setLogs] = useState([]);

  const [emailNotifications, setEmailNotifications] = useState(
    user?.preferences?.emailNotifications !== false
  );
  const [weeklyDigest, setWeeklyDigest] = useState(user?.preferences?.weeklyDigest !== false);

  const brand = getCompanyBrandName(company) || companyName || "Company";
  const userName = user?.name || user?.fullName || user?.email || "HR Admin";
  const userRole = user?.role === "HR_ADMIN" ? "HR Admin" : user?.role || "Admin";

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError("");
        const [companyRes, logRes] = await Promise.all([
          api.get("/settings/company").catch(() => null),
          api.get("/settings/audit-logs", { params: { limit: 12 } }).catch(() => null),
        ]);
        const c = companyRes?.data?.company || companyRes?.data?.data || {};
        setDisplayName(c.branding?.displayName || getCompanyBrandName(company) || "");
        setCompanyName(c.companyName || company?.companyName || "");
        setTimezone(c.config?.timezone || "Asia/Kolkata");
        setCurrency(c.config?.currencyCode || "INR");
        setContactEmail(c.primaryContact?.email || "");
        setContactPhone(c.primaryContact?.phoneNumber || "");
        setHasSavedLogo(Boolean(c.branding?.logoUrl || company?.branding?.logoUrl));
        setLogs(logRes?.data?.logs || []);
      } catch (err) {
        setError(err.response?.data?.message || "Could not load settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Load once on mount; AuthContext company updates should not wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    async function loadSavedLogo() {
      if (!hasSavedLogo || logoFile) return;
      try {
        const res = await api.get("/auth/company-logo", { responseType: "blob" });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setLogoPreview(objectUrl);
      } catch {
        if (!cancelled) setLogoPreview("");
      }
    }
    loadSavedLogo();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasSavedLogo, logoFile]);

  const saveCompany = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await api.put("/settings/company", {
        companyName: companyName.trim(),
        displayName: displayName.trim(),
        timezone,
        currencyCode: currency,
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        primaryContact: {
          email: contactEmail.trim(),
          phoneNumber: contactPhone.trim(),
        },
      });
      toast.push("Company profile saved.");
      await restoreSession({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || "Could not save company settings.");
    } finally {
      setSaving(false);
    }
  };

  const onLogoPick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setLogoError("");
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowed.includes(file.type)) {
      setLogoError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("Logo must be 2 MB or smaller.");
      return;
    }
    if (logoPreview && logoPreview.startsWith("blob:") && logoFile) {
      URL.revokeObjectURL(logoPreview);
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const saveLogo = async () => {
    if (!logoFile || logoSaving) return;
    try {
      setLogoSaving(true);
      setLogoError("");
      const fileData = await readFileAsDataUrl(logoFile);
      await api.post("/settings/company/logo", {
        fileName: logoFile.name,
        fileData,
        mimeType: logoFile.type,
      });
      setLogoFile(null);
      setHasSavedLogo(true);
      toast.push("Company logo saved.");
      await restoreSession({ silent: true });
    } catch (err) {
      setLogoError(err.response?.data?.message || "Failed to save the company logo.");
    } finally {
      setLogoSaving(false);
    }
  };

  const removeLogo = async () => {
    if (logoSaving) return;
    try {
      setLogoSaving(true);
      setLogoError("");
      if (hasSavedLogo) {
        await api.delete("/settings/company/logo");
        await restoreSession({ silent: true });
      }
      if (logoPreview && logoPreview.startsWith("blob:")) {
        URL.revokeObjectURL(logoPreview);
      }
      setLogoPreview("");
      setLogoFile(null);
      setHasSavedLogo(false);
      toast.push("Company logo removed.");
    } catch (err) {
      setLogoError(err.response?.data?.message || "Failed to remove the company logo.");
    } finally {
      setLogoSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await api.post("/auth/change-password", { currentPassword, newPassword, confirmPassword });
      toast.push("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not update password.");
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (saving) return;
    try {
      setSaving(true);
      setError("");
      await api.put("/auth/profile", { preferences: { emailNotifications, weeklyDigest } });
      toast.push("Notification preferences saved.");
      await restoreSession({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    const res = await logout();
    navigate("/login", {
      replace: true,
      state: res?.serverRevoked ? undefined : { logoutWarning: "You have been signed out." },
    });
  };

  if (loading) {
    return (
      <div className="st-set">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Settings</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="st-set">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Settings</h1>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="st-set-profile">
        <div className="st-set-profile-main">
          <span className="st-set-avatar">{initialsFrom(userName)}</span>
          <div>
            <strong>{userName}</strong>
            <span>{userRole}</span>
          </div>
        </div>
        <span className="st-set-badge">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
          Admin
        </span>
      </section>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "company", label: "Company" },
          { value: "notifications", label: "Alerts" },
          { value: "security", label: "Security" },
        ]}
      />

      {tab === "company" ? (
        <form className="st-set-stack" onSubmit={saveCompany}>
          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Company profile</h2>
              <span>Branding</span>
            </div>
            <div className="st-set-card">
              <div className="st-set-logo-row">
                <div className="st-set-logo">
                  {logoPreview ? (
                    <img src={logoPreview} alt="" />
                  ) : (
                    <Building2 size={22} strokeWidth={1.85} aria-hidden="true" />
                  )}
                </div>
                <div className="st-set-logo-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoSaving}
                  >
                    <ImagePlus size={14} strokeWidth={2} aria-hidden="true" />
                    {logoPreview ? "Replace logo" : "Upload logo"}
                  </button>
                  {logoFile ? (
                    <button type="button" className="btn-primary btn-sm" disabled={logoSaving} onClick={saveLogo}>
                      {logoSaving ? "Saving…" : "Save logo"}
                    </button>
                  ) : null}
                  {logoPreview || hasSavedLogo ? (
                    <button type="button" className="btn-ghost btn-sm is-danger" disabled={logoSaving} onClick={removeLogo}>
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      Remove
                    </button>
                  ) : null}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    hidden
                    onChange={onLogoPick}
                  />
                </div>
              </div>
              {logoError ? <p className="field-error">{logoError}</p> : null}
              <p className="caption">PNG, JPEG, or WebP · max 2 MB</p>
            </div>
          </section>

          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Organisation</h2>
              <span>Details</span>
            </div>
            <div className="st-set-card st-set-form">
              <label>
                Legal company name
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  autoComplete="organization"
                />
              </label>
              <label>
                Display name
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
              <label>
                Company code
                <input value={company?.slug || ""} readOnly />
              </label>
              <label>
                Contact email
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                Contact phone
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  autoComplete="tel"
                />
              </label>
              <label>
                Timezone
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                  {!TIMEZONES.includes(timezone) && timezone ? (
                    <option value={timezone}>{timezone}</option>
                  ) : null}
                </select>
              </label>
              <label>
                Currency
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                  {!CURRENCIES.includes(currency) && currency ? (
                    <option value={currency}>{currency}</option>
                  ) : null}
                </select>
              </label>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save company profile"}
              </button>
            </div>
          </section>

          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Appearance</h2>
              <span>Interface</span>
            </div>
            <div className="st-set-card">
              <div className="st-set-row">
                <span className="st-set-row-ico">
                  <Palette size={18} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <span className="st-set-row-copy">
                  <strong>App theme</strong>
                  <span>Pastel light is the active mobile theme</span>
                </span>
                <span className="st-set-chip">Light</span>
              </div>
              <p className="caption st-set-pad">
                Theme switching is not exposed by the current settings API, so appearance stays on the established pastel light palette.
              </p>
            </div>
          </section>
        </form>
      ) : null}

      {tab === "notifications" ? (
        <div className="st-set-stack">
          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Notifications</h2>
              <span>Alert delivery</span>
            </div>
            <div className="st-set-card st-set-pad">
              <Toggle
                label="Email notifications"
                description="Account and workflow emails"
                checked={emailNotifications}
                onChange={setEmailNotifications}
              />
              <Toggle
                label="Weekly digest"
                description="A weekly summary of your workspace"
                checked={weeklyDigest}
                onChange={setWeeklyDigest}
              />
              <p className="caption">
                Push notifications and per-module alert toggles are not separately configurable in the API.
              </p>
              <button type="button" className="btn-primary btn-block" disabled={saving} onClick={saveNotes}>
                {saving ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "security" ? (
        <div className="st-set-stack">
          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Password</h2>
              <span>Access</span>
            </div>
            <form className="st-set-card st-set-form" onSubmit={changePassword}>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </label>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Updating…" : "Update password"}
              </button>
              <p className="caption">
                Two-factor authentication, session timeout, and IP restrictions are not exposed by the current settings API.
              </p>
            </form>
          </section>

          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>Audit log</h2>
              <span>Governance</span>
            </div>
            <div className="st-set-card">
              {logs.length === 0 ? (
                <EmptyState message="No recent audit events." />
              ) : (
                logs.map((log) => (
                  <div key={log.id || `${log.action}-${log.timestamp}`} className="st-set-audit">
                    <strong>{log.action}</strong>
                    <span>
                      {log.actorEmail}
                      {log.timestamp ? ` · ${new Date(log.timestamp).toLocaleString("en-IN")}` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="st-set-section">
            <div className="st-set-section-head">
              <h2>About</h2>
              <span>Governance</span>
            </div>
            <div className="st-set-card">
              <button type="button" className="st-set-row st-set-link" onClick={() => navigate("/admin/policies")}>
                <span className="st-set-row-ico">
                  <Lock size={18} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <span className="st-set-row-copy">
                  <strong>HR policies</strong>
                  <span>Editable company policy templates</span>
                </span>
                <ChevronRight size={18} strokeWidth={1.85} aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <button type="button" className="st-set-logout" onClick={handleLogout}>
        <LogOut size={18} strokeWidth={1.85} aria-hidden="true" />
        Log out
      </button>
      <p className="st-set-footer">{brand}</p>
    </div>
  );
}

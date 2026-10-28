import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import Pagination from "../components/Pagination";
import { useAuth } from "../context/AuthContext";
import {
  IconClose,
  IconCheck,
  IconSearch,
  IconUser,
  IconShield,
  IconMail,
  IconBriefcase,
  IconSettings,
  IconClipboardList,
  IconEye,
  IconEyeOff,
  IconAlertCircle,
  IconRefresh,
} from "../components/Icons";
import api from "../services/api";

const SETTINGS_TABS = [
  { id: "profile", label: "My Profile", icon: IconUser, badge: null },
  { id: "security", label: "Account & Security", icon: IconShield, badge: null },
  { id: "preferences", label: "My Preferences", icon: IconSettings, badge: null },
  { id: "company", label: "Workspace Settings", icon: IconBriefcase, badge: null },
  { id: "email", label: "Email & SMTP", icon: IconMail, badge: null },
  { id: "audit", label: "Audit Log", icon: IconClipboardList, badge: null },
];

export default function AdminSettings() {
  const { user, company, restoreSession } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // 1. Profile State
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");

  // 2. Security (Change Password) State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // 3. Preferences State
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [tableDensity, setTableDensity] = useState(() => {
    return localStorage.getItem("hrms_table_density") || "compact";
  });

  // 4. Company Workspace State
  const [companyName, setCompanyName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR (₹)");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [workingDays, setWorkingDays] = useState("Monday – Friday");
  const [logoPreview, setLogoPreview] = useState("");
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState("");
  const [logoSaving, setLogoSaving] = useState(false);
  const [hasSavedLogo, setHasSavedLogo] = useState(false);

  // 5. Email & SMTP Delivery State
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [hasAppPassword, setHasAppPassword] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState(null);
  const [testTo, setTestTo] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // 6. Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(10);
  const [auditTotal, setAuditTotal] = useState(0);

  // Sync profile state when user changes
  useEffect(() => {
    if (user) {
      setProfileName(user.fullName || user.name || "");
      setProfilePhone(user.phoneNumber || "");
      if (user.preferences) {
        setEmailNotifications(user.preferences.emailNotifications !== false);
        setWeeklyDigest(user.preferences.weeklyDigest !== false);
      }
    }
  }, [user]);

  // Load Company and Email Settings
  const loadInitialData = async () => {
    try {
      setLoading(true);
      setError("");

      const [compRes, emailRes] = await Promise.allSettled([
        api.get("/settings/company"),
        api.get("/settings/email"),
      ]);

      if (compRes.status === "fulfilled") {
        const c = compRes.value.data?.company || compRes.value.data?.data || {};
        setCompanyName(c.companyName || company?.companyName || "");
        setDisplayName(c.branding?.displayName || c.displayName || company?.branding?.displayName || "");
        setTimezone(c.config?.timezone || c.timezone || "Asia/Kolkata");
        setCurrency(c.config?.currencyCode || c.currency || "INR");
        setContactEmail(c.primaryContact?.email || "");
        setContactPhone(c.primaryContact?.phoneNumber || "");
        setWorkingDays(c.workingDays || "Monday – Friday");
        setHasSavedLogo(Boolean(c.branding?.logoUrl || company?.branding?.logoUrl));
      }

      if (emailRes.status === "fulfilled") {
        const s = emailRes.value.data?.emailSettings || emailRes.value.data?.data || {};
        setFromName(s.fromName || "");
        setFromEmail(s.fromEmail || "");
        setSmtpHost(s.smtpHost || "smtp.gmail.com");
        setSmtpPort(s.smtpPort || 587);
        setSmtpSecure(Boolean(s.smtpSecure));
        setHasAppPassword(Boolean(s.hasAppPassword));
        setIsConfigured(Boolean(s.isConfigured));
        setLastVerifiedAt(s.lastVerifiedAt || null);
      }
    } catch {
      // Non-fatal if specific settings not yet configured
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
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

  // Fetch Audit Logs when tab or page changes
  const fetchAuditLogs = async () => {
    try {
      setAuditLoading(true);
      const res = await api.get(
        `/settings/audit-logs?page=${auditPage}&limit=${auditPageSize}${
          auditSearch ? `&search=${encodeURIComponent(auditSearch)}` : ""
        }`
      );
      setAuditLogs(res.data?.data || []);
      setAuditTotal(res.data?.pagination?.total || 0);
    } catch {
      setAuditLogs([]);
      setAuditTotal(0);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAuditLogs();
    }
  }, [activeTab, auditPage, auditPageSize]);

  // Handler: Save My Profile
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      const res = await api.put("/auth/profile", {
        fullName: profileName.trim(),
        phoneNumber: profilePhone.trim(),
        preferences: {
          emailNotifications,
          weeklyDigest,
          compactView: tableDensity === "compact",
        },
      });

      setSuccessMsg(res.data?.message || "Profile updated successfully.");
      await restoreSession({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Change Password
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      const res = await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });

      setSuccessMsg(res.data?.message || "Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to change password. Please check your current password.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Save Preferences
  const handleSavePreferences = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      localStorage.setItem("hrms_table_density", tableDensity);

      await api.put("/auth/profile", {
        preferences: {
          emailNotifications,
          weeklyDigest,
          compactView: tableDensity === "compact",
        },
      });

      setSuccessMsg("Preferences saved successfully.");
      await restoreSession({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Save Company Settings
  const handleSaveCompany = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      const res = await api.put("/settings/company", {
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

      setSuccessMsg(res.data?.message || "Company settings updated successfully.");
      await restoreSession({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save company settings.");
    } finally {
      setSaving(false);
    }
  };

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });

  const handleLogoFileChange = (event) => {
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

    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleSaveLogo = async () => {
    if (!logoFile) return;
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
      setSuccessMsg("Company logo saved.");
      await restoreSession({ silent: true });
    } catch (err) {
      setLogoError(err.response?.data?.message || "Failed to save the company logo.");
    } finally {
      setLogoSaving(false);
    }
  };

  const handleRemoveLogo = async () => {
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
      setSuccessMsg("Company logo removed.");
    } catch (err) {
      setLogoError(err.response?.data?.message || "Failed to remove the company logo.");
    } finally {
      setLogoSaving(false);
    }
  };

  // Handler: Save SMTP Settings
  const handleSaveEmail = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setSuccessMsg("");

      const payload = {
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort),
        smtpSecure: Boolean(smtpSecure),
      };
      if (appPassword.trim()) {
        payload.appPassword = appPassword.trim();
      }

      const res = await api.put("/settings/email", payload);
      setSuccessMsg(res.data?.message || "Email settings updated successfully.");
      setAppPassword("");
      await loadInitialData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to save email settings.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Send Test Email
  const handleSendTestEmail = async () => {
    const target = testTo.trim() || fromEmail.trim() || user?.email;
    if (!target) {
      setError("Please specify a recipient email address for testing.");
      return;
    }

    try {
      setTesting(true);
      setError("");
      setSuccessMsg("");

      const res = await api.post("/settings/email/test", { to: target });
      setSuccessMsg(res.data?.message || `Test email dispatched to ${target}.`);
      setLastVerifiedAt(new Date().toISOString());
      setIsConfigured(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to dispatch test email. Check your SMTP credentials.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <main className="container-wide settings-page">
      <AppHeader
        title="Settings"
      />

      {/* Alert Notices */}
      {error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            color: "#991b1b",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <IconAlertCircle size={16} />
            <span>{error}</span>
          </span>
          <button
            type="button"
            onClick={() => setError("")}
            style={{ background: "none", border: "none", color: "#991b1b", cursor: "pointer", padding: 0 }}
            aria-label="Dismiss"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {successMsg && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 16px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            color: "#166534",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <IconCheck size={16} />
            <span>{successMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", padding: 0 }}
            aria-label="Dismiss"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`settings-nav-btn ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setError("");
                  setSuccessMsg("");
                }}
              >
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="settings-workspace">
          {/* ============================================================== */}
          {/* TAB 1: MY PROFILE                                              */}
          {/* ============================================================== */}
          {activeTab === "profile" && (
            <div>
              <div style={{ marginBottom: "20px", paddingBottom: "14px", borderBottom: "1px solid var(--hair, #e6ede8)" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                  My Profile
                </h2>
              </div>

              <form onSubmit={handleSaveProfile}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="e.g. Eleanor Vance"
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair, #e6ede8)",
                        fontSize: "13.5px",
                        background: "#ffffff",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair, #e6ede8)",
                        fontSize: "13.5px",
                        background: "#ffffff",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={user?.email || ""}
                      disabled
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair, #e6ede8)",
                        fontSize: "13.5px",
                        background: "#f8faf8",
                        color: "#64748b",
                        cursor: "not-allowed",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Role
                    </label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", height: "38px" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: "6px",
                          background: "var(--g-100, #e3f2e9)",
                          color: "var(--g-800, #155a37)",
                        }}
                      >
                        HR Administrator
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: "6px",
                          background: "#ecfdf5",
                          color: "#047857",
                        }}
                      >
                        Active Account
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: "8px 18px",
                      fontSize: "13px",
                      borderRadius: "8px",
                      background: "var(--g-800, #155a37)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: ACCOUNT & SECURITY                                      */}
          {/* ============================================================== */}
          {activeTab === "security" && (
            <div>
              <div style={{ marginBottom: "20px", paddingBottom: "14px", borderBottom: "1px solid var(--hair, #e6ede8)" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                  Account & Security
                </h2>
              </div>

              {/* Change Password Section */}
              <div
                style={{
                  marginBottom: "24px",
                  paddingBottom: "20px",
                  borderBottom: "1px solid var(--hair, #e6ede8)",
                }}
              >
                <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                  Change Password
                </h3>

                <form onSubmit={handleChangePassword}>
                  <div style={{ marginBottom: "14px", position: "relative" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Current Password
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showCurrentPass ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        style={{
                          width: "100%",
                          padding: "9px 36px 9px 12px",
                          borderRadius: "8px",
                          border: "1px solid var(--hair, #e6ede8)",
                          fontSize: "13.5px",
                          background: "#ffffff",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPass(!showCurrentPass)}
                        style={{
                          position: "absolute",
                          right: "10px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          color: "#64748b",
                          cursor: "pointer",
                          padding: 0,
                          boxShadow: "none",
                        }}
                      >
                        {showCurrentPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                        New Password (minimum 8 characters)
                      </label>
                      <div style={{ position: "relative" }}>
                        <input
                          type={showNewPass ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          required
                          minLength={8}
                          style={{
                            width: "100%",
                            padding: "9px 36px 9px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--hair, #e6ede8)",
                            fontSize: "13.5px",
                            background: "#ffffff",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPass(!showNewPass)}
                          style={{
                            position: "absolute",
                            right: "10px",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "none",
                            border: "none",
                            color: "#64748b",
                            cursor: "pointer",
                            padding: 0,
                            boxShadow: "none",
                          }}
                        >
                          {showNewPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                        Confirm New Password
                      </label>
                      <input
                        type={showNewPass ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        style={{
                          width: "100%",
                          padding: "9px 12px",
                          borderRadius: "8px",
                          border: "1px solid var(--hair, #e6ede8)",
                          fontSize: "13.5px",
                          background: "#ffffff",
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="submit"
                      disabled={saving || !currentPassword || !newPassword}
                      style={{
                        padding: "8px 18px",
                        fontSize: "13px",
                        borderRadius: "8px",
                        background: "var(--g-800, #155a37)",
                        color: "#ffffff",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {saving ? "Updating..." : "Update Password"}
                    </button>
                  </div>
                </form>
              </div>

              {/* Session Security Overview */}
              <div>
                <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                  Workspace Security & Authentication Status
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div style={{ padding: "12px", border: "1px solid var(--hair)", borderRadius: "8px", background: "#f8faf8" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                      Session Duration
                    </span>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                      8 Hours (Auto-renewal on active use)
                    </div>
                  </div>

                  <div style={{ padding: "12px", border: "1px solid var(--hair)", borderRadius: "8px", background: "#f8faf8" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                      Password Encryption
                    </span>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                      bcrypt (12 rounds) salted hashing
                    </div>
                  </div>

                  <div style={{ padding: "12px", border: "1px solid var(--hair)", borderRadius: "8px", background: "#f8faf8" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                      Role Enforcement
                    </span>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--g-800)", marginTop: "4px" }}>
                      Role-Based Access Control (RBAC) Active
                    </div>
                  </div>

                  <div style={{ padding: "12px", border: "1px solid var(--hair)", borderRadius: "8px", background: "#f8faf8" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
                      Multi-Tenant Isolation
                    </span>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--g-800)", marginTop: "4px" }}>
                      Enforced per-company partition
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: MY PREFERENCES                                          */}
          {/* ============================================================== */}
          {activeTab === "preferences" && (
            <div>
              <div style={{ marginBottom: "20px", paddingBottom: "14px", borderBottom: "1px solid var(--hair, #e6ede8)" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                  My Preferences
                </h2>
              </div>

              <form onSubmit={handleSavePreferences}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px",
                      border: "1px solid var(--hair)",
                      borderRadius: "8px",
                      background: "#fcfdfc",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                        Email Notifications
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                        Receive email alerts for leave approval requests and pending onboarding submissions.
                      </div>
                    </div>
                    <label style={{ position: "relative", display: "inline-block", width: "42px", height: "24px" }}>
                      <input
                        type="checkbox"
                        checked={emailNotifications}
                        onChange={(e) => setEmailNotifications(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          cursor: "pointer",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: emailNotifications ? "var(--g-800, #155a37)" : "#cbd5e1",
                          borderRadius: "24px",
                          transition: "0.2s",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            content: '""',
                            height: "18px",
                            width: "18px",
                            left: emailNotifications ? "20px" : "3px",
                            bottom: "3px",
                            backgroundColor: "white",
                            borderRadius: "50%",
                            transition: "0.2s",
                          }}
                        />
                      </span>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px",
                      border: "1px solid var(--hair)",
                      borderRadius: "8px",
                      background: "#fcfdfc",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                        Weekly Workforce Digest
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                        Receive a weekly workforce attendance and delivery summary every Monday morning.
                      </div>
                    </div>
                    <label style={{ position: "relative", display: "inline-block", width: "42px", height: "24px" }}>
                      <input
                        type="checkbox"
                        checked={weeklyDigest}
                        onChange={(e) => setWeeklyDigest(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          cursor: "pointer",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: weeklyDigest ? "var(--g-800, #155a37)" : "#cbd5e1",
                          borderRadius: "24px",
                          transition: "0.2s",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            content: '""',
                            height: "18px",
                            width: "18px",
                            left: weeklyDigest ? "20px" : "3px",
                            bottom: "3px",
                            backgroundColor: "white",
                            borderRadius: "50%",
                            transition: "0.2s",
                          }}
                        />
                      </span>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px",
                      border: "1px solid var(--hair)",
                      borderRadius: "8px",
                      background: "#fcfdfc",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                        Table Display Density
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                        Information density across employee, attendance, and task listings.
                      </div>
                    </div>
                    <select
                      value={tableDensity}
                      onChange={(e) => setTableDensity(e.target.value)}
                      style={{
                        padding: "7px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13px",
                        fontWeight: 600,
                        background: "#ffffff",
                      }}
                    >
                      <option value="compact">Compact (Standard)</option>
                      <option value="comfortable">Comfortable</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: "8px 18px",
                      fontSize: "13px",
                      borderRadius: "8px",
                      background: "var(--g-800, #155a37)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving..." : "Save Preferences"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: COMPANY WORKSPACE                                       */}
          {/* ============================================================== */}
          {activeTab === "company" && (
            <div>
              <div style={{ marginBottom: "20px", paddingBottom: "14px", borderBottom: "1px solid var(--hair, #e6ede8)" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                  Workspace Settings
                </h2>
              </div>

              {/* Operational Policies Cross-Link Banner */}
              <div
                style={{
                  background: "var(--g-100, #e3f2e9)",
                  border: "1px solid rgba(39, 134, 90, 0.28)",
                  borderRadius: "10px",
                  padding: "14px 18px",
                  marginBottom: "22px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--g-950, #0d3a23)" }}>
                  Attendance, leave, and payroll policies are managed in Policies.
                </div>
                <Link
                  to="/admin/policies"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    background: "var(--g-800, #155a37)",
                    color: "#ffffff",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  <span>Open Policies</span>
                  <span>→</span>
                </Link>
              </div>

              {/* Company Defaults Form */}
              <form onSubmit={handleSaveCompany}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Legal Company Name
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Display Name (sidebar)
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Acme Corp"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>
                </div>

                <div className="settings-logo-row">
                  <div className="settings-logo-preview" aria-hidden="true">
                    {logoPreview ? (
                      <img src={logoPreview} alt="" className="settings-logo-img" />
                    ) : (
                      <span className="settings-logo-fallback">Logo</span>
                    )}
                  </div>
                  <div className="settings-logo-copy">
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Company logo
                    </label>
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted)" }}>
                      PNG, JPEG, or WebP. Maximum 2 MB. Shown in the sidebar next to the company name.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label className="btn-secondary btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                        {logoPreview ? "Replace logo" : "Upload logo"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleLogoFileChange}
                          hidden
                        />
                      </label>
                      {logoFile && (
                        <button type="button" className="btn-primary btn-sm" onClick={handleSaveLogo} disabled={logoSaving}>
                          {logoSaving ? "Saving..." : "Save logo"}
                        </button>
                      )}
                      {(logoPreview || hasSavedLogo) && (
                        <button type="button" className="btn-secondary btn-sm" onClick={handleRemoveLogo} disabled={logoSaving}>
                          Remove
                        </button>
                      )}
                    </div>
                    {logoError && <p className="field-error" style={{ marginTop: 8 }}>{logoError}</p>}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Timezone
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="filter-select"
                      style={{ width: "100%" }}
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                      <option value="UTC">UTC (Coordinated Universal Time)</option>
                      <option value="America/New_York">America/New_York (EST/EDT)</option>
                      <option value="Europe/London">Europe/London (GMT/BST)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Operational Currency
                    </label>
                    <select
                      value={["INR", "USD", "EUR", "GBP", "AED"].includes(currency) ? currency : "INR"}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="filter-select"
                      style={{ width: "100%" }}
                    >
                      <option value="INR">INR — Indian Rupee (₹)</option>
                      <option value="USD">USD — US Dollar ($)</option>
                      <option value="EUR">EUR — Euro (€)</option>
                      <option value="GBP">GBP — British Pound (£)</option>
                      <option value="AED">AED — UAE Dirham</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Primary HR Contact Email
                    </label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="hr@company.com"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Office Working Days
                    </label>
                    <input
                      type="text"
                      value={workingDays}
                      onChange={(e) => setWorkingDays(e.target.value)}
                      placeholder="Monday – Friday"
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: "8px 18px",
                      fontSize: "13px",
                      borderRadius: "8px",
                      background: "var(--g-800, #155a37)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving..." : "Save Company Defaults"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: EMAIL & SMTP                                            */}
          {/* ============================================================== */}
          {activeTab === "email" && (
            <div>
              <div style={{ marginBottom: "20px", paddingBottom: "14px", borderBottom: "1px solid var(--hair, #e6ede8)" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                  Email Delivery & SMTP
                </h2>
              </div>

              {/* Status Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: isConfigured ? "#f0fdf4" : "#fffbeb",
                  border: `1px solid ${isConfigured ? "#bbf7d0" : "#fef3c7"}`,
                  marginBottom: "20px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: isConfigured ? "#166534" : "#92400e" }}>
                    {isConfigured ? "SMTP Gateway Configured & Active" : "SMTP Gateway Not Yet Verified"}
                  </div>
                  {lastVerifiedAt && (
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                      Last verified delivery: {new Date(lastVerifiedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "20px",
                    background: isConfigured ? "#166534" : "#92400e",
                    color: "#ffffff",
                  }}
                >
                  {isConfigured ? "VERIFIED" : "PENDING TEST"}
                </span>
              </div>

              <form onSubmit={handleSaveEmail}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Sender Name (From Name)
                    </label>
                    <input
                      type="text"
                      value={fromName}
                      onChange={(e) => setFromName(e.target.value)}
                      placeholder="e.g. Acme People Team"
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Sender Email (From Address)
                    </label>
                    <input
                      type="email"
                      value={fromEmail}
                      onChange={(e) => setFromEmail(e.target.value)}
                      placeholder="e.g. notifications@acme.com"
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "16px", marginBottom: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      SMTP Host
                    </label>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                      Port
                    </label>
                    <input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      placeholder="587"
                      required
                      style={{
                        width: "100%",
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    App Password / SMTP Secret
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={appPassword}
                      onChange={(e) => setAppPassword(e.target.value)}
                      placeholder={hasAppPassword ? "•••••••••••• (Leave blank to keep current secret)" : "Enter 16-character SMTP password"}
                      style={{
                        width: "100%",
                        padding: "9px 36px 9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair)",
                        fontSize: "13.5px",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        color: "#64748b",
                        cursor: "pointer",
                        padding: 0,
                        boxShadow: "none",
                      }}
                    >
                      {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Actions: Save & Test Email */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="email"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      placeholder="recipient@example.com"
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--hair)",
                        fontSize: "12.5px",
                        width: "220px",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSendTestEmail}
                      disabled={testing}
                      style={{
                        padding: "7px 12px",
                        fontSize: "12.5px",
                        borderRadius: "6px",
                        background: "#ffffff",
                        border: "1px solid var(--hair)",
                        color: "var(--ink)",
                        fontWeight: 600,
                        cursor: "pointer",
                        boxShadow: "none",
                      }}
                    >
                      {testing ? "Testing..." : "Send Test Email"}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: "8px 18px",
                      fontSize: "13px",
                      borderRadius: "8px",
                      background: "var(--g-800, #155a37)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving..." : "Save SMTP Gateway"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 6: AUDIT LOG                                               */}
          {/* ============================================================== */}
          {activeTab === "audit" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "16px",
                  paddingBottom: "14px",
                  borderBottom: "1px solid var(--hair, #e6ede8)",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--ink, #131a15)" }}>
                    Audit Log
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={fetchAuditLogs}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    background: "#ffffff",
                    border: "1px solid var(--hair)",
                    color: "var(--ink)",
                    cursor: "pointer",
                    boxShadow: "none",
                  }}
                >
                  <IconRefresh size={14} />
                  <span>Refresh</span>
                </button>
              </div>

              {/* Table */}
              <div style={{ overflowX: "auto", border: "1px solid var(--hair)", borderRadius: "8px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f8faf8", borderBottom: "1px solid var(--hair)", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", fontSize: "11px" }}>
                        Timestamp
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", fontSize: "11px" }}>
                        Action
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", fontSize: "11px" }}>
                        Actor
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", fontSize: "11px" }}>
                        IP Address
                      </th>
                      <th style={{ padding: "10px 12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", fontSize: "11px" }}>
                        Details
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLoading ? (
                      <tr>
                        <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
                          Loading audit records...
                        </td>
                      </tr>
                    ) : auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
                          No audit activity recorded yet.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log._id} style={{ borderBottom: "1px solid var(--hair)" }}>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>
                            {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--ink)" }}>
                            {log.action}
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--ink)" }}>
                            {log.userEmail || "System"}
                          </td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--muted)" }}>
                            {log.ipAddress || "—"}
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--muted)" }}>
                            {log.details ? (typeof log.details === "object" ? JSON.stringify(log.details) : String(log.details)) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Shared Pagination */}
              {auditTotal > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <Pagination
                    currentPage={auditPage}
                    totalRecords={auditTotal}
                    pageSize={auditPageSize}
                    pageSizeOptions={[10, 25, 50]}
                    onPageChange={(p) => setAuditPage(p)}
                    onPageSizeChange={(sz) => {
                      setAuditPageSize(sz);
                      setAuditPage(1);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

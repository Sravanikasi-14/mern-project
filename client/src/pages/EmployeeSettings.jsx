import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import ProfilePhotoField from "../components/ProfilePhotoField";
import { invalidateProfile } from "../lib/queryKeys";
import { useAuth } from "../context/AuthContext";
import {
  IconClose,
  IconCheck,
  IconUser,
  IconShield,
  IconMail,
  IconSettings,
  IconEye,
  IconEyeOff,
  IconAlertCircle,
} from "../components/Icons";
import api from "../services/api";

const EMPLOYEE_SETTINGS_TABS = [
  { id: "security", label: "Security", icon: IconShield },
  { id: "notifications", label: "Notifications", icon: IconMail },
  { id: "preferences", label: "Preferences", icon: IconSettings },
  { id: "account", label: "My Profile", icon: IconUser },
];

export default function EmployeeSettings() {
  const { user, company, restoreSession, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("security");
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Security (Change Password) State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // Preferences State
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [tableDensity, setTableDensity] = useState(() => {
    return localStorage.getItem("hrms_table_density") || "compact";
  });

  useEffect(() => {
    setProfileName(user?.fullName || user?.name || "");
    setProfilePhone(user?.phoneNumber || "");
  }, [user?.fullName, user?.name, user?.phoneNumber]);

  useEffect(() => {
    if (user?.preferences) {
      setEmailNotifications(user.preferences.emailNotifications !== false);
      setWeeklyDigest(user.preferences.weeklyDigest !== false);
      if (user.preferences.compactView !== undefined) {
        setTableDensity(user.preferences.compactView ? "compact" : "comfortable");
      }
    }
  }, [user]);

  useEffect(() => {
    const density = tableDensity === "comfortable" ? "comfortable" : "compact";
    document.documentElement.dataset.tableDensity = density;
    localStorage.setItem("hrms_table_density", density);
  }, [tableDensity]);

  // Handler: Change Password
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!currentPassword || !newPassword) {
      setError("Please provide your current password and new password.");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match. Please verify and try again.");
      return;
    }

    try {
      setSaving(true);
      const res = await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });

      setSuccessMsg(res.data?.message || "Password changed successfully! Your account is secured.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to change password. Please check your current password.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Save My Profile (name / phone; synced to the linked Employee record by the server)
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!profileName.trim()) {
      setError("Full name cannot be empty.");
      return;
    }
    try {
      setSaving(true);
      const res = await api.put("/auth/profile", {
        fullName: profileName.trim(),
        phoneNumber: profilePhone.trim(),
      });
      if (res.data?.user && restoreSession) {
        await restoreSession({ silent: true });
      }
      invalidateProfile(queryClient);
      setSuccessMsg(res.data?.message || "Profile updated successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Save Notification Preferences
  const handleSaveNotifications = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    try {
      setSaving(true);
      const res = await api.put("/auth/profile", {
        preferences: {
          emailNotifications,
          weeklyDigest,
          compactView: tableDensity === "compact",
        },
      });

      if (res.data?.user && restoreSession) {
        await restoreSession();
      }

      setSuccessMsg("Notification preferences updated successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update notification preferences.");
    } finally {
      setSaving(false);
    }
  };

  // Handler: Save Display Preferences
  const handleSavePreferences = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    try {
      setSaving(true);
      localStorage.setItem("hrms_table_density", tableDensity);

      const res = await api.put("/auth/profile", {
        preferences: {
          emailNotifications,
          weeklyDigest,
          compactView: tableDensity === "compact",
        },
      });

      if (res.data?.user && restoreSession) {
        await restoreSession();
      }

      setSuccessMsg("Display preferences updated successfully.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update display preferences.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      navigate("/login", { replace: true });
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
        <nav className="settings-nav" aria-label="Account settings">
          {EMPLOYEE_SETTINGS_TABS.map((tab) => {
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

        <div className="settings-workspace">
          {/* TAB 1: Account & Security */}
          {activeTab === "security" && (
            <div>
              <div className="settings-panel-head">
                <h2 className="settings-panel-title">Security</h2>
              </div>

              {/* Password Change Form */}
              <form onSubmit={handleChangePassword} className="settings-form-stack">
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    Current Password
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showCurrentPass ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter your current password"
                      required
                      style={{
                        width: "100%",
                        height: "40px",
                        padding: "0 40px 0 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair, #e6ede8)",
                        fontSize: "13.5px",
                        outline: "none",
                        background: "#fafbfa",
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
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                      aria-label="Toggle password visibility"
                    >
                      {showCurrentPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    New Password
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showNewPass ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      required
                      style={{
                        width: "100%",
                        height: "40px",
                        padding: "0 40px 0 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--hair, #e6ede8)",
                        fontSize: "13.5px",
                        outline: "none",
                        background: "#fafbfa",
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
                        color: "var(--muted)",
                        cursor: "pointer",
                      }}
                      aria-label="Toggle password visibility"
                    >
                      {showNewPass ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: "22px" }}>
                  <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type your new password"
                    required
                    style={{
                      width: "100%",
                      height: "40px",
                      padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--hair, #e6ede8)",
                      fontSize: "13.5px",
                      outline: "none",
                      background: "#fafbfa",
                    }}
                  />
                </div>

                <div className="settings-actions">
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? "Updating…" : "Update Password"}
                  </button>
                </div>
              </form>

              {/* Session Overview Card */}
              <div
                style={{
                  marginTop: "32px",
                  paddingTop: "20px",
                  borderTop: "1px solid var(--hair, #e6ede8)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "14px",
                }}
              >
                <div
                  style={{
                    background: "var(--panel, #f8faf8)",
                    border: "1px solid var(--hair, #e6ede8)",
                    borderRadius: "10px",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Session Security
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                    8-Hour Rolling Validity
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                    Automated token renewal and tenant credential verification.
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--panel, #f8faf8)",
                    border: "1px solid var(--hair, #e6ede8)",
                    borderRadius: "10px",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Sign Out Everywhere
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                    Terminate Session
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="btn--emp-secondary"
                      style={{ fontSize: "12px", height: "30px", padding: "0 10px" }}
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Notifications */}
          {activeTab === "notifications" && (
            <div>
              <div className="settings-panel-head">
                <h2 className="settings-panel-title">Notifications</h2>
              </div>

              <form onSubmit={handleSaveNotifications}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid var(--hair, #e6ede8)",
                      background: "#fafbfa",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={emailNotifications}
                      onChange={(e) => setEmailNotifications(e.target.checked)}
                      style={{ marginTop: "3px", accentColor: "var(--g-700, #155a37)", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                        Email notifications
                      </div>
                      <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: "2px" }}>
                        When enabled, HRMS may email you about announcements and other account alerts that
                        support email delivery. Turn off to reduce inbox noise.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid var(--hair, #e6ede8)",
                      background: "#fafbfa",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={weeklyDigest}
                      onChange={(e) => setWeeklyDigest(e.target.checked)}
                      style={{ marginTop: "3px", accentColor: "var(--g-700, #155a37)", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                        Weekly digest preference
                      </div>
                      <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: "2px" }}>
                        Saves your preference for a weekly summary email. Delivery starts when the
                        company digest mailer is enabled for your tenant.
                      </div>
                    </div>
                  </label>
                </div>

                <div className="settings-actions">
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? "Saving…" : "Save notification preferences"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: My Preferences */}
          {activeTab === "preferences" && (
            <div>
              <div className="settings-panel-head">
                <h2 className="settings-panel-title">Preferences</h2>
              </div>
              <p className="settings-panel-lede">
                These options change how lists and tables look for you in the Employee Portal. They are
                saved to your account and applied immediately.
              </p>

              <form onSubmit={handleSavePreferences} className="settings-form-stack">
                <div style={{ marginBottom: "24px" }}>
                  <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "var(--ink)", marginBottom: "8px" }}>
                    Table &amp; list density
                  </label>
                  <p style={{ margin: "0 0 10px", fontSize: "12.5px", color: "var(--muted)", lineHeight: 1.45 }}>
                    Controls row spacing on tables and dense lists (leave, tasks, payslips, and similar).
                    Compact shows more rows; Comfortable adds breathing room.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <label
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: tableDensity === "compact" ? "2px solid var(--g-700, #155a37)" : "1px solid var(--hair, #e6ede8)",
                        background: tableDensity === "compact" ? "var(--g-50, #f0fdf4)" : "#fafbfa",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
                      <input
                        type="radio"
                        name="density"
                        value="compact"
                        checked={tableDensity === "compact"}
                        onChange={() => setTableDensity("compact")}
                        style={{ marginTop: "2px", accentColor: "var(--g-700, #155a37)" }}
                      />
                      <div>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>Compact</div>
                        <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                          Tighter row padding so more records fit on screen.
                        </div>
                      </div>
                    </label>

                    <label
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: tableDensity === "comfortable" ? "2px solid var(--g-700, #155a37)" : "1px solid var(--hair, #e6ede8)",
                        background: tableDensity === "comfortable" ? "var(--g-50, #f0fdf4)" : "#fafbfa",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
                      <input
                        type="radio"
                        name="density"
                        value="comfortable"
                        checked={tableDensity === "comfortable"}
                        onChange={() => setTableDensity("comfortable")}
                        style={{ marginTop: "2px", accentColor: "var(--g-700, #155a37)" }}
                      />
                      <div>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>Comfortable</div>
                        <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                          Larger row padding for easier scanning on smaller screens.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="settings-actions">
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? "Saving…" : "Save display preferences"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: Account Information */}
          {activeTab === "account" && (
            <div>
              <div className="settings-panel-head">
                <h2 className="settings-panel-title">My Profile</h2>
              </div>

              <ProfilePhotoField />

              <form
                onSubmit={handleSaveProfile}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    required
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--hair, #e6ede8)", fontSize: "13.5px", background: "#ffffff" }}
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
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--hair, #e6ede8)", fontSize: "13.5px", background: "#ffffff" }}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ padding: "8px 18px", fontSize: "13px", borderRadius: "8px", background: "var(--g-800, #155a37)", color: "#ffffff", border: "none", cursor: "pointer", fontWeight: 600 }}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              {/* Dedicated Profile Shortcut Card */}
              <div
                style={{
                  background: "var(--g-50, #f0fdf4)",
                  border: "1px solid var(--g-200, #bbf7d0)",
                  borderRadius: "10px",
                  padding: "14px 18px",
                  marginBottom: "24px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--g-900, #0d3a23)" }}>
                  Personal details and bank information are managed in your Profile.
                </div>
                <Link
                  to="/app/profile"
                  className="btn--primary-fern"
                  style={{ fontSize: "13px", whiteSpace: "nowrap" }}
                >
                  Profile →
                </Link>
              </div>

              {/* Concise Read-Only Summary */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "16px",
                  background: "#fafbfa",
                  border: "1px solid var(--hair, #e6ede8)",
                  borderRadius: "10px",
                  padding: "18px",
                }}
              >
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Corporate Email
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                    {user?.email || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Role
                  </div>
                  <div style={{ marginTop: "4px", display: "flex", gap: "6px" }}>
                    <span className="emp-badge-pill emp-badge-pill--green">
                      Employee
                    </span>
                    <span className="emp-badge-pill">
                      Active
                    </span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Workspace
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)", marginTop: "4px" }}>
                    {company?.companyName || "Organization"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

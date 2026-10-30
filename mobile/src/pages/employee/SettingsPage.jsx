import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Toggle from "../../components/Toggle";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import Icon from "../../components/Icon";
import { useAuth } from "../../app/AuthContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

export default function EmployeeSettingsPage() {
  const navigate = useNavigate();
  const { user, logout, restoreSession } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailNotifications, setEmailNotifications] = useState(user?.preferences?.emailNotifications !== false);
  const [weeklyDigest, setWeeklyDigest] = useState(user?.preferences?.weeklyDigest !== false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);

  const closePassword = useCallback(() => {
    setPasswordOpen(false);
    setPasswordError("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, []);

  const changePassword = async (event) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      setPasswordError("Please provide your current password and new password.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    try {
      setSaving(true);
      setPasswordError("");
      await api.post("/auth/change-password", { currentPassword, newPassword, confirmPassword });
      toast.push("Password updated.");
      closePassword();
    } catch (err) {
      setPasswordError(err.response?.data?.message || "Could not update password.");
    } finally {
      setSaving(false);
    }
  };

  const savePreferences = async (next) => {
    const previous = { emailNotifications, weeklyDigest };
    setEmailNotifications(next.emailNotifications);
    setWeeklyDigest(next.weeklyDigest);
    setError("");
    try {
      setPrefSaving(true);
      await api.put("/auth/profile", {
        preferences: {
          emailNotifications: next.emailNotifications,
          weeklyDigest: next.weeklyDigest,
          compactView: Boolean(user?.preferences?.compactView),
        },
      });
      await restoreSession({ silent: true });
      toast.push("Preferences saved.");
    } catch (err) {
      setEmailNotifications(previous.emailNotifications);
      setWeeklyDigest(previous.weeklyDigest);
      setError(err.response?.data?.message || "Could not save preferences.");
    } finally {
      setPrefSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      const res = await logout();
      navigate("/login", {
        replace: true,
        state: res?.serverRevoked ? undefined : { logoutWarning: "You have been signed out." },
      });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="st-page">
      <PageHeader title="Settings" back />
      {error ? <div className="alert alert-error">{error}</div> : null}

      <section>
        <h2 className="st-heading">Account</h2>
        <div className="st-card">
          <button type="button" className="st-row" onClick={() => navigate("/app/profile")}>
            <span className="st-ico"><Icon name="profile" /></span>
            <span className="st-row-body">
              <strong>Personal Information</strong>
              <em>{user?.email || "View and edit your profile"}</em>
            </span>
            <span className="chevron" aria-hidden="true" />
          </button>
          <button type="button" className="st-row" onClick={() => setPasswordOpen(true)}>
            <span className="st-ico"><Icon name="lock" /></span>
            <span className="st-row-body">
              <strong>Change Password</strong>
            </span>
            <span className="chevron" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section>
        <h2 className="st-heading">Notifications</h2>
        <div className="st-card st-card-pad">
          <Toggle
            label="Email notifications"
            description="Account and workflow emails."
            checked={emailNotifications}
            onChange={(next) => savePreferences({ emailNotifications: next, weeklyDigest })}
            disabled={prefSaving}
          />
          <Toggle
            label="Weekly digest"
            description="A weekly summary of attendance, leave, and tasks."
            checked={weeklyDigest}
            onChange={(next) => savePreferences({ emailNotifications, weeklyDigest: next })}
            disabled={prefSaving}
          />
        </div>
      </section>

      <button type="button" className="st-signout" onClick={() => setLogoutOpen(true)}>
        <Icon name="logout" size={18} />
        Sign out from this device
      </button>

      <Modal
        open={passwordOpen}
        onClose={closePassword}
        title="Change Password"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closePassword} disabled={saving}>Cancel</button>
            <button type="submit" form="st-password-form" className="btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Update password"}
            </button>
          </>
        }
      >
        {passwordError ? <div className="alert alert-error">{passwordError}</div> : null}
        <form id="st-password-form" className="form-grid" onSubmit={changePassword}>
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={logoutOpen}
        onClose={closeLogout}
        title="Sign out"
        message="You will need to sign in again to continue."
        confirmLabel="Sign out"
        danger
        busy={loggingOut}
        onConfirm={handleLogout}
      />
    </div>
  );
}

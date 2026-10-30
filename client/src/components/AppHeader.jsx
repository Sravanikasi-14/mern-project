import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationPanel from "./NotificationPanel";
import { IconBell, IconLogOut } from "./EmployeeIcon";

export default function AppHeader({ title, subtitle, children, actions, hideLogout = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleLogout = async () => {
    try {
      const res = await logout();
      if (res && !res.serverRevoked) {
        navigate("/login", {
          replace: true,
          state: {
            logoutWarning: "You have been signed out.",
          },
        });
      } else {
        navigate("/login", { replace: true });
      }
    } catch {
      navigate("/login", { replace: true });
    }
  };

  const userInitial = (user?.name || user?.email || "U")[0].toUpperCase();
  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const displayRole = user?.role === "HR_ADMIN" ? "HR Admin" : "Employee";

  return (
    <header className="fernly-topbar">
      {/* Left: Title & Subtitle */}
      <div className="fernly-topbar-left">
        <h1 className="fernly-topbar-title">{title}</h1>
        {Boolean(subtitle) && (
          <p className="fernly-topbar-sub">{subtitle}</p>
        )}
      </div>

      {/* Right: Actions, Notifications & Profile Chip */}
      <div className="fernly-topbar-actions">
        {actions || children}

        {/* Notifications Button & Popover */}
        <div className="fernly-notification-wrap" style={{ position: "relative" }}>
          <button
            type="button"
            className="fernly-icon-btn fernly-notification-btn"
            title="Notifications"
            aria-label="Notifications"
            aria-expanded={isNotifOpen}
            onClick={() => setIsNotifOpen((prev) => !prev)}
          >
            {user?.role === "EMPLOYEE" ? (
              <IconBell size={22} strokeWidth={isNotifOpen ? 2.15 : 1.75} />
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            )}
            {unreadCount > 0 && (
              <span className="fernly-notification-dot" aria-label={`${unreadCount} unread`}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          <NotificationPanel
            isOpen={isNotifOpen}
            onClose={() => setIsNotifOpen(false)}
            onCountChange={(count) => setUnreadCount(count)}
          />
        </div>

        {/* Profile Pill */}
        <div className="fernly-profile-chip" title={`${displayName} (${user?.email})`}>
          <span className="fernly-avatar">{userInitial}</span>
          <div className="fernly-profile-info">
            <span className="fernly-profile-name">{displayName}</span>
            <span className="fernly-profile-role">{displayRole}</span>
          </div>
        </div>

        {!hideLogout && (
          <button
            type="button"
            className="fernly-logout-btn"
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
          >
            {user?.role === "EMPLOYEE" ? (
              <IconLogOut size={16} />
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            )}
          </button>
        )}
      </div>
    </header>
  );
}

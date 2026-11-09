import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationPanel from "./NotificationPanel";
import GlobalSearch from "./GlobalSearch";
import PageIdentity from "./PageIdentity";
import AuthedAvatar from "./AuthedAvatar";
import { IconBell, IconLogOut } from "./EmployeeIcon";

/**
 * Shared authenticated portal chrome.
 *
 * Row 1 (sticky): [leading] [expandable GlobalSearch] [page actions + utilities]
 * Row 2: PageIdentity (title / subtitle / optional nav)
 *
 * Page-local ModuleToolbar search stays on the tools row under identity —
 * intentionally separate from GlobalSearch, never competing in the same bar.
 */
export default function AppHeader({
  title,
  subtitle,
  leading = null,
  nav = null,
  children,
  actions,
  hideLogout = false,
  hideGlobalSearch = false,
  hidePageIdentity = false,
}) {
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

  const userInitial = (user?.fullName || user?.name || user?.email || "U")[0].toUpperCase();
  const displayName = user?.fullName || user?.name || user?.email?.split("@")[0] || "User";
  // "My Profile" entry: employees use their profile page; HR / Company Admin use Settings → Profile.
  const myProfilePath = user?.role === "EMPLOYEE" ? "/app/profile" : "/admin/settings?tab=profile";
  const displayRole =
    user?.role === "HR_ADMIN"
      ? "HR Admin"
      : user?.role === "COMPANY_ADMIN"
        ? "Company Admin"
        : "Employee";

  const pageActions = actions || children;
  const showIdentity = !hidePageIdentity && Boolean(title || subtitle || nav);

  return (
    <>
      <header className="fernly-topbar" data-toolbar="global">
        <div className={`fernly-topbar-leading${leading ? "" : " is-empty"}`}>
          {leading}
        </div>

        {!hideGlobalSearch ? (
          <GlobalSearch className="fernly-topbar-search" />
        ) : (
          <div className="fernly-topbar-search fernly-topbar-search--spacer" aria-hidden="true" />
        )}

        <div className="fernly-topbar-actions">
          {pageActions}

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
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
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

          <Link
            to={myProfilePath}
            className="fernly-profile-chip fernly-profile-chip--link"
            title={`My Profile — ${displayName} (${user?.email})`}
            aria-label="My Profile"
          >
            <AuthedAvatar
              className="fernly-avatar"
              src={user?.avatar}
              initials={userInitial}
              alt={displayName}
            />
            <div className="fernly-profile-info">
              <span className="fernly-profile-name">{displayName}</span>
              <span className="fernly-profile-role">{displayRole}</span>
            </div>
          </Link>

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
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              )}
            </button>
          )}
        </div>
      </header>

      {showIdentity ? (
        <PageIdentity title={title} subtitle={subtitle}>
          {nav}
        </PageIdentity>
      ) : null}
    </>
  );
}

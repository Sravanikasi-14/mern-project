import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const HR_NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "people",
    label: "People Management",
    path: "/admin",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "attendance",
    label: "Attendance Tracking",
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "leave",
    label: "Leave Management",
    path: "/admin/leave",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    id: "payroll",
    label: "Payroll & Payslips",
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <circle cx="7" cy="15" r="1.5" />
        <line x1="12" y1="15" x2="17" y2="15" />
      </svg>
    ),
  },
  {
    id: "assets",
    label: "Company Assets",
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "policies",
    label: "Company HR Policies",
    path: null,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

const EMPLOYEE_NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: "/app",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "My Profile",
    path: "/app/profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "attendance",
    label: "My Attendance",
    path: "/app/attendance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "leave",
    label: "My Leave",
    path: "/app/leave",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    id: "payslips",
    label: "My Payslips",
    path: "/app/payslips",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <circle cx="7" cy="15" r="1.5" />
        <line x1="12" y1="15" x2="17" y2="15" />
      </svg>
    ),
  },
  {
    id: "assets",
    label: "My Assets",
    path: "/app/assets",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Account Settings",
    path: "/app/settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  onNotifyModule,
}) {
  const { user, company, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = user?.role === "HR_ADMIN" ? HR_NAV_ITEMS : EMPLOYEE_NAV_ITEMS;

  // Determine which item is active based on current role and pathname
  const isItemActive = (item) => {
    if (user?.role === "HR_ADMIN") {
      if (item.path && (location.pathname === item.path || location.pathname.startsWith(item.path + "/"))) {
        return true;
      }
      if (item.id === "people") {
        return (
          location.pathname === "/admin" ||
          location.pathname.startsWith("/admin/employees")
        );
      }
      return false;
    }

    // EMPLOYEE Role:
    if (item.id === "dashboard") {
      return location.pathname === "/app";
    }
    if (item.path) {
      return (
        location.pathname === item.path ||
        location.pathname.startsWith(item.path + "/")
      );
    }
    return false;
  };

  const handleItemClick = (item) => {
    if (onCloseMobile) {
      onCloseMobile();
    }

    if (item.path) {
      if (location.pathname !== item.path) {
        navigate(item.path);
      }
    } else {
      if (onNotifyModule) {
        onNotifyModule(item.label);
      }
    }
  };

  const userInitial = (user?.name || user?.email || "U")[0].toUpperCase();
  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const displayRole = user?.role === "HR_ADMIN" ? "HR Admin" : "Employee";

  return (
    <aside
      className={`sidebar-container ${collapsed ? "collapsed" : ""} ${
        mobileOpen ? "mobile-open" : ""
      }`}
      aria-label="Main Navigation"
    >
      {/* Brand Identity / Top Header */}
      <div className="sidebar-brand-wrapper">
        <div className="sidebar-brand">
          <div className="brand-logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          {!collapsed && (
            <div className="brand-text-block">
              <span className="brand-title">{company?.companyName || "HRMS PORTAL"}</span>
              <span className="brand-subtitle">Enterprise Suite</span>
            </div>
          )}
        </div>

        {/* Collapse toggle button on desktop */}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>

        {/* Mobile close button */}
        <button
          type="button"
          className="sidebar-mobile-close-btn"
          onClick={onCloseMobile}
          aria-label="Close navigation"
        >
          ✕
        </button>
      </div>

      {/* Navigation List */}
      <nav className="sidebar-nav">
        <ul className="sidebar-menu-list">
          {navItems.map((item) => {
            const active = isItemActive(item);
            return (
              <li key={item.id} className="sidebar-menu-item">
                <button
                  type="button"
                  className={`sidebar-nav-btn ${active ? "active" : ""}`}
                  onClick={() => handleItemClick(item)}
                  aria-label={item.label}
                >
                  <div className={`nav-icon-container ${active ? "active-badge" : ""}`}>
                    {item.icon}
                  </div>
                  {!collapsed && (
                    <span className="nav-item-label">{item.label}</span>
                  )}
                  {!collapsed && !item.path && (
                    <span className="coming-soon-pill">Soon</span>
                  )}
                  {collapsed && (
                    <span className="sidebar-floating-tooltip" role="tooltip">
                      {item.label} {!item.path ? "(Soon)" : ""}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom Profile and Logout Section */}
      <div className="sidebar-footer">
        <div className="sidebar-user-card" title={`${displayName} (${user?.email})`}>
          <div className="sidebar-avatar" aria-hidden="true">
            {userInitial}
          </div>
          {!collapsed && (
            <div className="sidebar-user-details">
              <span className="sidebar-user-name">{displayName}</span>
              <span className="sidebar-user-role">{displayRole}</span>
            </div>
          )}
          {collapsed && (
            <span className="sidebar-floating-tooltip" role="tooltip">
              {displayName} ({displayRole})
            </span>
          )}
        </div>

        <button
          type="button"
          className="sidebar-logout-btn"
          onClick={logout}
          aria-label="Log out"
        >
          <div className="nav-icon-container">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>
          {!collapsed && <span className="logout-label">Log out</span>}
          {collapsed && (
            <span className="sidebar-floating-tooltip" role="tooltip">
              Log out
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

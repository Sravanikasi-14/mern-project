import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChatUnreadQuery } from "../hooks/useChatQueries";
import { IconClose } from "./Icons";
import { EmployeeIcon, IconLogOut } from "./EmployeeIcon";
import api from "../services/api";
import { getCompanyBrandName } from "../utils/companyBrand";
import { isSettlementsLocation, visibleHrPortalModules } from "../utils/hrPortalAccess";

const HR_NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: "/admin/dashboard",
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
    label: "Employees",
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
    id: "organization",
    label: "Organization",
    path: "/admin/organization",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="19" r="2.5" />
        <circle cx="19" cy="19" r="2.5" />
        <path d="M12 7.5v3.5" />
        <path d="M12 11h7a2 2 0 0 1 2 2v3" />
        <path d="M12 11H5a2 2 0 0 0-2 2v3" />
      </svg>
    ),
  },
  {
    id: "attendance",
    label: "Attendance",
    path: "/admin/attendance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "leave",
    label: "Leave",
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
    id: "hiring",
    label: "Hiring & Onboarding",
    path: "/admin/hiring",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    ),
  },
  {
    id: "payroll",
    label: "Payroll",
    path: "/admin/payroll",
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
    label: "Assets",
    path: "/admin/assets",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: "work-impact",
    label: "Work",
    path: "/admin/work-management",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    id: "impact-points",
    label: "Impact Points",
    path: "/admin/impact-points",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 9 8.5 12 2" />
      </svg>
    ),
  },
  {
    id: "policies-settings",
    label: "Policies & Settings",
    path: "/admin/policies",
    matchPaths: ["/admin/policies", "/admin/settings"],
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
  {
    id: "reports",
    label: "Reports",
    path: "/admin/reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
];

const SETTLEMENTS_NAV_ITEM = {
  id: "settlements",
  label: "Settlements",
  path: "/admin/payroll?tab=ff_settlements",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <circle cx="7" cy="15" r="1.5" />
      <line x1="12" y1="15" x2="17" y2="15" />
    </svg>
  ),
};

const HR_MANAGEMENT_ITEM = {
  id: "hr-management",
  label: "HR Management",
  path: "/admin/hr-management",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </svg>
  ),
};

function visibleHrNav(user, company) {
  const byId = new Map(HR_NAV_ITEMS.map((item) => [item.id, item]));
  byId.set("hr-management", HR_MANAGEMENT_ITEM);
  byId.set("settlements", SETTLEMENTS_NAV_ITEM);
  byId.set("work", byId.get("work-impact"));
  return visibleHrPortalModules(user, company).flatMap((module) => {
    const item = byId.get(module.id);
    if (!item) return [];
    return [{ ...item, id: module.id, path: module.path }];
  });
}

const EMPLOYEE_NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", path: "/app/dashboard", iconName: "dashboard" },
  { id: "messages", label: "Messages", path: "/app/messages", iconName: "messages" },
  { id: "profile", label: "Profile", path: "/app/profile", iconName: "profile" },
  { id: "directory", label: "Organization", path: "/app/directory", iconName: "directory" },
  { id: "attendance", label: "Attendance", path: "/app/attendance", iconName: "attendance" },
  { id: "leave", label: "Leave", path: "/app/leave", iconName: "leave" },
  { id: "payslips", label: "Payslips", path: "/app/payslips", iconName: "payslips" },
  { id: "assets", label: "Assets", path: "/app/assets", iconName: "assets" },
  { id: "work-impact", label: "Tasks", path: "/app/tasks", iconName: "tasks" },
  { id: "impact-points", label: "Impact Points", path: "/app/impact-points", iconName: "impact" },
  { id: "settings", label: "Settings", path: "/app/settings", iconName: "settings" },
];

function withMessages(items, path) {
  if (items.some((item) => item.id === "messages")) return items;
  const item = { id: "messages", label: "Messages", path, iconName: "messages" };
  const dashboardIndex = items.findIndex((entry) => entry.id === "dashboard");
  const next = [...items];
  next.splice(dashboardIndex >= 0 ? dashboardIndex + 1 : 0, 0, item);
  return next;
}

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
  const brandName = getCompanyBrandName(company);
  const [logoSrc, setLogoSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    async function loadLogo() {
      if (!company?.branding?.logoUrl) {
        setLogoSrc(null);
        return;
      }
      try {
        const res = await api.get("/auth/company-logo", {
          responseType: "blob",
          // Bust any intermediary caches when the storage key changes.
          params: { v: company.branding.logoUrl },
        });
        if (cancelled) return;
        if (!res.data || res.data.size === 0) {
          setLogoSrc(null);
          return;
        }
        objectUrl = URL.createObjectURL(res.data);
        setLogoSrc(objectUrl);
      } catch {
        if (!cancelled) setLogoSrc(null);
      }
    }

    loadLogo();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [company?.branding?.logoUrl]);

  const unreadQuery = useChatUnreadQuery({
    enabled: user?.role === "HR_ADMIN" || user?.role === "COMPANY_ADMIN" || user?.role === "EMPLOYEE",
  });
  const unreadCount = unreadQuery.data || 0;
  const navItems =
    user?.role === "HR_ADMIN" || user?.role === "COMPANY_ADMIN"
      ? withMessages(visibleHrNav(user, company), "/admin/messages")
      : EMPLOYEE_NAV_ITEMS;

  const handleLogout = async () => {
    try {
      const res = await logout();
      if (res && !res.serverRevoked) {
        navigate("/login", {
          replace: true,
          state: {
            logoutWarning:
              "You have been signed out.",
          },
        });
      } else {
        navigate("/login", { replace: true });
      }
    } catch {
      navigate("/login", { replace: true });
    }
  };

  // Determine which item is active based on current role and pathname
  const isItemActive = (item) => {
    const current = location.pathname;

    if (user?.role === "HR_ADMIN" || user?.role === "COMPANY_ADMIN") {
      if (item.id === "dashboard") {
        return current === "/admin/dashboard";
      }
      if (item.id === "people") {
        return (
          current === "/admin" ||
          current.startsWith("/admin/employees")
        );
      }
      if (item.id === "work" || item.id === "work-impact") {
        return (
          current === "/admin/work-management" ||
          current.startsWith("/admin/work-management/") ||
          current.startsWith("/admin/work-impact")
        );
      }
      if (item.id === "payroll") {
        return current === "/admin/payroll" && !isSettlementsLocation(current, location.search);
      }
      if (item.id === "settlements") {
        return isSettlementsLocation(current, location.search);
      }
      if (item.id === "policies" || item.id === "policies-settings") {
        return (
          current === "/admin/policies" ||
          current.startsWith("/admin/policies/") ||
          current === "/admin/settings" ||
          current.startsWith("/admin/settings/")
        );
      }
      if (item.path && !item.path.includes("?")) {
        return current === item.path || current.startsWith(item.path + "/");
      }
      return false;
    }

    // EMPLOYEE Role:
    if (item.id === "dashboard") {
      return current === "/app" || current === "/app/dashboard";
    }
    if (item.id === "profile") {
      return (
        current === "/app/profile" ||
        current.startsWith("/app/profile/") ||
        current === "/app/documents" ||
        current.startsWith("/app/documents/")
      );
    }
    if (item.id === "work-impact") {
      return (
        current === "/app/tasks" ||
        current.startsWith("/app/tasks/")
      );
    }
    if (item.path) {
      return current === item.path || current.startsWith(item.path + "/");
    }
    return false;
  };

  const handleItemClick = (item) => {
    if (onCloseMobile) {
      onCloseMobile();
    }

    if (item.path) {
      const current = `${location.pathname}${location.search || ""}`;
      if (current !== item.path) {
        // Navigating to the section root clears deep-link query state (e.g. settlementId).
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
  const displayRole =
    user?.role === "HR_ADMIN" ? "HR Admin" : user?.role === "COMPANY_ADMIN" ? "Company Admin" : "Employee";

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
          <div className={`brand-logo-icon ${logoSrc ? "has-image" : ""}`} aria-hidden="true">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt=""
                className="brand-logo-img"
                onError={() => setLogoSrc(null)}
              />
            ) : (
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="3.5" width="25" height="25" rx="8.5" />
                <path d="M16 23.5v-9" />
                <path d="M16 16c0-4.2 2.9-6.9 7-6.9 0 4.2-2.9 6.9-7 6.9Z" />
                <path d="M16 19c0-3.3-2.3-5.4-5.6-5.4 0 3.3 2.3 5.4 5.6 5.4Z" />
              </svg>
            )}
          </div>
          {!collapsed && (
            <div className="brand-text-block" title={brandName}>
              <span className="brand-title">{brandName}</span>
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
          <IconClose size={16} />
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
                    {item.iconName ? (
                      <EmployeeIcon name={item.iconName} size={20} strokeWidth={active ? 2.15 : 1.75} />
                    ) : (
                      item.icon
                    )}
                  </div>
                  {!collapsed && (
                    <span className="nav-item-label">{item.label}</span>
                  )}
                  {!collapsed && item.id === "messages" && unreadCount > 0 ? (
                    <span className="nav-unread-pill">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  ) : null}
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
          onClick={handleLogout}
          aria-label="Log out"
        >
          <div className="nav-icon-container">
            {user?.role === "EMPLOYEE" ? (
              <IconLogOut size={20} />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            )}
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

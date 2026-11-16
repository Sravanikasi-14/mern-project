import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Puzzle,
  Settings,
  Activity,
} from "lucide-react";
import { usePlatformAuth } from "../../context/PlatformAuthContext";
import "./PlatformLayout.css";

const NAV = [
  { to: "/platform", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/platform/companies", end: false, label: "Companies", icon: Building2 },
  { to: "/platform/modules", end: false, label: "Modules & Features", icon: Puzzle },
  { to: "/platform/plans", end: false, label: "Plans & Billing", icon: CreditCard },
  { to: "/platform/insights", end: false, label: "Platform Insights", icon: Activity },
  { to: "/platform/settings", end: false, label: "Settings", icon: Settings },
];

export default function PlatformLayout() {
  const { admin, logout } = usePlatformAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/platform/login", { replace: true });
  };

  return (
    <div className="pa-shell">
      <aside className="pa-sidebar" aria-label="Platform Admin navigation">
        <div className="pa-brand">
          <div className="pa-brand-mark" aria-hidden>
            <Building2 size={18} strokeWidth={2} />
          </div>
          <div>
            <div className="pa-brand-name">HRMS Platform</div>
            <div className="pa-brand-sub">Platform Admin</div>
          </div>
        </div>
        <nav className="pa-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `pa-nav-link${isActive ? " is-active" : ""}`}
              >
                <Icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="pa-sidebar-foot">
          <div className="pa-admin-meta">
            <div className="pa-admin-name">{admin?.fullName || "Platform Admin"}</div>
            <div className="pa-admin-email">{admin?.email}</div>
          </div>
          <button type="button" className="pa-logout" onClick={handleLogout}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="pa-main">
        <Outlet />
      </main>
    </div>
  );
}

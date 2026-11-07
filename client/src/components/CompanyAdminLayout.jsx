import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Building2,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getCompanyBrandName } from "../utils/companyBrand";
import api from "../services/api";
import "./CompanyAdminLayout.css";

const NAV_ITEMS = [
  { to: "/company", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/company/hr-management", label: "HR Management", end: false, icon: Users },
];

export default function CompanyAdminLayout() {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();
  const brandName = getCompanyBrandName(company) || company?.companyName || "Company";
  const [collapsed, setCollapsed] = useState(false);
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

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className={`ca-shell ${collapsed ? "ca-shell--collapsed" : ""}`}>
      <aside className="ca-sidebar" aria-label="Company Admin navigation">
        <div className="ca-sidebar-brand">
          <div className={`ca-logo ${logoSrc ? "has-image" : ""}`} aria-hidden="true">
            {logoSrc ? (
              <img src={logoSrc} alt="" className="ca-logo-img" />
            ) : (
              <Building2 size={20} strokeWidth={2} />
            )}
          </div>
          {!collapsed && (
            <div className="ca-brand-text">
              <span className="ca-brand-name">{brandName}</span>
              <span className="ca-role-badge">Company Admin</span>
            </div>
          )}
        </div>

        <nav className="ca-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `ca-nav-link${isActive ? " is-active" : ""}`
                }
                title={item.label}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="ca-sidebar-footer">
          {!collapsed && (
            <p className="ca-sidebar-user" title={user?.email || ""}>
              {user?.email || "Company Admin"}
            </p>
          )}
          <button
            type="button"
            className="ca-sidebar-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} strokeWidth={2} />
            ) : (
              <PanelLeftClose size={18} strokeWidth={2} />
            )}
            {!collapsed && <span>Collapse</span>}
          </button>
          <button
            type="button"
            className="ca-sidebar-btn ca-sidebar-btn--danger"
            onClick={handleLogout}
          >
            <LogOut size={18} strokeWidth={2} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="ca-main">
        <Outlet />
      </div>
    </div>
  );
}

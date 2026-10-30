import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import HrPortalHeader from "../../components/HrPortalHeader";
import ConfirmDialog from "../../components/ConfirmDialog";
import Icon from "../../components/Icon";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { getCompanyBrandName } from "../../utils/companyBrand";

const MODULES = [
  { id: "attendance", label: "Attendance", path: "/admin/attendance", icon: "clock", color: "#eff6ff", ink: "#2563eb" },
  { id: "live", label: "Live Tracking", path: "/admin/attendance/live", icon: "location", color: "#e3f2e9", ink: "#155a37" },
  { id: "leave", label: "Leave Management", path: "/admin/leave", icon: "leave", color: "#fdf3e2", ink: "#b06d0a" },
  { id: "payroll", label: "Payroll", path: "/admin/payroll", icon: "payroll", color: "#e3f2e9", ink: "#155a37" },
  { id: "payslips", label: "Payslips", path: "/admin/payroll", icon: "payslips", color: "#eef2ff", ink: "#4f46e5" },
  { id: "assets", label: "Company Assets", path: "/admin/assets", icon: "assets", color: "#fdf3e2", ink: "#b06d0a" },
  { id: "recruitment", label: "Recruitment", path: "/admin/offers?view=candidates", icon: "onboarding", color: "#eff6ff", ink: "#2563eb" },
  { id: "offers", label: "Offer Letters", path: "/admin/offers?view=offers", icon: "offers", color: "#eef2ff", ink: "#4f46e5" },
  { id: "onboarding", label: "Onboarding", path: "/admin/onboarding", icon: "onboarding", color: "#e3f2e9", ink: "#1d7347" },
  { id: "work", label: "Work Management", path: "/admin/work-management", icon: "work", color: "#e3f2e9", ink: "#1d7347" },
  { id: "impact", label: "Impact Points", path: "/admin/impact-points", icon: "impact", color: "#fdeceb", ink: "#c23b3b" },
  { id: "reports", label: "Reports", path: "/admin/reports", icon: "reports", color: "#e3f2e9", ink: "#155a37" },
  { id: "policies", label: "HR Policies", path: "/admin/policies", icon: "policies", color: "#eef2ff", ink: "#4f46e5" },
  { id: "company", label: "Company Profile", path: "/admin/settings", icon: "profile", color: "#eff6ff", ink: "#2563eb" },
  { id: "settings", label: "Settings", path: "/admin/settings", icon: "settings", color: "#e3f2e9", ink: "#155a37" },
];

export default function HrMorePage() {
  const navigate = useNavigate();
  const { logout, company } = useAuth();
  const openNotify = useNotify();
  const brand = getCompanyBrandName(company);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);

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

  const utilities = [
    { id: "notify", label: "Notifications", icon: "bell", action: "notify" },
    { id: "settings", label: "Settings", icon: "settings", path: "/admin/settings" },
    { id: "logout", label: "Sign out", icon: "logout", action: "logout", danger: true },
  ];

  return (
    <div className="mo-page hr-more-tiles">
      <HrPortalHeader title="More" eyebrow={brand} />

      <div className="mo-grid">
        {MODULES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="mo-card"
            onClick={() => navigate(item.path)}
          >
            <span className="mo-card-ico" style={{ background: item.color, color: item.ink }}>
              <Icon name={item.icon} size={28} />
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div className="mo-utils">
        {utilities.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mo-util${item.danger ? " is-danger" : ""}`}
            onClick={() => {
              if (item.action === "notify") openNotify();
              else if (item.action === "logout") setLogoutOpen(true);
              else navigate(item.path);
            }}
          >
            <span className="mo-util-ico">
              <Icon name={item.icon} size={22} />
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

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

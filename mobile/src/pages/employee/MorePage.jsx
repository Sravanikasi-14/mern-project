import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import ConfirmDialog from "../../components/ConfirmDialog";
import Icon from "../../components/Icon";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import api from "../../services/api";

const FEATURES = [
  { id: "tasks", label: "My Tasks", path: "/app/tasks", icon: "tasks", color: "#e3f2e9", ink: "#155a37" },
  { id: "attendance", label: "Attendance", path: "/app/attendance", icon: "clock", color: "#eff6ff", ink: "#2563eb" },
  { id: "leave", label: "Leave", path: "/app/leave", icon: "leave", color: "#fdf3e2", ink: "#b06d0a" },
  { id: "payslips", label: "My Payslips", path: "/app/payslips", icon: "payslips", color: "#e3f2e9", ink: "#155a37" },
  { id: "assets", label: "Company Assets", path: "/app/assets", icon: "assets", color: "#fdf3e2", ink: "#b06d0a" },
  { id: "policies", label: "HR Policies", path: "/app/policies", icon: "policies", color: "#e3f2e9", ink: "#1d7347" },
  { id: "profile", label: "My Profile", path: "/app/profile", icon: "profile", color: "#eff6ff", ink: "#2563eb" },
  { id: "documents", label: "Documents", path: "/app/documents", icon: "documents", color: "#e3f2e9", ink: "#155a37" },
  { id: "impact", label: "Impact Points", path: "/app/impact-points", icon: "impact", color: "#fdeceb", ink: "#c23b3b" },
];

export default function EmployeeMorePage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const openNotify = useNotify();
  const [assetCount, setAssetCount] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [assetsRes, notesRes] = await Promise.all([
        api.get("/assets/my-assets").catch(() => null),
        api.get("/notifications").catch(() => null),
      ]);
      if (!active) return;
      const assets = assetsRes?.data?.assets || assetsRes?.data?.data;
      setAssetCount(Array.isArray(assets) ? assets.length : null);
      const unread = notesRes?.data?.unreadCount;
      setUnreadCount(Number.isFinite(Number(unread)) ? Number(unread) : 0);
    })();
    return () => {
      active = false;
    };
  }, []);

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
    { id: "notify", label: "Notifications", icon: "bell", action: "notify", badge: unreadCount },
    { id: "settings", label: "Settings", icon: "settings", path: "/app/settings" },
    { id: "logout", label: "Sign out", icon: "logout", action: "logout", danger: true },
  ];

  return (
    <div className="mo-page">
      <PageHeader title="More" />

      <div className="mo-grid">
        {FEATURES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="mo-card"
            onClick={() => navigate(item.path)}
          >
            <span className="mo-card-ico" style={{ background: item.color, color: item.ink }}>
              <Icon name={item.icon} size={28} />
              {item.id === "assets" && assetCount > 0 ? (
                <span className="mo-card-badge">{assetCount > 99 ? "99+" : assetCount}</span>
              ) : null}
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
              {item.badge > 0 ? <span className="mo-card-badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
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

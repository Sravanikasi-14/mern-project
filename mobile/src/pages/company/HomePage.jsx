import { useNavigate } from "react-router-dom";
import { Building2, MessageCircle, Shield, Users } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useCallback, useState } from "react";
import { useChatUnreadQuery } from "../../hooks/useChatQueries";

const MODULES = [
  {
    id: "organization",
    label: "Organisation",
    detail: "Departments, job titles, and reporting hierarchy",
    path: "/company/organization",
    Icon: Building2,
  },
  {
    id: "hr-admins",
    label: "HR Admins",
    detail: "Review HR Admin accounts and permissions",
    path: "/company/hr-admins",
    Icon: Shield,
  },
  {
    id: "messages",
    label: "Messages",
    detail: "Company conversations synced with desktop",
    path: "/company/messages",
    Icon: MessageCircle,
  },
];

/**
 * Company Admin mobile home — module launcher (not a placeholder).
 */
export default function CompanyAdminHomePage() {
  const navigate = useNavigate();
  const { user, company, logout } = useAuth();
  const brand = company?.branding?.displayName || company?.companyName || "Company";
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const closeLogout = useCallback(() => setLogoutOpen(false), []);
  const chatUnread = Number(useChatUnreadQuery().data || 0);

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
    <main className="page-pad">
      <p className="caption" style={{ margin: "0 0 6px" }}>
        Company Admin
      </p>
      <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>{brand}</h1>
      <p className="caption" style={{ margin: "0 0 18px", lineHeight: 1.45 }}>
        Signed in as {user?.email || "Company Admin"}. Manage organisation structure and HR Admin access.
      </p>

      <div className="stack" style={{ gap: 10 }}>
        {MODULES.map((item) => {
          const ModIcon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              className="mo-card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: 14,
              }}
              onClick={() => navigate(item.path)}
            >
              <span
                className="mo-card-ico"
                style={{ background: "#e3f2e9", color: "#155a37", position: "relative" }}
              >
                <ModIcon size={18} />
                {item.id === "messages" && chatUnread > 0 ? (
                  <span className="mo-card-badge">{chatUnread > 99 ? "99+" : chatUnread}</span>
                ) : null}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block" }}>{item.label}</strong>
                <span className="caption">{item.detail}</span>
              </span>
              <Users size={16} style={{ opacity: 0.35 }} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="btn-secondary"
        style={{ marginTop: 20, width: "100%" }}
        onClick={() => setLogoutOpen(true)}
      >
        Sign out
      </button>

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
    </main>
  );
}

import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AppHeader({ title, subtitle, children, actions, hideLogout = false }) {
  const { user, company, logout } = useAuth();
  const navigate = useNavigate();

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

  return (
    <header className="app-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
      <div>
        <h1>{title}</h1>
        <p className="subtitle">
          {subtitle || `${company?.companyName || ""} · ${user?.email || ""} · ${user?.role || ""}`}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {actions || children}
        {!hideLogout && (
          <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
            Log out
          </button>
        )}
      </div>
    </header>
  );
}

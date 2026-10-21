import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AppHeader({ title }) {
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
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">
          {company?.companyName} · {user?.email} · {user?.role}
        </p>
      </div>
      <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
        Log out
      </button>
    </header>
  );
}

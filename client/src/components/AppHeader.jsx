import { useAuth } from "../context/AuthContext";

export default function AppHeader({ title }) {
  const { user, company, logout } = useAuth();

  return (
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">
          {company?.companyName} · {user?.email} · {user?.role}
        </p>
      </div>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </header>
  );
}

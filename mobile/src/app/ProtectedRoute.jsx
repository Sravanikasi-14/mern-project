import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import SessionBoot from "../components/SessionBoot";

export default function ProtectedRoute({ children, roles }) {
  const { loading, isAuthenticated, user, sessionError, restoreSession } = useAuth();
  const location = useLocation();

  if (loading) {
    return <SessionBoot label="Restoring session" />;
  }

  if (sessionError && !isAuthenticated && (sessionError.type === "network" || sessionError.type === "server")) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <h2 className="section-title">Unable to verify session</h2>
          <p className="caption" style={{ margin: "8px 0 16px" }}>{sessionError.message}</p>
          <div className="stack">
            <button type="button" className="btn-primary" onClick={() => restoreSession()}>
              Try again
            </button>
            <button type="button" className="btn-secondary" onClick={() => { window.location.href = "/login"; }}>
              Sign in again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          sessionExpired: sessionError?.type === "expired" || sessionError?.type === "forbidden",
          logoutWarning: sessionError?.message,
        }}
      />
    );
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === "HR_ADMIN" ? "/admin/dashboard" : "/app"} replace />;
  }

  return children;
}

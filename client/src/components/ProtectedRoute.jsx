import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { IconAlertCircle, IconRefresh } from "./Icons";

export default function ProtectedRoute({ children, roles }) {
  const { loading, isAuthenticated, user, sessionError, restoreSession } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="auth-restore-screen"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f4f5",
          padding: 24,
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 380,
            padding: 32,
            background: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e4e4e7",
            boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          }}
        >
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
            Restoring Session
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
            Verifying your authentication credentials securely...
          </p>
        </div>
      </div>
    );
  }

  // Handle temporary network or server failures during session restore
  if (sessionError && !isAuthenticated) {
    if (sessionError.type === "network" || sessionError.type === "server") {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f4f4f5",
            padding: 24,
          }}
        >
          <div
            style={{
              textAlign: "center",
              maxWidth: 420,
              padding: 32,
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e4e4e7",
              boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ color: "#b45309", marginBottom: 12, display: "flex", justifyContent: "center" }}>
              <IconAlertCircle size={36} />
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#09090b" }}>
              Unable to Verify Session
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "#52525b", lineHeight: 1.5 }}>
              {sessionError.message}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={restoreSession}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <IconRefresh size={14} />
                <span>Retry Connection</span>
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  window.location.href = "/login";
                }}
              >
                Sign in Again
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === "HR_ADMIN" ? "/admin" : "/app"} replace />;
  }

  return children;
}

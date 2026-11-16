import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import SessionBoot from "./SessionBoot";
import {
  firstAccessiblePath,
  locationAllowed,
} from "../utils/hrPortalAccess";

/**
 * Blocks deep links to modules that are not effectively entitled.
 * Backend APIs remain authoritative; this only keeps UX aligned.
 */
export default function ModuleEntitlementGate({ children }) {
  const { loading, user, company } = useAuth();
  const location = useLocation();

  if (loading || !user) {
    return <SessionBoot label="Checking access" />;
  }

  // Company snapshot is required to evaluate entitlements (fail closed when missing).
  if (!company) {
    return <SessionBoot label="Loading workspace" />;
  }

  const current = `${location.pathname}${location.search || ""}`;
  if (locationAllowed(user, company, location.pathname, location.search)) {
    return children;
  }

  const target = firstAccessiblePath(user, company, current);
  if (target && target !== location.pathname) {
    return <Navigate to={target} replace />;
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h2 className="section-title">Module unavailable</h2>
        <p className="caption" style={{ margin: "8px 0 0" }}>
          This area is not available for your company right now. If you believe this is a mistake,
          contact your administrator.
        </p>
      </div>
    </main>
  );
}

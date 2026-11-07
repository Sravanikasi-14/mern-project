import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SessionBoot from "./SessionBoot";
import {
  adminLocationAllowed,
  firstAccessibleHrPath,
} from "../utils/hrPortalAccess";

export default function HrModuleGate({ children }) {
  const { loading, user, company } = useAuth();
  const location = useLocation();

  if (loading || !user || (user.role === "HR_ADMIN" && !company)) {
    return <SessionBoot />;
  }

  const current = `${location.pathname}${location.search || ""}`;
  if (adminLocationAllowed(user, company, location.pathname, location.search)) {
    return children;
  }

  const target = firstAccessibleHrPath(user, company, current);
  if (target) {
    return <Navigate to={target} replace />;
  }

  return (
    <div
      style={{
        minHeight: "50vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          textAlign: "center",
          background: "#ffffff",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 12,
          boxShadow: "var(--shadow)",
          padding: "28px 24px",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
          No modules are available
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#52525b" }}>
          Your Company Admin has not granted a module you can open. Ask them to update your HR access.
        </p>
      </div>
    </div>
  );
}

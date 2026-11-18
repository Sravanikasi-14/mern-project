import { useAuth } from "../context/AuthContext";
import SessionBoot from "./SessionBoot";
import AccessDeniedPage from "./AccessDeniedPage";
import AppHeader from "./AppHeader";
import { Navigate, useLocation } from "react-router-dom";
import {
  employeeLocationAllowed,
  firstAccessibleEmployeePath,
} from "../utils/hrPortalAccess";

/**
 * Blocks employee deep links to modules that are not effectively entitled.
 * Backend APIs remain authoritative; this keeps nav/URLs aligned.
 */
export default function EmployeeModuleGate({ children }) {
  const { loading, user, company } = useAuth();
  const location = useLocation();

  if (loading || !user) {
    return <SessionBoot />;
  }

  if (user.role !== "EMPLOYEE") {
    return children;
  }

  if (!company) {
    return <SessionBoot />;
  }

  if (employeeLocationAllowed(user, company, location.pathname)) {
    return children;
  }

  const fallback = firstAccessibleEmployeePath(company, location.pathname);
  if (fallback && fallback !== location.pathname) {
    return <Navigate to={fallback} replace />;
  }

  return (
    <>
      <AppHeader hidePageIdentity />
      <AccessDeniedPage message="This area is not available for your company right now." />
    </>
  );
}

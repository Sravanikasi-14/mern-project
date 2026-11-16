import { useAuth } from "../context/AuthContext";
import SessionBoot from "./SessionBoot";
import AccessDeniedPage from "./AccessDeniedPage";
import AppHeader from "./AppHeader";
import { useLocation } from "react-router-dom";
import { adminLocationAllowed } from "../utils/hrPortalAccess";

/**
 * Module-level gate for the HR/company portal shell.
 * When a route is not permitted, render a blank Access Denied content area
 * (never the module's tables/cards). Sidebar (AppLayout) + header stay visible.
 */
export default function HrModuleGate({ children }) {
  const { loading, user, company } = useAuth();
  const location = useLocation();

  if (loading || !user || (user.role === "HR_ADMIN" && !company)) {
    return <SessionBoot />;
  }

  // Employees and other non-HR portal operators are not filtered by HR module catalog.
  if (user.role !== "HR_ADMIN" && user.role !== "COMPANY_ADMIN") {
    return children;
  }

  if (adminLocationAllowed(user, company, location.pathname, location.search)) {
    return children;
  }

  return (
    <>
      <AppHeader hidePageIdentity />
      <AccessDeniedPage message="You don't have permission to view this page." />
    </>
  );
}

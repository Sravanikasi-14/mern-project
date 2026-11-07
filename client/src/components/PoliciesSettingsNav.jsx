import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import "./PoliciesSettingsNav.css";

/**
 * Compact tabs for Policies and Account & Workspace settings.
 * Routes stay bookmarkable; chrome stays light so policy cards stay primary.
 */
export default function PoliciesSettingsNav({ active }) {
  const { user, company } = useAuth();
  const showPolicies = hrPortalAllows(user, company, "policies.view");
  const showSettings = hrPortalAllows(user, company, "settings.view");
  if (!showPolicies && !showSettings) return null;

  return (
    <div className="ps-workspace-nav" role="navigation" aria-label="Policies and settings">
      <div className="ps-workspace-tabs" role="tablist">
        {showPolicies ? (
          <NavLink
            to="/admin/policies"
            className={({ isActive }) =>
              `ps-workspace-tab${isActive || active === "policies" ? " is-active" : ""}`
            }
            end
          >
            Policies
          </NavLink>
        ) : null}
        {showSettings ? (
          <NavLink
            to="/admin/settings"
            className={({ isActive }) =>
              `ps-workspace-tab${isActive || active === "settings" ? " is-active" : ""}`
            }
          >
            Account &amp; Workspace
          </NavLink>
        ) : null}
      </div>
    </div>
  );
}

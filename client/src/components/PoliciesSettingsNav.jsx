import { useNavigate } from "react-router-dom";
import SegmentedTabs from "./SegmentedTabs";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import "./PoliciesSettingsNav.css";

/**
 * Compact workspace tabs for Policies and Account & Workspace.
 * Uses shared SegmentedTabs (sliding white indicator) like Leave / Messages.
 */
export default function PoliciesSettingsNav({ active }) {
  const navigate = useNavigate();
  const { user, company } = useAuth();
  const showPolicies = hrPortalAllows(user, company, "policies.view");
  const showSettings = hrPortalAllows(user, company, "settings.view");
  if (!showPolicies && !showSettings) return null;

  const tabs = [
    showPolicies ? { value: "policies", label: "Policies" } : null,
    showSettings ? { value: "settings", label: "Account & Workspace" } : null,
  ].filter(Boolean);

  const value =
    active === "settings" && showSettings
      ? "settings"
      : active === "policies" && showPolicies
        ? "policies"
        : tabs[0]?.value;

  return (
    <div className="ps-workspace-nav" role="navigation" aria-label="Policies and settings">
      <SegmentedTabs
        className="ps-workspace-tabs"
        ariaLabel="Policies and settings workspaces"
        tabs={tabs}
        value={value}
        onChange={(next) => {
          if (next === "policies") navigate("/admin/policies");
          else if (next === "settings") navigate("/admin/settings");
        }}
      />
    </div>
  );
}

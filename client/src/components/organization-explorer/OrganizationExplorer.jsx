import { useState } from "react";
import { Building2, FolderKanban, Network, Users } from "lucide-react";
import AppHeader from "../AppHeader";
import SoftRefresh from "../SoftRefresh";
import { resolveActiveExplorerView } from "../../hooks/organizationExplorerConfig.js";
import { useOrganizationExplorerConfigQuery } from "../../hooks/useOrganizationExplorerQueries";
import HrReportingView from "./HrReportingView";
import EmployeeReportingView from "./EmployeeReportingView";
import DepartmentsView from "./DepartmentsView";
import ProjectsView from "./ProjectsView";
import TeamsView from "./TeamsView";
import "./OrganizationExplorer.css";

const VIEW_META = {
  reporting: { label: "Reporting", icon: Network },
  teams: { label: "Teams", icon: Users },
  projects: { label: "Projects", icon: FolderKanban },
  departments: { label: "Departments", icon: Building2 },
};

/**
 * Unified Organization Explorer for HR and employees.
 * @param {{ mode: "hr" | "employee" }} props
 */
export default function OrganizationExplorer({ mode = "employee" }) {
  const isHr = mode === "hr";
  const configQuery = useOrganizationExplorerConfigQuery();
  const config = configQuery.data;
  const configReady = Boolean(config) && !configQuery.isLoading;
  const enabledViews = config?.enabledViews || [];
  const defaultView = config?.defaultView || "reporting";

  const [userView, setUserView] = useState(null);
  const activeView = resolveActiveExplorerView(userView || defaultView, enabledViews);

  const refreshing = configQuery.isFetching && Boolean(config);
  const configFailed = configQuery.isError && !config;

  const subtitle = isHr
    ? "Explore reporting structure, teams, projects, and departments."
    : "Explore how your company is organized across reporting, teams, projects, and departments.";

  return (
    <main className="container-wide org-page oe-page">
      <AppHeader title="Organization Explorer" subtitle={subtitle}>
        <SoftRefresh active={refreshing} />
      </AppHeader>

      {configQuery.isLoading && !config ? (
        <div className="org-loading">
          <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>Loading Organization Explorer…</div>
        </div>
      ) : null}

      {configFailed ? (
        <div className="org-error" role="alert">
          {configQuery.error?.response?.data?.message ||
            "Failed to load Organization Explorer settings."}{" "}
          <button type="button" className="btn-secondary btn-sm" onClick={() => configQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      {configQuery.isError && config ? (
        <div className="org-error oe-config-stale" role="status">
          Could not refresh Explorer settings. Showing the last loaded configuration.{" "}
          <button type="button" className="btn-secondary btn-sm" onClick={() => configQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      {configReady && !enabledViews.length ? (
        <div className="org-chart-empty oe-empty-config">
          No Organization Explorer views are enabled for your company. Contact HR if you need access.
        </div>
      ) : null}

      {configReady && enabledViews.length > 0 ? (
        <>
          <div className="oe-tabs" role="tablist" aria-label="Organization Explorer views">
            {enabledViews.map((key) => {
              const meta = VIEW_META[key];
              if (!meta) return null;
              const Icon = meta.icon;
              const selected = activeView === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`oe-tab${selected ? " is-active" : ""}`}
                  onClick={() => setUserView(key)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>

          <div className="oe-view-panel" role="tabpanel" key={activeView || "none"}>
            {activeView === "reporting" ? (
              isHr ? <HrReportingView /> : <EmployeeReportingView />
            ) : null}
            {activeView === "departments" ? <DepartmentsView /> : null}
            {activeView === "projects" ? <ProjectsView /> : null}
            {activeView === "teams" ? <TeamsView mode={mode} /> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

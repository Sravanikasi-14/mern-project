import { useMemo, useState } from "react";
import { FolderKanban, Network } from "lucide-react";
import {
  useOrgExplorerProjectQuery,
  useOrgExplorerProjectsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import ExplorerEmployeeCard from "./ExplorerEmployeeCard";
import ExplorerGroupSearch from "./ExplorerGroupSearch";
import ExplorerVisibleProfileModal from "./ExplorerVisibleProfileModal";

function matchesProjectSearch(project, q) {
  if (!q) return true;
  if ((project.name || "").toLowerCase().includes(q)) return true;
  if ((project.projectType || "").toLowerCase().includes(q)) return true;
  return (project.employees || []).some((emp) => {
    const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export default function ProjectsView() {
  const overviewQuery = useOrgExplorerProjectsQuery();
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState(null);
  const [profileId, setProfileId] = useState(null);

  const query = search.trim().toLowerCase();
  const projects = useMemo(() => {
    const list = overviewQuery.data?.projects || [];
    if (!query) return list;
    return list.filter((p) => matchesProjectSearch(p, query));
  }, [overviewQuery.data, query]);

  const detailQuery = useOrgExplorerProjectQuery(selectedName || "", {
    enabled: Boolean(selectedName),
  });

  const detailMatches =
    Boolean(selectedName) && detailQuery.data?.project === selectedName;
  const filteredEmployees = useMemo(() => {
    const employees = detailMatches ? detailQuery.data?.employees || [] : [];
    if (!query || !selectedName) return employees;
    return employees.filter((emp) => {
      const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""} ${emp.department || ""}`
        .toLowerCase();
      return hay.includes(query);
    });
  }, [detailMatches, detailQuery.data, query, selectedName]);

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return (
      <div className="org-loading">
        <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
        <div>Loading projects…</div>
      </div>
    );
  }

  if (overviewQuery.isError && !overviewQuery.data) {
    return (
      <div className="org-error" role="alert">
        {overviewQuery.error?.response?.data?.message || "Failed to load projects."}{" "}
        <button type="button" className="btn-secondary btn-sm" onClick={() => overviewQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const unassignedCount = overviewQuery.data?.meta?.unassignedCount ?? 0;

  return (
    <div className="oe-group-view">
      <div className="oe-group-toolbar">
        <ExplorerGroupSearch
          value={search}
          onChange={setSearch}
          placeholder="Search projects or people…"
          ariaLabel="Search projects"
        />
        <span className="oe-count">
          {projects.length} project{projects.length === 1 ? "" : "s"}
          {unassignedCount > 0 ? ` · ${unassignedCount} unassigned` : ""}
        </span>
      </div>

      <div className={`oe-split${selectedName ? " has-detail" : ""}`}>
        <section className="oe-group-list" aria-label="Projects">
          {projects.length === 0 ? (
            <div className="org-chart-empty">No projects match your search.</div>
          ) : (
            projects.map((project) => (
              <button
                key={project.name}
                type="button"
                className={`oe-group-card${selectedName === project.name ? " is-selected" : ""}`}
                onClick={() => setSelectedName(project.name)}
              >
                <span className="oe-group-icon" aria-hidden="true">
                  <FolderKanban size={18} />
                </span>
                <span className="oe-group-body">
                  <strong>{project.name}</strong>
                  <span>
                    {project.employeeCount} active employee{project.employeeCount === 1 ? "" : "s"}
                    {project.projectType ? ` · ${project.projectType}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </section>

        <section className="oe-group-detail" aria-label="Project employees">
          {!selectedName ? (
            <div className="org-chart-empty">Select a project to view assigned people.</div>
          ) : detailQuery.isLoading || (detailQuery.isFetching && !detailMatches) ? (
            <div className="org-loading">Loading people…</div>
          ) : detailQuery.isError ? (
            <div className="org-error" role="alert">
              {detailQuery.error?.response?.data?.message || "Failed to load project."}
            </div>
          ) : (
            <>
              <div className="oe-detail-head">
                <div>
                  <h2>{detailQuery.data?.project || selectedName}</h2>
                  <p>
                    {filteredEmployees.length} employee{filteredEmployees.length === 1 ? "" : "s"}
                    {detailQuery.data?.projectType
                      ? ` · ${detailQuery.data.projectType}`
                      : ""}
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedName(null)}>
                  Close
                </button>
              </div>
              {filteredEmployees.length === 0 ? (
                <p className="org-side-empty">No active employees assigned to this project.</p>
              ) : (
                <div className="oe-person-grid">
                  {filteredEmployees.map((emp) => (
                    <ExplorerEmployeeCard
                      key={emp.id}
                      employee={emp}
                      selected={profileId === emp.id}
                      onSelect={setProfileId}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <ExplorerVisibleProfileModal
        employeeId={profileId}
        open={Boolean(profileId)}
        onClose={() => setProfileId(null)}
      />
    </div>
  );
}

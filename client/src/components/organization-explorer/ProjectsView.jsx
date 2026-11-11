import { useMemo, useState } from "react";
import { ChevronRight, FolderKanban, Network } from "lucide-react";
import {
  useOrgExplorerProjectQuery,
  useOrgExplorerProjectsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import AppModal from "../AppModal";
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

  const selectedSummary = useMemo(
    () => projects.find((p) => p.name === selectedName) || null,
    [projects, selectedName]
  );

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

      <section className="oe-list-panel" aria-label="Projects">
        <div className="oe-list-head" aria-hidden="true">
          <span>Project</span>
          <span>Type</span>
          <span>Members</span>
          <span />
        </div>
        <div className="oe-list-body">
          {projects.length === 0 ? (
            <p className="oe-list-empty">No projects match your search.</p>
          ) : (
            projects.map((project) => {
              const typeLabel = project.projectType || "Unspecified type";
              return (
                <button
                  key={project.name}
                  type="button"
                  className={`oe-list-row${selectedName === project.name ? " is-selected" : ""}`}
                  onClick={() => setSelectedName(project.name)}
                >
                  <span
                    className="oe-list-primary"
                    data-mobile-meta={`${project.employeeCount} · ${typeLabel}`}
                  >
                    <span className="oe-list-icon" aria-hidden="true">
                      <FolderKanban size={16} />
                    </span>
                    <span className="oe-list-name">{project.name}</span>
                  </span>
                  <span className="oe-list-meta">{typeLabel}</span>
                  <span className="oe-list-count">
                    {project.employeeCount} member{project.employeeCount === 1 ? "" : "s"}
                  </span>
                  <ChevronRight size={16} className="oe-list-chevron" aria-hidden="true" />
                </button>
              );
            })
          )}
        </div>
      </section>

      <AppModal
        open={Boolean(selectedName)}
        onClose={() => setSelectedName(null)}
        title={detailQuery.data?.project || selectedName || "Project"}
        subtitle="Project type, assigned members, and information"
        size="lg"
        className="oe-detail-modal"
      >
        {detailQuery.isLoading || (detailQuery.isFetching && !detailMatches) ? (
          <div className="org-loading">Loading people…</div>
        ) : detailQuery.isError ? (
          <div className="org-error" role="alert">
            {detailQuery.error?.response?.data?.message || "Failed to load project."}
          </div>
        ) : (
          <>
            <p className="oe-detail-summary">
              <span>
                <strong>{filteredEmployees.length}</strong> assigned
                {filteredEmployees.length === 1 ? " employee" : " employees"}
              </span>
              {(detailQuery.data?.projectType || selectedSummary?.projectType) ? (
                <span>
                  Type:{" "}
                  <strong>
                    {detailQuery.data?.projectType || selectedSummary?.projectType}
                  </strong>
                </span>
              ) : null}
            </p>
            <div className="oe-team-section">
              <h3>Assigned members</h3>
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
            </div>
          </>
        )}
      </AppModal>

      <ExplorerVisibleProfileModal
        employeeId={profileId}
        open={Boolean(profileId)}
        onClose={() => setProfileId(null)}
      />
    </div>
  );
}

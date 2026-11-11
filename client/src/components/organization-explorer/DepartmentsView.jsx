import { useMemo, useState } from "react";
import { Building2, ChevronRight, Network } from "lucide-react";
import {
  useOrgExplorerDepartmentQuery,
  useOrgExplorerDepartmentsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import AppModal from "../AppModal";
import ExplorerEmployeeCard from "./ExplorerEmployeeCard";
import ExplorerGroupSearch from "./ExplorerGroupSearch";
import ExplorerVisibleProfileModal from "./ExplorerVisibleProfileModal";

function matchesDeptSearch(dept, q) {
  if (!q) return true;
  if ((dept.name || "").toLowerCase().includes(q)) return true;
  if ((dept.parentName || dept.parent || "").toLowerCase().includes(q)) return true;
  return (dept.employees || []).some((emp) => {
    const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function deptHierarchyLabel(dept) {
  const parent = dept.parentName || dept.parent || dept.parentDepartment;
  if (parent) return `Under ${parent}`;
  return "Top-level department";
}

export default function DepartmentsView() {
  const overviewQuery = useOrgExplorerDepartmentsQuery();
  const [search, setSearch] = useState("");
  const [selectedName, setSelectedName] = useState(null);
  const [profileId, setProfileId] = useState(null);

  const query = search.trim().toLowerCase();
  const departments = useMemo(() => {
    const list = overviewQuery.data?.departments || [];
    if (!query) return list;
    return list.filter((d) => matchesDeptSearch(d, query));
  }, [overviewQuery.data, query]);

  const detailQuery = useOrgExplorerDepartmentQuery(selectedName || "", {
    enabled: Boolean(selectedName),
  });

  const detailMatches =
    Boolean(selectedName) && detailQuery.data?.department === selectedName;
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
    () => departments.find((d) => d.name === selectedName) || null,
    [departments, selectedName]
  );

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return (
      <div className="org-loading">
        <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
        <div>Loading departments…</div>
      </div>
    );
  }

  if (overviewQuery.isError && !overviewQuery.data) {
    return (
      <div className="org-error" role="alert">
        {overviewQuery.error?.response?.data?.message || "Failed to load departments."}{" "}
        <button type="button" className="btn-secondary btn-sm" onClick={() => overviewQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="oe-group-view">
      <div className="oe-group-toolbar">
        <ExplorerGroupSearch
          value={search}
          onChange={setSearch}
          placeholder="Search departments or people…"
          ariaLabel="Search departments"
        />
        <span className="oe-count">
          {departments.length} department{departments.length === 1 ? "" : "s"}
          {overviewQuery.data?.meta?.totalEmployees != null
            ? ` · ${overviewQuery.data.meta.totalEmployees} people`
            : ""}
        </span>
      </div>

      <section className="oe-list-panel" aria-label="Departments">
        <div className="oe-list-head" aria-hidden="true">
          <span>Department</span>
          <span>Hierarchy</span>
          <span>People</span>
          <span />
        </div>
        <div className="oe-list-body">
          {departments.length === 0 ? (
            <p className="oe-list-empty">No departments match your search.</p>
          ) : (
            departments.map((dept) => {
              const hierarchy = deptHierarchyLabel(dept);
              return (
                <button
                  key={dept.name}
                  type="button"
                  className={`oe-list-row${selectedName === dept.name ? " is-selected" : ""}`}
                  onClick={() => setSelectedName(dept.name)}
                >
                  <span
                    className="oe-list-primary"
                    data-mobile-meta={`${dept.employeeCount} people · ${hierarchy}`}
                  >
                    <span className="oe-list-icon" aria-hidden="true">
                      <Building2 size={16} />
                    </span>
                    <span className="oe-list-name">{dept.name}</span>
                  </span>
                  <span className="oe-list-meta">{hierarchy}</span>
                  <span className="oe-list-count">
                    {dept.employeeCount} employee{dept.employeeCount === 1 ? "" : "s"}
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
        title={selectedName || "Department"}
        subtitle="Department hierarchy and permitted employees"
        size="lg"
        className="oe-detail-modal"
      >
        {detailQuery.isLoading || (detailQuery.isFetching && !detailMatches) ? (
          <div className="org-loading">Loading people…</div>
        ) : detailQuery.isError ? (
          <div className="org-error" role="alert">
            {detailQuery.error?.response?.data?.message || "Failed to load department."}
          </div>
        ) : (
          <>
            <p className="oe-detail-summary">
              <span>
                <strong>{filteredEmployees.length}</strong> employee
                {filteredEmployees.length === 1 ? "" : "s"}
              </span>
              {selectedSummary ? (
                <span>
                  Hierarchy: <strong>{deptHierarchyLabel(selectedSummary)}</strong>
                </span>
              ) : null}
            </p>
            <div className="oe-team-section">
              <h3>Employees</h3>
              {filteredEmployees.length === 0 ? (
                <p className="org-side-empty">No active employees in this department.</p>
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

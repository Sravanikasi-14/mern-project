import { useMemo, useState } from "react";
import { Building2, Network } from "lucide-react";
import {
  useOrgExplorerDepartmentQuery,
  useOrgExplorerDepartmentsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import ExplorerEmployeeCard from "./ExplorerEmployeeCard";
import ExplorerGroupSearch from "./ExplorerGroupSearch";
import ExplorerVisibleProfileModal from "./ExplorerVisibleProfileModal";

function matchesDeptSearch(dept, q) {
  if (!q) return true;
  if ((dept.name || "").toLowerCase().includes(q)) return true;
  return (dept.employees || []).some((emp) => {
    const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""}`.toLowerCase();
    return hay.includes(q);
  });
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

  // Ignore mismatched cached payloads if the selection changed mid-flight.
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

      <div className={`oe-split${selectedName ? " has-detail" : ""}`}>
        <section className="oe-group-list" aria-label="Departments">
          {departments.length === 0 ? (
            <div className="org-chart-empty">No departments match your search.</div>
          ) : (
            departments.map((dept) => (
              <button
                key={dept.name}
                type="button"
                className={`oe-group-card${selectedName === dept.name ? " is-selected" : ""}`}
                onClick={() => setSelectedName(dept.name)}
              >
                <span className="oe-group-icon" aria-hidden="true">
                  <Building2 size={18} />
                </span>
                <span className="oe-group-body">
                  <strong>{dept.name}</strong>
                  <span>
                    {dept.employeeCount} active employee{dept.employeeCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))
          )}
        </section>

        <section className="oe-group-detail" aria-label="Department employees">
          {!selectedName ? (
            <div className="org-chart-empty">Select a department to view its people.</div>
          ) : detailQuery.isLoading || (detailQuery.isFetching && !detailMatches) ? (
            <div className="org-loading">Loading people…</div>
          ) : detailQuery.isError ? (
            <div className="org-error" role="alert">
              {detailQuery.error?.response?.data?.message || "Failed to load department."}
            </div>
          ) : (
            <>
              <div className="oe-detail-head">
                <div>
                  <h2>{selectedName}</h2>
                  <p>
                    {filteredEmployees.length} employee{filteredEmployees.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedName(null)}>
                  Close
                </button>
              </div>
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

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import HrPortalHeader from "../../components/HrPortalHeader";
import SearchBar from "../../components/SearchBar";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";
import ProfileAvatar from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const PAGE_SIZE = 50;

const emptyHire = {
  fullName: "",
  employeeCode: "",
  email: "",
  jobTitle: "",
  department: "",
  employmentType: "Full-time",
  joiningDate: "",
  projectName: "",
  monthlySalary: "",
  password: "",
};

const emptyFilters = {
  status: "ACTIVE",
  department: "",
  jobTitle: "",
  project: "",
  sortBy: "fullName",
  sortOrder: "asc",
};

export default function HrPeoplePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [hire, setHire] = useState(emptyHire);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState({ ALL: 0, ACTIVE: 0, INACTIVE: 0 });
  const [deptOptions, setDeptOptions] = useState([]);

  const filtersActive =
    filters.status !== "ACTIVE" ||
    Boolean(filters.department) ||
    Boolean(filters.jobTitle) ||
    Boolean(filters.project) ||
    filters.sortBy !== "fullName" ||
    filters.sortOrder !== "asc";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sortBy: filters.sortBy || "fullName",
        sortOrder: filters.sortOrder || "asc",
      });
      if (search.trim()) params.set("search", search.trim());
      if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
      if (filters.department.trim()) params.set("department", filters.department.trim());
      if (filters.jobTitle.trim()) params.set("jobTitle", filters.jobTitle.trim());
      if (filters.project.trim()) params.set("project", filters.project.trim());

      const res = await api.get(`/employees?${params}`);
      const rows = res.data?.employees || [];
      const pagination = res.data?.pagination || {};
      const totalEmployees = pagination.totalEmployees ?? res.data?.total ?? rows.length;
      const pages =
        pagination.totalPages ??
        Math.max(1, Math.ceil(Number(totalEmployees || 0) / PAGE_SIZE) || 1);

      setEmployees(rows);
      setTotal(totalEmployees);
      setTotalPages(pages);

      setDeptOptions((prev) => {
        const depts = new Set(prev);
        rows.forEach((emp) => {
          const d = emp.job?.department || emp.department;
          if (d) depts.add(d);
        });
        return Array.from(depts).sort((a, b) => a.localeCompare(b));
      });
    } catch (err) {
      setError(err.response?.data?.message || "Could not load people.");
    } finally {
      setLoading(false);
    }
  }, [page, search, filters]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, filters.status, filters.department, filters.jobTitle, filters.project, filters.sortBy, filters.sortOrder]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setAddOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [all, active, inactive] = await Promise.allSettled([
          api.get("/employees", { params: { page: 1, limit: 1 } }),
          api.get("/employees", { params: { page: 1, limit: 1, status: "ACTIVE" } }),
          api.get("/employees", { params: { page: 1, limit: 1, status: "INACTIVE" } }),
        ]);
        if (cancelled) return;
        const pick = (r, fallback) =>
          r.status === "fulfilled"
            ? r.value.data?.pagination?.totalEmployees || r.value.data?.total || fallback
            : fallback;
        setCounts({
          ALL: pick(all, 0),
          ACTIVE: pick(active, 0),
          INACTIVE: pick(inactive, 0),
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openFilters = () => {
    setDraft(filters);
    setFilterOpen(true);
  };

  const applyFilters = () => {
    setFilters(draft);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setDraft(emptyFilters);
  };

  const addPerson = async (event) => {
    event.preventDefault();
    if (!hire.fullName.trim() || !hire.employeeCode.trim() || !hire.email.trim()) {
      setError("Full name, employee code, and email are required.");
      return;
    }
    try {
      setSaving(true);
      await api.post("/employees", {
        ...hire,
        fullName: hire.fullName.trim(),
        employeeCode: hire.employeeCode.trim(),
        email: hire.email.trim(),
      });
      toast.push("Person added. Invitation generated.");
      setAddOpen(false);
      setHire(emptyHire);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add this person.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="st-people">
      <HrPortalHeader title="People" eyebrow="HRMS" />

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search employees..."
        onFilter={openFilters}
        filterActive={filtersActive}
      />

      {filtersActive ? (
        <div className="st-filter-active" aria-live="polite">
          <span>
            Filters active
            {filters.status !== "ALL" ? ` · ${filters.status}` : ""}
            {filters.department ? ` · ${filters.department}` : ""}
            {filters.jobTitle ? ` · ${filters.jobTitle}` : ""}
            {filters.project ? ` · ${filters.project}` : ""}
          </span>
          <button
            type="button"
            className="hr-text-link"
            onClick={() => setFilters(emptyFilters)}
          >
            Reset
          </button>
        </div>
      ) : null}

      <div className="st-people-meta">
        <span>
          Total Headcount
          <i />
          <strong>
            {total} Team Member{total === 1 ? "" : "s"}
          </strong>
        </span>
        <span className="st-people-meta-right">{counts.ALL ? `${counts.ALL} on file` : ""}</span>
      </div>

      {loading ? (
        <Skeleton />
      ) : error && employees.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : employees.length === 0 ? (
        <EmptyState message="No team members found." actionLabel="Add Employee" onAction={() => setAddOpen(true)} />
      ) : (
        <div className="st-roster">
          {employees.map((emp, index) => {
            const title = emp.job?.jobTitle || "Team member";
            const code = emp.employeeCode || "—";
            const active = String(emp.status || "").toUpperCase() === "ACTIVE";
            return (
              <button
                key={emp._id}
                type="button"
                className={`st-roster-row${index === 0 ? " is-first" : ""}`}
                onClick={() => navigate(`/admin/employees/${emp._id}`)}
              >
                <span className="st-roster-avatar-wrap">
                  <ProfileAvatar
                    name={emp.fullName}
                    photo={emp.avatar}
                    size={44}
                    className="st-roster-avatar"
                  />
                  {active ? <span className="st-roster-online" aria-hidden="true" /> : null}
                </span>
                <span className="st-roster-body">
                  <strong>{emp.fullName}</strong>
                  <span>
                    {title}
                    <em>·</em>
                    {code}
                  </span>
                </span>
                <StatusBadge status={emp.status} />
                <ChevronRight size={18} strokeWidth={1.85} className="st-roster-chevron" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="people"
      />

      <button type="button" className="st-fab" onClick={() => setAddOpen(true)}>
        <Plus size={20} strokeWidth={2.25} aria-hidden="true" />
        Add Employee
      </button>

      <Modal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={resetFilters}>
              Reset
            </button>
            <button type="button" className="btn-primary" onClick={applyFilters}>
              Apply
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label>
            Employment status
            <select
              value={draft.status}
              onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <label>
            Department
            <input
              list="people-dept-options"
              value={draft.department}
              onChange={(e) => setDraft((prev) => ({ ...prev, department: e.target.value }))}
              placeholder="Any department"
            />
            <datalist id="people-dept-options">
              {deptOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Designation
            <input
              value={draft.jobTitle}
              onChange={(e) => setDraft((prev) => ({ ...prev, jobTitle: e.target.value }))}
              placeholder="Any designation"
            />
          </label>
          <label>
            Project
            <input
              value={draft.project}
              onChange={(e) => setDraft((prev) => ({ ...prev, project: e.target.value }))}
              placeholder="Any project"
            />
          </label>
          <label>
            Sort by
            <select
              value={draft.sortBy}
              onChange={(e) => setDraft((prev) => ({ ...prev, sortBy: e.target.value }))}
            >
              <option value="fullName">Name</option>
              <option value="employeeCode">Employee code</option>
              <option value="status">Status</option>
              <option value="joiningDate">Joining date</option>
              <option value="createdAt">Created</option>
            </select>
          </label>
          <label>
            Sort order
            <select
              value={draft.sortOrder}
              onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Employee Record"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="add-person" className="btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save Employee"}
            </button>
          </>
        }
      >
        <form id="add-person" className="form-grid" onSubmit={addPerson}>
          <p className="caption">Fast onboarding draft</p>
          <label>
            Full name
            <input value={hire.fullName} onChange={(event) => setHire((prev) => ({ ...prev, fullName: event.target.value }))} required />
          </label>
          <label>
            Designation
            <input value={hire.jobTitle} onChange={(event) => setHire((prev) => ({ ...prev, jobTitle: event.target.value }))} />
          </label>
          <label>
            Department
            <input value={hire.department} onChange={(event) => setHire((prev) => ({ ...prev, department: event.target.value }))} />
          </label>
          <label>
            Employee code
            <input value={hire.employeeCode} onChange={(event) => setHire((prev) => ({ ...prev, employeeCode: event.target.value }))} required />
          </label>
          <label>
            Email address
            <input type="email" value={hire.email} onChange={(event) => setHire((prev) => ({ ...prev, email: event.target.value }))} required />
          </label>
          <label>
            Joining date
            <input type="date" value={hire.joiningDate} onChange={(event) => setHire((prev) => ({ ...prev, joiningDate: event.target.value }))} />
          </label>
          <label>
            Monthly salary
            <input type="number" value={hire.monthlySalary} onChange={(event) => setHire((prev) => ({ ...prev, monthlySalary: event.target.value }))} />
          </label>
        </form>
      </Modal>
    </div>
  );
}

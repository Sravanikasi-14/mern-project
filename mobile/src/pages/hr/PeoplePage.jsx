import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Plus, Upload } from "lucide-react";
import EmployeeBulkImportSheet from "../../components/EmployeeBulkImportSheet";
import HrPortalHeader from "../../components/HrPortalHeader";
import SearchBar from "../../components/SearchBar";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import StatusBadge from "../../components/StatusBadge";
import ProfileAvatar from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import ReportingManagerSelect from "../../components/ReportingManagerSelect";

const PAGE_SIZE = 50;
const SEARCH_PLACEHOLDER =
  "Search name, ID, email, phone, role, dept, project or location…";

const INVITATION_STATUS_OPTIONS = [
  { value: "PENDING", label: "Invite pending" },
  { value: "ACCEPTED", label: "Invite accepted" },
  { value: "EXPIRED", label: "Invite expired" },
  { value: "DELIVERY_FAILED", label: "Delivery failed" },
];

const PROJECT_TYPE_OPTIONS = [
  { value: "MANDATE", label: "Mandate" },
  { value: "RETAIL", label: "Retail" },
  { value: "BENCH", label: "Bench" },
  { value: "INTERNAL", label: "Internal" },
];

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
  reportingManagerId: null,
  password: "",
};

const emptyFilters = {
  status: "ACTIVE",
  department: "",
  jobTitle: "",
  project: "",
  reportingManagerId: null,
  employmentType: "",
  workLocation: "",
  invitationStatus: "",
  joiningFrom: "",
  joiningTo: "",
  projectType: "",
  sortBy: "fullName",
  sortOrder: "asc",
};

function parseManagerFilterParam(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (["none", "null", "unassigned"].includes(v.toLowerCase())) return "none";
  return v;
}

function invitationStatusLabel(value) {
  return INVITATION_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

function projectTypeLabel(value) {
  return PROJECT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

function managerSubtitle(emp) {
  const mgr = emp?.job?.reportingManagerId;
  if (mgr && typeof mgr === "object" && mgr.fullName) {
    return { text: mgr.fullName, empty: false };
  }
  return { text: "No manager", empty: true };
}

function readFiltersFromParams(params) {
  const statusRaw = (params.get("status") || emptyFilters.status).toUpperCase();
  const status = ["ALL", "ACTIVE", "INACTIVE"].includes(statusRaw)
    ? statusRaw
    : emptyFilters.status;
  const invitationRaw = (params.get("invitationStatus") || "").toUpperCase();
  const invitationStatus = INVITATION_STATUS_OPTIONS.some((o) => o.value === invitationRaw)
    ? invitationRaw
    : "";
  const projectTypeRaw = (params.get("projectType") || "").toUpperCase();
  const projectType = PROJECT_TYPE_OPTIONS.some((o) => o.value === projectTypeRaw)
    ? projectTypeRaw
    : "";

  return {
    status,
    department: params.get("department") || "",
    jobTitle: params.get("jobTitle") || "",
    project: params.get("project") || "",
    reportingManagerId: parseManagerFilterParam(params.get("reportingManagerId")),
    employmentType: params.get("employmentType") || "",
    workLocation: params.get("workLocation") || "",
    invitationStatus,
    joiningFrom: params.get("joiningFrom") || "",
    joiningTo: params.get("joiningTo") || "",
    projectType,
    sortBy: params.get("sortBy") || emptyFilters.sortBy,
    sortOrder: params.get("sortOrder") || emptyFilters.sortOrder,
  };
}

function buildFilterOptionsFromPool(rows) {
  const departments = new Set();
  const titles = new Set();
  const projects = new Set();
  const employmentTypes = new Set();
  const workLocations = new Set();

  rows.forEach((emp) => {
    const dept = emp.job?.department || emp.department;
    if (dept) departments.add(String(dept).trim());
    const title = emp.job?.jobTitle || emp.jobTitle;
    if (title) titles.add(String(title).trim());
    const project = emp.job?.project?.projectName || emp.job?.projectName;
    if (project) projects.add(String(project).trim());
    const empType = emp.job?.employmentType;
    if (empType) employmentTypes.add(String(empType).trim());
    const loc = emp.job?.workLocation;
    if (loc) workLocations.add(String(loc).trim());
  });

  const collator = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return {
    departments: Array.from(departments).filter(Boolean).sort(collator),
    titles: Array.from(titles).filter(Boolean).sort(collator),
    projects: Array.from(projects).filter(Boolean).sort(collator),
    employmentTypes: Array.from(employmentTypes).filter(Boolean).sort(collator),
    workLocations: Array.from(workLocations).filter(Boolean).sort(collator),
  };
}

function countActiveFilters(filters, searchValue) {
  return (
    (filters.status !== emptyFilters.status ? 1 : 0) +
    (filters.department.trim() ? 1 : 0) +
    (filters.jobTitle.trim() ? 1 : 0) +
    (filters.project.trim() ? 1 : 0) +
    (filters.reportingManagerId ? 1 : 0) +
    (filters.employmentType.trim() ? 1 : 0) +
    (filters.workLocation.trim() ? 1 : 0) +
    (filters.invitationStatus ? 1 : 0) +
    (filters.joiningFrom || filters.joiningTo ? 1 : 0) +
    (filters.projectType ? 1 : 0) +
    (filters.sortBy !== emptyFilters.sortBy || filters.sortOrder !== emptyFilters.sortOrder
      ? 1
      : 0) +
    (searchValue.trim() ? 1 : 0)
  );
}

export default function HrPeoplePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get("page") || 1) || 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") || "");
  const [filters, setFilters] = useState(() => readFiltersFromParams(searchParams));
  const [draft, setDraft] = useState(() => readFiltersFromParams(searchParams));
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [hire, setHire] = useState(emptyHire);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState({ ALL: 0, ACTIVE: 0, INACTIVE: 0 });
  const [poolOptions, setPoolOptions] = useState({
    departments: [],
    titles: [],
    projects: [],
    employmentTypes: [],
    workLocations: [],
  });
  const skipPageResetRef = useRef(true);
  const listRequestIdRef = useRef(0);

  const filterCount = useMemo(
    () => countActiveFilters(filters, debouncedSearch),
    [filters, debouncedSearch]
  );
  const filtersActive = filterCount > 0;
  const hasChipFilters =
    Boolean(debouncedSearch.trim()) ||
    filters.status !== emptyFilters.status ||
    Boolean(filters.department.trim()) ||
    Boolean(filters.jobTitle.trim()) ||
    Boolean(filters.project.trim()) ||
    Boolean(filters.reportingManagerId) ||
    Boolean(filters.employmentType.trim()) ||
    Boolean(filters.workLocation.trim()) ||
    Boolean(filters.invitationStatus) ||
    Boolean(filters.joiningFrom || filters.joiningTo) ||
    Boolean(filters.projectType);

  // Debounce free-text search; keep existing timing / single list API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Lean filter-option pool — load once; do not refetch on search/filter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/employees", {
          params: {
            limit: 300,
            includeCompensation: false,
            sortBy: "fullName",
            sortOrder: "asc",
          },
        });
        if (cancelled) return;
        setPoolOptions(buildFilterOptionsFromPool(res.data?.employees || []));
      } catch {
        /* keep empty option lists; typed filters still work */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const requestId = ++listRequestIdRef.current;
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sortBy: filters.sortBy || "fullName",
        sortOrder: filters.sortOrder || "asc",
      });
      // Phase 4A list API accepts `search` (URL state uses `q`).
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (filters.status && filters.status !== "ALL") params.set("status", filters.status);
      if (filters.department.trim()) params.set("department", filters.department.trim());
      if (filters.jobTitle.trim()) params.set("jobTitle", filters.jobTitle.trim());
      if (filters.project.trim()) params.set("project", filters.project.trim());
      if (filters.reportingManagerId) {
        params.set("reportingManagerId", String(filters.reportingManagerId));
      }
      if (filters.employmentType.trim()) {
        params.set("employmentType", filters.employmentType.trim());
      }
      if (filters.workLocation.trim()) {
        params.set("workLocation", filters.workLocation.trim());
      }
      if (filters.invitationStatus) {
        params.set("invitationStatus", filters.invitationStatus);
      }
      if (filters.joiningFrom) params.set("joiningFrom", filters.joiningFrom);
      if (filters.joiningTo) params.set("joiningTo", filters.joiningTo);
      if (filters.projectType) params.set("projectType", filters.projectType);

      const res = await api.get(`/employees?${params}`);
      if (requestId !== listRequestIdRef.current) return;

      const rows = res.data?.employees || [];
      const pagination = res.data?.pagination || {};
      const totalEmployees = pagination.totalEmployees ?? res.data?.total ?? rows.length;
      const pages =
        pagination.totalPages ??
        Math.max(1, Math.ceil(Number(totalEmployees || 0) / PAGE_SIZE) || 1);

      setEmployees(rows);
      setTotal(totalEmployees);
      setTotalPages(pages);
    } catch (err) {
      if (requestId !== listRequestIdRef.current) return;
      setError(err.response?.data?.message || "Could not load people.");
    } finally {
      if (requestId === listRequestIdRef.current) setLoading(false);
    }
  }, [page, debouncedSearch, filters]);

  useEffect(() => {
    const t = setTimeout(load, 50);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (skipPageResetRef.current) {
      skipPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [
    debouncedSearch,
    filters.status,
    filters.department,
    filters.jobTitle,
    filters.project,
    filters.reportingManagerId,
    filters.employmentType,
    filters.workLocation,
    filters.invitationStatus,
    filters.joiningFrom,
    filters.joiningTo,
    filters.projectType,
    filters.sortBy,
    filters.sortOrder,
  ]);

  // Persist list state in the URL so Back from details restores filters/pagination.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch.trim()) next.set("q", debouncedSearch.trim());
    else next.delete("q");
    if (filters.status && filters.status !== "ACTIVE") next.set("status", filters.status);
    else next.delete("status");
    if (filters.department.trim()) next.set("department", filters.department.trim());
    else next.delete("department");
    if (filters.jobTitle.trim()) next.set("jobTitle", filters.jobTitle.trim());
    else next.delete("jobTitle");
    if (filters.project.trim()) next.set("project", filters.project.trim());
    else next.delete("project");
    if (filters.reportingManagerId === "none") next.set("reportingManagerId", "none");
    else if (filters.reportingManagerId) {
      next.set("reportingManagerId", String(filters.reportingManagerId));
    } else next.delete("reportingManagerId");
    if (filters.employmentType.trim()) next.set("employmentType", filters.employmentType.trim());
    else next.delete("employmentType");
    if (filters.workLocation.trim()) next.set("workLocation", filters.workLocation.trim());
    else next.delete("workLocation");
    if (filters.invitationStatus) next.set("invitationStatus", filters.invitationStatus);
    else next.delete("invitationStatus");
    if (filters.joiningFrom) next.set("joiningFrom", filters.joiningFrom);
    else next.delete("joiningFrom");
    if (filters.joiningTo) next.set("joiningTo", filters.joiningTo);
    else next.delete("joiningTo");
    if (filters.projectType) next.set("projectType", filters.projectType);
    else next.delete("projectType");
    if (filters.sortBy && filters.sortBy !== emptyFilters.sortBy) next.set("sortBy", filters.sortBy);
    else next.delete("sortBy");
    if (filters.sortOrder && filters.sortOrder !== emptyFilters.sortOrder) {
      next.set("sortOrder", filters.sortOrder);
    } else next.delete("sortOrder");
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, filters, page, searchParams, setSearchParams]);

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

  const clearOneFilter = (key) => {
    if (key === "search") {
      setSearch("");
      setDebouncedSearch("");
      return;
    }
    if (key === "joining") {
      setFilters((prev) => ({ ...prev, joiningFrom: "", joiningTo: "" }));
      return;
    }
    setFilters((prev) => ({
      ...prev,
      [key]:
        key === "status"
          ? emptyFilters.status
          : key === "reportingManagerId"
            ? null
            : "",
    }));
  };

  const clearAllFilters = () => {
    setFilters(emptyFilters);
    setDraft(emptyFilters);
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
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
        reportingManagerId: hire.reportingManagerId || null,
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
        placeholder={SEARCH_PLACEHOLDER}
        onFilter={openFilters}
        filterActive={filtersActive}
        filterCount={filterCount}
      />

      {hasChipFilters ? (
        <div className="st-filter-active st-filter-chips" aria-live="polite">
          <div className="st-filter-chip-row">
            {debouncedSearch.trim() ? (
              <button type="button" className="st-filter-chip" onClick={() => clearOneFilter("search")}>
                Search: {debouncedSearch.trim()}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.status !== emptyFilters.status ? (
              <button type="button" className="st-filter-chip" onClick={() => clearOneFilter("status")}>
                Status: {filters.status}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.department ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("department")}
              >
                Dept: {filters.department}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.jobTitle ? (
              <button type="button" className="st-filter-chip" onClick={() => clearOneFilter("jobTitle")}>
                Designation: {filters.jobTitle}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.project ? (
              <button type="button" className="st-filter-chip" onClick={() => clearOneFilter("project")}>
                Project: {filters.project}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.reportingManagerId === "none" ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("reportingManagerId")}
              >
                Manager: Unassigned
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.reportingManagerId && filters.reportingManagerId !== "none" ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("reportingManagerId")}
              >
                Manager: Direct reports
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.employmentType.trim() ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("employmentType")}
              >
                Type: {filters.employmentType.trim()}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.workLocation.trim() ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("workLocation")}
              >
                Location: {filters.workLocation.trim()}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.invitationStatus ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("invitationStatus")}
              >
                Invitation: {invitationStatusLabel(filters.invitationStatus)}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.joiningFrom || filters.joiningTo ? (
              <button type="button" className="st-filter-chip" onClick={() => clearOneFilter("joining")}>
                Joined: {[filters.joiningFrom, filters.joiningTo].filter(Boolean).join(" → ")}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.projectType ? (
              <button
                type="button"
                className="st-filter-chip"
                onClick={() => clearOneFilter("projectType")}
              >
                Project type: {projectTypeLabel(filters.projectType)}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
          <button type="button" className="hr-text-link" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      <div className="st-people-meta">
        <span>
          {hasChipFilters ? "Matching" : "Total Headcount"}
          <i />
          <strong>
            {total} Team Member{total === 1 ? "" : "s"}
          </strong>
        </span>
        <span className="st-people-meta-right">{counts.ALL ? `${counts.ALL} on file` : ""}</span>
        <button type="button" className="st-import-btn" onClick={() => setImportOpen(true)}>
          <Upload size={14} strokeWidth={2} aria-hidden="true" />
          Import
        </button>
      </div>

      {loading ? (
        <Skeleton />
      ) : error && employees.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : employees.length === 0 ? (
        <EmptyState
          message={
            hasChipFilters
              ? "No team members match the current search or filters."
              : "No team members found."
          }
          actionLabel={hasChipFilters ? "Clear filters" : "Add Employee"}
          onAction={hasChipFilters ? clearAllFilters : () => setAddOpen(true)}
        />
      ) : (
        <div className="st-roster">
          {employees.map((emp, index) => {
            const title = emp.job?.jobTitle || "Team member";
            const code = emp.employeeCode || "—";
            const active = String(emp.status || "").toUpperCase() === "ACTIVE";
            const manager = managerSubtitle(emp);
            return (
              <button
                key={emp._id}
                type="button"
                className={`st-roster-row${index === 0 ? " is-first" : ""}`}
                onClick={() =>
                  navigate(`/admin/employees/${emp._id}`, {
                    state: { from: `${location.pathname}${location.search || ""}` },
                  })
                }
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
                  <span className={`st-roster-mgr${manager.empty ? " is-none" : ""}`}>
                    {manager.empty ? manager.text : `Reports to ${manager.text}`}
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

      <EmployeeBulkImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          toast.push("Employees imported.");
          load();
        }}
      />

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
        <div className="form-grid st-people-filter-grid">
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
              {poolOptions.departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            Designation
            <input
              list="people-title-options"
              value={draft.jobTitle}
              onChange={(e) => setDraft((prev) => ({ ...prev, jobTitle: e.target.value }))}
              placeholder="Any designation"
            />
            <datalist id="people-title-options">
              {poolOptions.titles.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label>
            Project
            <input
              list="people-project-options"
              value={draft.project}
              onChange={(e) => setDraft((prev) => ({ ...prev, project: e.target.value }))}
              placeholder="Any project"
            />
            <datalist id="people-project-options">
              {poolOptions.projects.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <ReportingManagerSelect
            filterMode
            label="Reporting manager"
            value={draft.reportingManagerId}
            onChange={(next) => setDraft((prev) => ({ ...prev, reportingManagerId: next }))}
          />
          <label>
            Employment type
            <select
              value={draft.employmentType}
              onChange={(e) => setDraft((prev) => ({ ...prev, employmentType: e.target.value }))}
            >
              <option value="">All types</option>
              {draft.employmentType &&
              !poolOptions.employmentTypes.includes(draft.employmentType) ? (
                <option value={draft.employmentType}>{draft.employmentType}</option>
              ) : null}
              {poolOptions.employmentTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Work location
            <select
              value={draft.workLocation}
              onChange={(e) => setDraft((prev) => ({ ...prev, workLocation: e.target.value }))}
            >
              <option value="">All locations</option>
              {draft.workLocation && !poolOptions.workLocations.includes(draft.workLocation) ? (
                <option value={draft.workLocation}>{draft.workLocation}</option>
              ) : null}
              {poolOptions.workLocations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label>
            Invitation status
            <select
              value={draft.invitationStatus}
              onChange={(e) => setDraft((prev) => ({ ...prev, invitationStatus: e.target.value }))}
            >
              <option value="">All invitation statuses</option>
              {INVITATION_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project type
            <select
              value={draft.projectType}
              onChange={(e) => setDraft((prev) => ({ ...prev, projectType: e.target.value }))}
            >
              <option value="">All project types</option>
              {PROJECT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="st-people-date-range">
            <span className="st-people-date-range-label">Joining date</span>
            <div className="st-people-date-range-fields">
              <label>
                From
                <input
                  type="date"
                  value={draft.joiningFrom}
                  onChange={(e) => setDraft((prev) => ({ ...prev, joiningFrom: e.target.value }))}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={draft.joiningTo}
                  onChange={(e) => setDraft((prev) => ({ ...prev, joiningTo: e.target.value }))}
                />
              </label>
            </div>
          </div>
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
          <ReportingManagerSelect
            value={hire.reportingManagerId}
            disabled={saving}
            onChange={(nextId) => setHire((prev) => ({ ...prev, reportingManagerId: nextId }))}
          />
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

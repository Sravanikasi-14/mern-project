import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Filter,
  Maximize2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import AppModal from "../AppModal";
import AuthedAvatar from "../AuthedAvatar";
import ReportingManagerSelect from "../ReportingManagerSelect";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";
import { AccessRestrictedInline } from "../AccessRestrictedNotice";
import "../../pages/Organization.css";

const emptyFilters = {
  department: "",
  jobTitle: "",
  reportingManagerId: null,
  employmentType: "",
  status: "ALL",
  workLocation: "",
  unassignedOnly: false,
};

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function OrgAvatar({ emp, className = "org-chart-avatar" }) {
  if (!emp) return null;
  return (
    <AuthedAvatar
      className={className}
      employee={emp}
      avatar={emp.avatar}
      name={emp.fullName}
      initials={initials(emp.fullName)}
      alt={emp.fullName || "Employee"}
    />
  );
}

function departmentAccent(dept = "") {
  const raw = String(dept || "General").trim() || "General";
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  const hue = 140 + (hash % 50); // forest-adjacent greens/teals
  return `hsl(${hue} 28% 36%)`;
}

function managerNameOf(emp, byId) {
  if (!emp?.reportingManagerId) return null;
  return byId.get(emp.reportingManagerId)?.fullName || null;
}

function collectDescendants(rootId, byId) {
  const out = new Set();
  const stack = [...(byId.get(rootId)?.childIds || [])];
  while (stack.length) {
    const id = stack.pop();
    if (!id || out.has(id)) continue;
    out.add(id);
    const kids = byId.get(id)?.childIds || [];
    for (const child of kids) stack.push(child);
  }
  return out;
}

function expandAncestors(byId, employeeId, baseSet) {
  const next = new Set(baseSet);
  let cur = byId.get(employeeId)?.treeManagerId;
  let guard = 0;
  while (cur && guard < 40) {
    next.add(cur);
    cur = byId.get(cur)?.treeManagerId;
    guard += 1;
  }
  return next;
}

function matchesSearchQuery(emp, q) {
  if (!q) return false;
  const hay = `${emp.fullName || ""} ${emp.preferredName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""} ${emp.department || ""}`
    .toLowerCase();
  return hay.includes(q);
}

function employeeMatchesFilters(emp, filters, managerSubtree = null) {
  if (!emp) return false;
  if (filters.unassignedOnly) {
    return !emp.reportingManagerId && (emp.directReportCount || 0) === 0;
  }
  if (filters.reportingManagerId === "none") {
    if (emp.reportingManagerId) return false;
  } else if (filters.reportingManagerId && managerSubtree && !managerSubtree.has(emp.id)) {
    return false;
  }
  if (filters.status && filters.status !== "ALL") {
    if (String(emp.status || "").toUpperCase() !== filters.status) return false;
  }
  if (filters.department.trim()) {
    if ((emp.department || "").toLowerCase() !== filters.department.trim().toLowerCase()) return false;
  }
  if (filters.jobTitle.trim()) {
    if ((emp.jobTitle || "").toLowerCase() !== filters.jobTitle.trim().toLowerCase()) return false;
  }
  if (filters.employmentType.trim()) {
    if ((emp.employmentType || "").toLowerCase() !== filters.employmentType.trim().toLowerCase()) {
      return false;
    }
  }
  if (filters.workLocation.trim()) {
    if ((emp.workLocation || "").toLowerCase() !== filters.workLocation.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

function countActiveFilters(filters) {
  return (
    (filters.department.trim() ? 1 : 0) +
    (filters.jobTitle.trim() ? 1 : 0) +
    (filters.reportingManagerId ? 1 : 0) +
    (filters.employmentType.trim() ? 1 : 0) +
    (filters.status && filters.status !== "ALL" ? 1 : 0) +
    (filters.workLocation.trim() ? 1 : 0) +
    (filters.unassignedOnly ? 1 : 0)
  );
}

function OrgChartCard({
  emp,
  expanded,
  onToggle,
  onSelect,
  selected,
  isMatch,
  isContext,
  isFlash,
}) {
  const hasChildren = (emp.directReportCount || 0) > 0;
  const accent = departmentAccent(emp.department);
  return (
    <div
      data-org-id={emp.id}
      className={[
        "org-chart-card",
        selected ? "is-selected" : "",
        isMatch ? "is-match" : "",
        isContext ? "is-context" : "",
        isFlash ? "is-flash" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--dept-accent": accent }}
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(emp.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(emp.id);
        }
      }}
    >
      <OrgAvatar emp={emp} />
      <div className="org-chart-card-body">
        <strong>{emp.fullName}</strong>
        <span className="org-chart-title">{emp.jobTitle || "Team member"}</span>
        <span className="org-chart-meta">
          {[emp.employeeCode, emp.department].filter(Boolean).join(" · ") || "—"}
        </span>
      </div>
      {hasChildren ? (
        <button
          type="button"
          className="org-chart-expand"
          aria-label={expanded ? "Collapse team" : "Expand team"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(emp.id);
          }}
        >
          <span>{emp.directReportCount}</span>
          {expanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
        </button>
      ) : null}
    </div>
  );
}

function OrgChartBranch({
  id,
  byId,
  expandedIds,
  visibleIds,
  filtering,
  onToggle,
  onSelect,
  selectedId,
  matchIds,
  flashId,
}) {
  const emp = byId.get(id);
  if (!emp) return null;
  if (filtering && !visibleIds.has(id)) return null;

  const expanded = expandedIds.has(id);
  const childIds = (emp.childIds || []).filter((childId) =>
    filtering ? visibleIds.has(childId) : true
  );
  const isMatch = matchIds.has(id);
  const isContext = filtering && !isMatch;

  return (
    <li className="org-chart-node">
      <OrgChartCard
        emp={emp}
        expanded={expanded}
        onToggle={onToggle}
        onSelect={onSelect}
        selected={selectedId === id}
        isMatch={isMatch}
        isContext={isContext}
        isFlash={flashId === id}
      />
      {expanded && childIds.length > 0 ? (
        <ul className="org-chart-children" role="group">
          {childIds.map((childId) => (
            <OrgChartBranch
              key={childId}
              id={childId}
              byId={byId}
              expandedIds={expandedIds}
              visibleIds={visibleIds}
              filtering={filtering}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              matchIds={matchIds}
              flashId={flashId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** HR Reporting view — uses GET /employees/organization and preserves manager tools. */
export default function HrReportingView() {
  const { user, company } = useAuth();
  const canEditPeople = hrPortalAllows(user, company, "people.edit");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [savingManager, setSavingManager] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [managerSuccess, setManagerSuccess] = useState("");
  const [zoom, setZoom] = useState(1);
  const [unassignedQuery, setUnassignedQuery] = useState("");
  const searchWrapRef = useRef(null);
  const filterWrapRef = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const pendingScrollId = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await api.get("/employees/organization", { params: { status: "ALL" } });
      setData(res.data);
      setExpandedIds((prev) => {
        if (prev.size > 0 && silent) return prev;
        return new Set(res.data.hierarchyRootIds || []);
      });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load organization chart.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const emp of data?.employees || []) map.set(emp.id, emp);
    return map;
  }, [data]);

  const filterOptions = useMemo(() => {
    const departments = new Set();
    const titles = new Set();
    const employmentTypes = new Set();
    const workLocations = new Set();
    for (const emp of data?.employees || []) {
      if (emp.department) departments.add(emp.department);
      if (emp.jobTitle) titles.add(emp.jobTitle);
      if (emp.employmentType) employmentTypes.add(emp.employmentType);
      if (emp.workLocation) workLocations.add(emp.workLocation);
    }
    const collator = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
    return {
      departments: Array.from(departments).sort(collator),
      titles: Array.from(titles).sort(collator),
      employmentTypes: Array.from(employmentTypes).sort(collator),
      workLocations: Array.from(workLocations).sort(collator),
    };
  }, [data]);

  const filtering = countActiveFilters(filters) > 0;
  const filterCount = countActiveFilters(filters);

  const matchIds = useMemo(() => {
    const set = new Set();
    if (!filtering) return set;
    let managerSubtree = null;
    if (filters.reportingManagerId && filters.reportingManagerId !== "none") {
      const root = String(filters.reportingManagerId);
      managerSubtree = collectDescendants(root, byId);
      managerSubtree.add(root);
    }
    for (const emp of data?.employees || []) {
      if (employeeMatchesFilters(emp, filters, managerSubtree)) set.add(emp.id);
    }
    return set;
  }, [data, filters, filtering, byId]);

  const visibleIds = useMemo(() => {
    if (!filtering) return new Set();
    let next = new Set(matchIds);
    for (const id of matchIds) {
      next = expandAncestors(byId, id, next);
    }
    return next;
  }, [filtering, matchIds, byId]);

  const query = search.trim().toLowerCase();

  const searchMatchIds = useMemo(() => {
    const set = new Set();
    if (!query) return set;
    for (const emp of data?.employees || []) {
      if (matchesSearchQuery(emp, query)) set.add(emp.id);
    }
    return set;
  }, [data, query]);

  const searchResults = useMemo(() => {
    if (!query) return [];
    return (data?.employees || [])
      .filter((emp) => searchMatchIds.has(emp.id))
      .slice()
      .sort((a, b) =>
        (a.fullName || "").localeCompare(b.fullName || "", undefined, { sensitivity: "base" })
      );
  }, [data, searchMatchIds, query]);

  const chartHighlightIds = filtering ? matchIds : searchMatchIds;

  const stats = useMemo(() => {
    const employees = data?.employees || [];
    const active = employees.filter((e) => String(e.status || "").toUpperCase() === "ACTIVE").length;
    const unassigned = (data?.unassignedIds || []).length;
    const cycleEdgesBroken = Number(data?.meta?.cycleEdgesBroken || 0);
    return {
      total: data?.meta?.total ?? employees.length,
      active,
      unassigned,
      cycleEdgesBroken,
    };
  }, [data]);

  const visibleRootIds = useMemo(() => {
    const roots = data?.hierarchyRootIds || [];
    if (!filtering) return roots;
    return roots.filter((id) => visibleIds.has(id));
  }, [data, filtering, visibleIds]);

  const visibleUnassignedIds = useMemo(() => {
    const ids = data?.unassignedIds || [];
    if (!filtering) return ids;
    return ids.filter((id) => matchIds.has(id));
  }, [data, filtering, matchIds]);

  const shownUnassignedIds = useMemo(() => {
    const q = unassignedQuery.trim().toLowerCase();
    if (!q) return visibleUnassignedIds;
    return visibleUnassignedIds.filter((id) => {
      const emp = byId.get(id);
      if (!emp) return false;
      return [emp.fullName, emp.preferredName, emp.employeeCode, emp.jobTitle, emp.department]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [visibleUnassignedIds, unassignedQuery, byId]);

  // Auto-expand ancestors for filter matches and search matches.
  useEffect(() => {
    if (!data) return;
    const targets = filtering ? matchIds : searchMatchIds;
    if (!targets.size) return;
    setExpandedIds((prev) => {
      let next = new Set(prev);
      for (const id of targets) {
        next = expandAncestors(byId, id, next);
        // Also expand the match itself if it has children and is a manager filter root.
        if (filtering && filters.reportingManagerId && id === String(filters.reportingManagerId)) {
          next.add(id);
        }
      }
      if (next.size === prev.size) {
        let same = true;
        for (const x of next) {
          if (!prev.has(x)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, [data, filtering, matchIds, searchMatchIds, byId, filters.reportingManagerId]);

  useEffect(() => {
    if (!resultsOpen && !filterOpen) return undefined;
    const onDoc = (e) => {
      if (resultsOpen && searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setResultsOpen(false);
      }
      if (filterOpen && filterWrapRef.current && !filterWrapRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setResultsOpen(false);
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [resultsOpen, filterOpen]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id || selectedId !== id) return undefined;
    const timer = window.setTimeout(() => {
      const safeId =
        typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
      const el = document.querySelector(`[data-org-id="${safeId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      pendingScrollId.current = null;
    }, 100);
    return () => window.clearTimeout(timer);
  }, [selectedId, expandedIds, zoom, detailOpen]);

  useEffect(() => {
    if (!flashId) return undefined;
    const t = window.setTimeout(() => setFlashId(null), 2200);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const selected = selectedId ? byId.get(selectedId) : null;
  const selectedManagerName = selected ? managerNameOf(selected, byId) : null;

  const toggle = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const next = new Set();
    for (const emp of data?.employees || []) {
      if ((emp.directReportCount || 0) > 0) next.add(emp.id);
    }
    setExpandedIds(next);
  };

  const collapseAll = () => {
    setExpandedIds(new Set(data?.hierarchyRootIds || []));
  };

  const openEmployee = useCallback(
    (id, { fromSearch = false } = {}) => {
      setExpandedIds((prev) => {
        let next = expandAncestors(byId, id, prev);
        next.add(id);
        return next;
      });
      setSelectedId(id);
      setDetailOpen(true);
      setManagerError("");
      setManagerSuccess("");
      setResultsOpen(false);
      pendingScrollId.current = id;
      if (fromSearch) setFlashId(id);
      else setFlashId(id);
    },
    [byId]
  );

  const clearSearch = () => {
    setSearch("");
    setResultsOpen(false);
  };

  const closeDetail = () => {
    if (savingManager) return;
    setDetailOpen(false);
  };

  const applyFilters = () => {
    setFilters(draft);
    setFilterOpen(false);
  };

  const resetDraft = () => setDraft(emptyFilters);

  const clearAllFilters = () => {
    setFilters(emptyFilters);
    setDraft(emptyFilters);
    setExpandedIds(new Set(data?.hierarchyRootIds || []));
  };

  const clearOneFilter = (key) => {
    setFilters((prev) => ({
      ...prev,
      [key]:
        key === "status"
          ? "ALL"
          : key === "reportingManagerId"
            ? null
            : key === "unassignedOnly"
              ? false
              : "",
    }));
  };

  const zoomBy = (delta) => {
    setZoom((z) => Math.min(1.6, Math.max(0.4, Math.round((z + delta) * 100) / 100)));
  };

  const resetZoom = () => setZoom(1);

  const fitToScreen = () => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const content = canvas.querySelector(".org-chart-forest");
    if (!content) return;
    const vw = viewport.clientWidth - 40;
    const vh = viewport.clientHeight - 40;
    const rect = content.getBoundingClientRect();
    const currentScale = zoom || 1;
    const width = rect.width / currentScale;
    const height = rect.height / currentScale;
    if (width <= 0 || height <= 0) return;
    const next = Math.min(vw / width, vh / height, 1);
    setZoom(Math.max(0.4, Math.round(next * 100) / 100));
  };

  const handleManagerChange = async (nextManagerId) => {
    if (!selected) return;
    setSavingManager(true);
    setManagerError("");
    setManagerSuccess("");
    try {
      await api.patch(`/employees/${selected.id}`, {
        reportingManagerId: nextManagerId || null,
      });
      setManagerSuccess("Reporting manager updated.");
      await load({ silent: true });
      setTimeout(() => setManagerSuccess(""), 2500);
    } catch (err) {
      setManagerError(err.response?.data?.message || "Could not update reporting manager.");
    } finally {
      setSavingManager(false);
    }
  };

  return (
    <div className="oe-reporting-panel org-page">
      <div className="org-header">
        <div>
          <p>Each person has one manager. People with no manager are listed beside the chart.</p>
          <div className="org-stats" aria-label="Organization stats">
            <span>
              People: <strong>{stats.total}</strong>
            </span>
            <span>
              Active: <strong>{stats.active}</strong>
            </span>
            <button
              type="button"
              className="org-stat-link"
              onClick={() => document.getElementById("org-no-manager")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
            >
              No manager: <strong>{stats.unassigned}</strong>
            </button>
            {stats.cycleEdgesBroken > 0 ? (
              <span className="org-stats-warn">
                Loops hidden: <strong>{stats.cycleEdgesBroken}</strong>
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={() => load()} disabled={loading}>
          <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Refresh
        </button>
      </div>

      {stats.cycleEdgesBroken > 0 ? (
        <div className="org-cycle-banner" role="status">
          Some reporting links form a loop, so they are hidden on the chart. Choose a different manager for those people.
        </div>
      ) : null}

      <div className="org-toolbar">
        <div className="org-search-wrap" ref={searchWrapRef}>
          <div className="org-search-field">
            <Search size={15} className="org-search-icon" aria-hidden="true" />
            <input
              className="org-search"
              type="search"
              placeholder="Search people"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setResultsOpen(Boolean(next.trim()));
              }}
              onFocus={() => {
                if (search.trim()) setResultsOpen(true);
              }}
              aria-label="Search people"
              aria-expanded={resultsOpen}
              aria-controls="org-search-results"
              autoComplete="off"
            />
            {search ? (
              <button type="button" className="org-search-clear" onClick={clearSearch} aria-label="Clear search">
                <X size={14} />
              </button>
            ) : null}
          </div>

          {resultsOpen && query ? (
            <div
              id="org-search-results"
              className="org-search-panel"
              role="listbox"
              aria-label="Search results"
            >
              <div className="org-search-panel-head">
                <strong>Search results</strong>
                <span>
                  {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
                </span>
              </div>
              {searchResults.length === 0 ? (
                <p className="org-search-empty">No one matches “{search.trim()}”.</p>
              ) : (
                <ul className="org-search-list">
                  {searchResults.map((emp) => {
                    const mgr = managerNameOf(emp, byId);
                    return (
                      <li key={emp.id}>
                        <button
                          type="button"
                          className="org-search-item"
                          role="option"
                          onClick={() => openEmployee(emp.id, { fromSearch: true })}
                        >
                          <OrgAvatar emp={emp} />
                          <span className="org-search-item-body">
                            <strong>{emp.fullName}</strong>
                            <span>
                              {[emp.employeeCode, emp.jobTitle || "Team member", emp.department]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <span className="org-search-mgr">
                              {mgr ? `Manager: ${mgr}` : "No manager"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="org-toolbar-actions">
          <div className="org-filter-wrap" ref={filterWrapRef}>
            <button
              type="button"
              className={`btn-secondary org-filter-btn${filterCount ? " is-active" : ""}`}
              onClick={() => {
                setDraft(filters);
                setFilterOpen((o) => !o);
              }}
              aria-expanded={filterOpen}
            >
              <Filter size={14} />
              Filters
              {filterCount ? <span className="org-filter-count">{filterCount}</span> : null}
            </button>
            {filterOpen ? (
              <div className="org-filter-panel" role="dialog" aria-label="Organization filters">
                <div className="org-filter-grid">
                  <label>
                    Department
                    <select
                      value={draft.department}
                      onChange={(e) => setDraft((p) => ({ ...p, department: e.target.value }))}
                    >
                      <option value="">All departments</option>
                      {filterOptions.departments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Job title
                    <select
                      value={draft.jobTitle}
                      onChange={(e) => setDraft((p) => ({ ...p, jobTitle: e.target.value }))}
                    >
                      <option value="">All job titles</option>
                      {filterOptions.titles.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ReportingManagerSelect
                    filterMode
                    compact
                    label="Manager"
                    value={draft.reportingManagerId}
                    onChange={(next) => setDraft((p) => ({ ...p, reportingManagerId: next }))}
                  />
                  <label>
                    Employment type
                    <select
                      value={draft.employmentType}
                      onChange={(e) => setDraft((p) => ({ ...p, employmentType: e.target.value }))}
                    >
                      <option value="">All types</option>
                      {filterOptions.employmentTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select
                      value={draft.status}
                      onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))}
                    >
                      <option value="ALL">All</option>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                  <label>
                    Work location
                    <select
                      value={draft.workLocation}
                      onChange={(e) => setDraft((p) => ({ ...p, workLocation: e.target.value }))}
                    >
                      <option value="">All locations</option>
                      {filterOptions.workLocations.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="org-filter-check">
                    <input
                      type="checkbox"
                      checked={draft.unassignedOnly}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, unassignedOnly: e.target.checked }))
                      }
                    />
                    Show only people with no manager
                  </label>
                </div>
                <div className="org-filter-actions">
                  <button type="button" className="btn-secondary" onClick={resetDraft}>
                    Reset
                  </button>
                  <button type="button" className="btn-primary" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="org-chart-controls" role="toolbar" aria-label="Chart controls">
            <button type="button" className="org-icon-btn" onClick={expandAll} title="Expand all">
              <ChevronsUpDown size={15} />
              <span>Expand</span>
            </button>
            <button type="button" className="org-icon-btn" onClick={collapseAll} title="Collapse all">
              <ChevronsDownUp size={15} />
              <span>Collapse</span>
            </button>
            <span className="org-control-sep" aria-hidden="true" />
            <button type="button" className="org-icon-btn" onClick={() => zoomBy(0.1)} title="Zoom in">
              <Plus size={15} />
            </button>
            <button type="button" className="org-icon-btn" onClick={() => zoomBy(-0.1)} title="Zoom out">
              <Minus size={15} />
            </button>
            <button type="button" className="org-icon-btn" onClick={fitToScreen} title="Fit to screen">
              <Maximize2 size={15} />
            </button>
            <button type="button" className="org-icon-btn" onClick={resetZoom} title="Reset zoom">
              <RotateCcw size={15} />
            </button>
            <span className="org-zoom-label">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {filtering ? (
        <div className="org-filter-chips" aria-label="Active organization filters">
          <div className="org-filter-chip-row">
            {filters.department ? (
              <button type="button" className="org-filter-chip" onClick={() => clearOneFilter("department")}>
                Dept: {filters.department}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.jobTitle ? (
              <button type="button" className="org-filter-chip" onClick={() => clearOneFilter("jobTitle")}>
                Title: {filters.jobTitle}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.reportingManagerId === "none" ? (
              <button
                type="button"
                className="org-filter-chip"
                onClick={() => clearOneFilter("reportingManagerId")}
              >
                No manager
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.reportingManagerId && filters.reportingManagerId !== "none" ? (
              <button
                type="button"
                className="org-filter-chip"
                onClick={() => clearOneFilter("reportingManagerId")}
              >
                Manager: {byId.get(String(filters.reportingManagerId))?.fullName || "Selected"}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.employmentType ? (
              <button
                type="button"
                className="org-filter-chip"
                onClick={() => clearOneFilter("employmentType")}
              >
                Type: {filters.employmentType}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.status !== "ALL" ? (
              <button type="button" className="org-filter-chip" onClick={() => clearOneFilter("status")}>
                Status: {filters.status}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.workLocation ? (
              <button
                type="button"
                className="org-filter-chip"
                onClick={() => clearOneFilter("workLocation")}
              >
                Location: {filters.workLocation}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
            {filters.unassignedOnly ? (
              <button
                type="button"
                className="org-filter-chip"
                onClick={() => clearOneFilter("unassignedOnly")}
              >
                No manager only
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
          <button type="button" className="org-clear-all" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="org-loading">
          <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>Loading reporting lines…</div>
        </div>
      ) : error ? (
        <div className="org-error" role="alert">
          {error}{" "}
          <button type="button" className="btn-secondary btn-sm" onClick={() => load()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="org-reporting-layout">
          <section className="org-chart-shell" aria-label="Reporting chart">
            <div className="org-chart-viewport" ref={viewportRef}>
              <div
                className="org-chart-canvas"
                ref={canvasRef}
                style={{ transform: `scale(${zoom})` }}
              >
                {filters.unassignedOnly ? (
                  <div className="org-chart-empty">
                    Showing people with no manager in the list. Clear that filter to view the chart.
                  </div>
                ) : visibleRootIds.length === 0 ? (
                  <div className="org-chart-empty">
                    {filtering
                      ? "No one matches these filters."
                      : "No reporting lines yet. Assign a manager to build the chart."}
                  </div>
                ) : (
                  <div className="org-chart-forest" role="tree" aria-label="Who reports to whom">
                    {visibleRootIds.map((id) => (
                      <ul key={id} className="org-chart-tree">
                        <OrgChartBranch
                          id={id}
                          byId={byId}
                          expandedIds={expandedIds}
                          visibleIds={visibleIds}
                          filtering={filtering}
                          onToggle={toggle}
                          onSelect={(empId) => openEmployee(empId)}
                          selectedId={selectedId}
                          matchIds={chartHighlightIds}
                          flashId={flashId}
                        />
                      </ul>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="org-unassigned-panel" id="org-no-manager" aria-label="People with no manager">
            <div className="org-unassigned-head">
              <h2>No manager</h2>
              <span>{visibleUnassignedIds.length}</span>
            </div>
            <input
              className="org-unassigned-search"
              type="search"
              value={unassignedQuery}
              onChange={(event) => setUnassignedQuery(event.target.value)}
              placeholder="Find someone with no manager"
              aria-label="Find someone with no manager"
            />
            {shownUnassignedIds.length === 0 ? (
              <p className="org-side-empty">
                {visibleUnassignedIds.length === 0
                  ? filtering
                    ? "No one without a manager matches these filters."
                    : "Everyone has a manager."
                  : "No one in this list matches that search."}
              </p>
            ) : (
              <div className="org-unassigned-grid">
                {shownUnassignedIds.map((id) => {
                  const emp = byId.get(id);
                  if (!emp) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`org-unassigned-card${selectedId === id ? " is-selected" : ""}${
                        chartHighlightIds.has(id) ? " is-match" : ""
                      }`}
                      style={{ "--dept-accent": departmentAccent(emp.department) }}
                      onClick={() => openEmployee(id)}
                    >
                      <OrgAvatar emp={emp} />
                      <span className="org-unassigned-body">
                        <strong>{emp.fullName}</strong>
                        <span>{emp.jobTitle || "Team member"}</span>
                        <span>
                          {[emp.employeeCode, emp.department].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <AppModal
        open={detailOpen && Boolean(selected)}
        onClose={closeDetail}
        locked={savingManager}
        title={selected?.fullName || "Employee"}
        subtitle={
          selected
            ? [selected.employeeCode, selected.jobTitle, selected.department]
                .filter(Boolean)
                .join(" · ")
            : ""
        }
        size="md"
        footer={
          selected ? (
            <>
              {canEditPeople ? (
              <Link className="btn-secondary" to={`/admin/employees/${selected.id}/edit`}>
                Edit employee
              </Link>
              ) : null}
              <Link
                className="btn-secondary"
                to={`/admin?reportingManagerId=${encodeURIComponent(selected.id)}`}
              >
                View direct reports
                {selected.directReportCount ? ` (${selected.directReportCount})` : ""}
              </Link>
              <Link className="btn-primary" to={`/admin/employees/${selected.id}`}>
                Open profile
              </Link>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="org-detail">
            <div className="org-detail-hero">
              <OrgAvatar emp={selected} className="org-chart-avatar org-chart-avatar-lg" />
              <div className="org-detail-meta">
                <div className="org-detail-row">
                  <span>Status</span>
                  <strong>{selected.status || "ACTIVE"}</strong>
                </div>
                <div className="org-detail-row">
                  <span>Reporting manager</span>
                  <strong>{selectedManagerName || "No manager"}</strong>
                </div>
                <div className="org-detail-row">
                  <span>Direct reports</span>
                  <strong>{selected.directReportCount || 0}</strong>
                </div>
                {selected.employmentType ? (
                  <div className="org-detail-row">
                    <span>Employment type</span>
                    <strong>{selected.employmentType}</strong>
                  </div>
                ) : null}
                {selected.workLocation ? (
                  <div className="org-detail-row">
                    <span>Work location</span>
                    <strong>{selected.workLocation}</strong>
                  </div>
                ) : null}
              </div>
            </div>

            {canEditPeople ? (
            <ReportingManagerSelect
              value={selected.reportingManagerId}
              initialSelected={
                selected.reportingManagerId && byId.get(selected.reportingManagerId)
                  ? {
                      _id: selected.reportingManagerId,
                      fullName: byId.get(selected.reportingManagerId).fullName,
                      job: { jobTitle: byId.get(selected.reportingManagerId).jobTitle },
                      employeeCode: byId.get(selected.reportingManagerId).employeeCode,
                    }
                  : null
              }
              excludeEmployeeId={selected.id}
              disabled={savingManager}
              error={managerError}
              onChange={handleManagerChange}
              description="Search by name or employee ID."
            />
            ) : (
              <AccessRestrictedInline />
            )}
            {managerSuccess ? <p className="org-detail-success">{managerSuccess}</p> : null}
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}

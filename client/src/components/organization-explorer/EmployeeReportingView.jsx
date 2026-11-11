import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import AppModal from "../AppModal";
import AuthedAvatar from "../AuthedAvatar";
import SoftRefresh from "../SoftRefresh";
import { IconMail, IconRefresh } from "../EmployeeIcon";
import {
  useEmployeeOrganizationViewQuery,
  useVisibleEmployeeProfileQuery,
} from "../../hooks/useEmployeeQueries";
import "../../pages/Organization.css";
import "../../pages/PeopleDirectory.css";

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
  const hue = 140 + (hash % 50);
  return `hsl(${hue} 28% 36%)`;
}

function expandAncestors(byId, employeeId, baseSet) {
  const next = new Set(baseSet);
  let cur = byId.get(employeeId)?.treeManagerId;
  let guard = 0;
  while (cur && guard < 64) {
    next.add(cur);
    cur = byId.get(cur)?.treeManagerId;
    guard += 1;
  }
  return next;
}

function matchesSearchQuery(emp, q) {
  if (!q) return false;
  const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""} ${emp.department || ""}`
    .toLowerCase();
  return hay.includes(q);
}

function formatJoiningDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function managerLabel(manager) {
  if (!manager || typeof manager !== "object") return "";
  const name = manager.fullName || "";
  const code = manager.employeeCode || "";
  if (name && code) return `${name} (${code})`;
  return name || code || "";
}

function ProfileField({ label, children, span2 = false }) {
  if (children == null || children === "") return null;
  return (
    <div className={`pd-profile-field${span2 ? " span-2" : ""}`}>
      <span className="pd-profile-label">{label}</span>
      <div className="pd-profile-value">{children}</div>
    </div>
  );
}

function OrgChartCard({
  emp,
  expanded,
  onToggle,
  onSelect,
  selected,
  isMatch,
  isFlash,
}) {
  const hasChildren = (emp.directReportCount || 0) > 0;
  const accent = departmentAccent(emp.department);
  return (
    <div
      data-org-id={emp.id}
      className={[
        "org-chart-card",
        hasChildren ? "is-manager" : "is-individual",
        selected ? "is-selected" : "",
        isMatch ? "is-match" : "",
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
  onToggle,
  onSelect,
  selectedId,
  matchIds,
  flashId,
}) {
  const emp = byId.get(id);
  if (!emp) return null;

  const expanded = expandedIds.has(id);
  const childIds = emp.childIds || [];

  return (
    <li className="org-chart-node">
      <OrgChartCard
        emp={emp}
        expanded={expanded}
        onToggle={onToggle}
        onSelect={onSelect}
        selected={selectedId === id}
        isMatch={matchIds.has(id)}
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

/** Employee Reporting view — uses GET /employees/organization-view + visible-profile. */
export default function EmployeeReportingView() {
  const orgQuery = useEmployeeOrganizationViewQuery();
  const data = orgQuery.data;
  const loading = orgQuery.isLoading && !data;
  const refreshing = orgQuery.isFetching && Boolean(data);
  const errorMessage =
    !data && orgQuery.error
      ? orgQuery.error.response?.data?.message || "Failed to load the organization chart."
      : "";

  const [search, setSearch] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [initializedExpand, setInitializedExpand] = useState(false);

  const searchWrapRef = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const pendingScrollId = useRef(null);

  const byId = useMemo(() => {
    const map = new Map();
    for (const emp of data?.employees || []) map.set(emp.id, emp);
    return map;
  }, [data]);

  useEffect(() => {
    if (!data || initializedExpand) return;
    const viewerId = data.meta?.viewerEmployeeId ? String(data.meta.viewerEmployeeId) : null;
    let next = new Set(data.hierarchyRootIds || []);
    // Expand the path from the highest ancestor down to the viewer so managers
    // above and the viewer's own reports are visible without extra clicks.
    if (viewerId && byId.has(viewerId)) {
      next = expandAncestors(byId, viewerId, next);
      next.add(viewerId);
    }
    setExpandedIds(next);
    setInitializedExpand(true);
  }, [data, initializedExpand, byId]);

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

  // Auto-expand ancestors of search matches so hits are discoverable in the tree.
  useEffect(() => {
    if (!data || !searchMatchIds.size) return;
    setExpandedIds((prev) => {
      let next = new Set(prev);
      for (const id of searchMatchIds) {
        next = expandAncestors(byId, id, next);
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
  }, [data, searchMatchIds, byId]);

  useEffect(() => {
    if (!resultsOpen) return undefined;
    const onDoc = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setResultsOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setResultsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [resultsOpen]);

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

  const profileQuery = useVisibleEmployeeProfileQuery(selectedId, {
    enabled: Boolean(selectedId) && detailOpen,
  });
  const profileEmployee = profileQuery.data?.employee || null;
  const profileLoading = profileQuery.isLoading || (profileQuery.isFetching && !profileEmployee);
  const profileStatus = profileQuery.error?.response?.status;
  const profileError =
    selectedId && detailOpen && profileQuery.isError
      ? profileStatus === 404
        ? "This employee is not available in your organisation view."
        : profileQuery.error?.response?.data?.message || "Failed to load employee profile."
      : "";

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
        // Keep the selected branch visible if they manage others.
        if ((byId.get(id)?.directReportCount || 0) > 0) next.add(id);
        return next;
      });
      setSelectedId(id);
      setDetailOpen(true);
      setResultsOpen(false);
      pendingScrollId.current = id;
      setFlashId(id);
      if (fromSearch) setFlashId(id);
    },
    [byId]
  );

  const clearSearch = () => {
    setSearch("");
    setResultsOpen(false);
  };

  const closeDetail = () => {
    setDetailOpen(false);
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

  const hierarchyRootIds = data?.hierarchyRootIds || [];
  const unassignedIds = data?.unassignedIds || [];
  const totalPeople = data?.meta?.total ?? data?.employees?.length ?? 0;

  /** Always show a chart when the viewer's reporting chain exists, even if server roots are empty. */
  const chartRootIds = useMemo(() => {
    if (hierarchyRootIds.length > 0) return hierarchyRootIds;
    const viewerId = data?.meta?.viewerEmployeeId ? String(data.meta.viewerEmployeeId) : null;
    if (!viewerId || !byId.has(viewerId)) return [];
    let cur = viewerId;
    let guard = 0;
    while (byId.get(cur)?.treeManagerId && guard < 64) {
      cur = String(byId.get(cur).treeManagerId);
      guard += 1;
    }
    return cur ? [cur] : [];
  }, [hierarchyRootIds, data?.meta?.viewerEmployeeId, byId]);

  return (
    <div className="oe-reporting-panel org-page pd-org-page">
      <div className="org-header pd-org-header">
        <div>
          <p>Find and connect with people across your company.</p>
          <div className="org-stats" aria-label="Organization stats">
            <span>
              People: <strong>{totalPeople}</strong>
            </span>
            <span>
              Unassigned: <strong>{unassignedIds.length}</strong>
            </span>
          </div>
        </div>
        <SoftRefresh active={refreshing} />
      </div>

      <div className="org-toolbar">
        <div className="org-search-wrap" ref={searchWrapRef}>
          <div className="org-search-field">
            <Search size={15} className="org-search-icon" aria-hidden="true" />
            <input
              className="org-search"
              type="search"
              value={search}
              placeholder="Search name, code, designation, or department"
              aria-label="Search organization chart"
              aria-expanded={resultsOpen}
              aria-controls="pd-org-search-results"
              autoComplete="off"
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setResultsOpen(Boolean(next.trim()));
              }}
              onFocus={() => {
                if (search.trim()) setResultsOpen(true);
              }}
            />
            {search ? (
              <button type="button" className="org-search-clear" onClick={clearSearch} aria-label="Clear search">
                <X size={14} />
              </button>
            ) : null}
          </div>
          {resultsOpen && query ? (
            <div
              id="pd-org-search-results"
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
                <p className="org-search-empty">No people match “{search.trim()}”.</p>
              ) : (
                <ul className="org-search-list">
                  {searchResults.slice(0, 20).map((emp) => (
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
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="org-toolbar-actions">
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

      {loading ? (
        <div className="org-loading">
          <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>Loading organization…</div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="org-error" role="alert">
          {errorMessage}{" "}
          <button type="button" className="btn-secondary btn-sm" onClick={() => orgQuery.refetch()}>
            <IconRefresh size={14} /> Retry
          </button>
        </div>
      ) : null}

      {!loading && !errorMessage && data ? (
        <>
          <section className="org-chart-shell" aria-label="Company organization chart">
            <div className="org-chart-viewport" ref={viewportRef}>
              <div
                className="org-chart-canvas"
                ref={canvasRef}
                style={{ transform: `scale(${zoom})` }}
              >
                {chartRootIds.length === 0 ? (
                  <div className="org-chart-empty">
                    Your reporting hierarchy is not available yet. People without a manager appear
                    below. Click a person to open only the profile fields you are permitted to see.
                  </div>
                ) : (
                  <div className="org-chart-forest" role="tree" aria-label="Reporting structure">
                    {chartRootIds.map((id) => (
                      <ul key={id} className="org-chart-tree">
                        <OrgChartBranch
                          id={id}
                          byId={byId}
                          expandedIds={expandedIds}
                          onToggle={toggle}
                          onSelect={(empId) => openEmployee(empId)}
                          selectedId={selectedId}
                          matchIds={searchMatchIds}
                          flashId={flashId}
                        />
                      </ul>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="org-unassigned-panel" aria-label="Unassigned employees">
            <div className="org-unassigned-head">
              <h2>Unassigned employees</h2>
              <span>{unassignedIds.length}</span>
            </div>
            {unassignedIds.length === 0 ? (
              <p className="org-side-empty">
                Everyone has a reporting manager or manages others.
              </p>
            ) : (
              <div className="org-unassigned-grid">
                {unassignedIds.map((id) => {
                  const emp = byId.get(id);
                  if (!emp) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`org-unassigned-card${selectedId === id ? " is-selected" : ""}${
                        searchMatchIds.has(id) ? " is-match" : ""
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
        </>
      ) : null}

      <AppModal
        open={detailOpen && Boolean(selectedId)}
        onClose={closeDetail}
        title="Employee profile"
        subtitle="Details available based on your reporting relationship"
        size="md"
      >
        {profileLoading && !profileEmployee ? (
          <div className="pd-profile-loading" aria-busy="true">
            <div className="pd-skeleton-row">
              <div className="skeleton-shimmer" style={{ width: 56, height: 56, borderRadius: 14 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton-shimmer" style={{ width: "45%", height: 16, borderRadius: 4, marginBottom: 10 }} />
                <div className="skeleton-shimmer" style={{ width: "28%", height: 12, borderRadius: 4 }} />
              </div>
            </div>
            <div className="skeleton-shimmer" style={{ width: "100%", height: 12, borderRadius: 4, marginTop: 8 }} />
            <div className="skeleton-shimmer" style={{ width: "80%", height: 12, borderRadius: 4 }} />
          </div>
        ) : null}

        {profileError ? (
          <div className="pd-profile-error" role="alert">
            <p>{profileError}</p>
            {profileStatus === 404 ? (
              <button type="button" className="btn-secondary" onClick={closeDetail}>
                Close
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => profileQuery.refetch()}>
                <IconRefresh size={16} /> Retry
              </button>
            )}
          </div>
        ) : null}

        {!profileError && profileEmployee ? (
          <div className="pd-profile">
            <div className="pd-profile-hero">
              <OrgAvatar emp={profileEmployee} className="pd-avatar pd-avatar-lg" />
              <div className="pd-profile-hero-text">
                <h3>{profileEmployee.fullName || "—"}</h3>
                <p>{profileEmployee.employeeCode || "—"}</p>
              </div>
            </div>

            <div className="pd-profile-grid">
              <ProfileField label="Designation">
                {profileEmployee.job?.jobTitle || ""}
              </ProfileField>
              <ProfileField label="Department">
                {profileEmployee.job?.department || ""}
              </ProfileField>
              <ProfileField label="Work location">
                {profileEmployee.job?.workLocation || ""}
              </ProfileField>
              <ProfileField label="Reporting manager">
                {managerLabel(
                  profileEmployee.job?.reportingManagerId ?? profileEmployee.reportingManagerId
                )}
              </ProfileField>
              <ProfileField label="Official email" span2>
                {profileEmployee.email ? (
                  <a href={`mailto:${profileEmployee.email}`}>
                    <IconMail size={14} /> {profileEmployee.email}
                  </a>
                ) : (
                  ""
                )}
              </ProfileField>
              <ProfileField label="Official phone">
                {profileEmployee.phoneNumber || ""}
              </ProfileField>
              <ProfileField label="Employment type">
                {profileEmployee.job?.employmentType || ""}
              </ProfileField>
              <ProfileField label="Joining date">
                {formatJoiningDate(profileEmployee.job?.joiningDate)}
              </ProfileField>
            </div>
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}

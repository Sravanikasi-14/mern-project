import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Network, RefreshCw, Search, X } from "lucide-react";
import HrPortalHeader from "../../components/HrPortalHeader";
import Modal from "../../components/Modal";
import ReportingManagerSelect from "../../components/ReportingManagerSelect";
import SoftRefresh from "../../components/SoftRefresh";
import SegmentedTabs from "../../components/SegmentedTabs";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { useSmartBack } from "../../hooks/useSmartBack";
import { useAuth } from "../../app/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";
import DepartmentsPanel from "../organization/DepartmentsPanel";
import DesignationsPanel from "../organization/DesignationsPanel";
import api from "../../services/api";

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function managerNameOf(emp, byId) {
  if (!emp?.reportingManagerId) return null;
  return byId.get(emp.reportingManagerId)?.fullName || null;
}

function matchesQuery(emp, q, byId) {
  if (!q) return false;
  const managerName = managerNameOf(emp, byId) || "";
  const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""} ${emp.department || ""} ${managerName}`.toLowerCase();
  return hay.includes(q);
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

function MobileNode({
  emp,
  depth,
  expanded,
  hasChildren,
  selected,
  match,
  onToggle,
  onSelect,
}) {
  return (
    <div style={{ marginLeft: depth ? 12 : 0 }} data-org-id={emp.id}>
      <button
        type="button"
        onClick={() => onSelect(emp.id)}
        className={`hr-org-node${selected ? " is-selected" : ""}${match ? " is-match" : ""}`}
      >
        <span
          role="button"
          tabIndex={hasChildren ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(emp.id);
          }}
          onKeyDown={(e) => {
            if (!hasChildren) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onToggle(emp.id);
            }
          }}
          className="hr-org-expand"
          style={{ opacity: hasChildren ? 1 : 0.2 }}
        >
          {hasChildren ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
        </span>
        <span className="hr-org-avatar" aria-hidden="true">
          {initials(emp.fullName)}
        </span>
        <span className="hr-org-node-body">
          <strong>{emp.fullName}</strong>
          <span>
            {[emp.jobTitle || "Team member", emp.department].filter(Boolean).join(" · ")}
            {emp.directReportCount > 0 ? ` · ${emp.directReportCount} reports` : ""}
          </span>
        </span>
      </button>
    </div>
  );
}

function Branch({
  id,
  byId,
  depth,
  expandedIds,
  selectedId,
  matchIds,
  onToggle,
  onSelect,
}) {
  const emp = byId.get(id);
  if (!emp) return null;
  const expanded = expandedIds.has(id);
  const children = emp.childIds || [];
  return (
    <div>
      <MobileNode
        emp={emp}
        depth={depth}
        expanded={expanded}
        hasChildren={children.length > 0}
        selected={selectedId === id}
        match={matchIds.has(id)}
        onToggle={onToggle}
        onSelect={onSelect}
      />
      {expanded
        ? children.map((childId) => (
            <Branch
              key={childId}
              id={childId}
              byId={byId}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedId={selectedId}
              matchIds={matchIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

const ORG_TABS = [
  { value: "hierarchy", label: "Hierarchy" },
  { value: "departments", label: "Departments" },
  { value: "titles", label: "Job titles" },
];

export default function HrOrganizationPage({ backFallback = "/admin/more", title = "Organization" }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(backFallback);
  const toast = useToast();
  const { user, company } = useAuth();
  const canViewStructure = hrPortalAllows(user, company, "organization.view");
  const [tab, setTab] = useState("hierarchy");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchWrapRef = useRef(null);
  const pendingScrollId = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await api.get("/employees/organization", { params: { status: "ACTIVE" } });
      setData(res.data);
      setExpandedIds((prev) => {
        if (prev.size && silent) return prev;
        return new Set(res.data.hierarchyRootIds || []);
      });
    } catch (err) {
      setError(err.response?.data?.message || "Could not load organization.");
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

  const query = search.trim().toLowerCase();

  const matchIds = useMemo(() => {
    const set = new Set();
    if (!query) return set;
    for (const emp of data?.employees || []) {
      if (matchesQuery(emp, query, byId)) set.add(emp.id);
    }
    return set;
  }, [data, query, byId]);

  const searchResults = useMemo(() => {
    if (!query) return [];
    return (data?.employees || [])
      .filter((emp) => matchIds.has(emp.id))
      .slice()
      .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "", undefined, { sensitivity: "base" }));
  }, [data, matchIds, query]);

  useEffect(() => {
    if (!query || !data) return;
    setExpandedIds((prev) => {
      let next = new Set(prev);
      for (const id of matchIds) {
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
  }, [query, matchIds, data, byId]);

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
      const safeId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
      const el = document.querySelector(`[data-org-id="${safeId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingScrollId.current = null;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedId, expandedIds, detailOpen]);

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

  const openEmployee = useCallback(
    (id) => {
      setExpandedIds((prev) => expandAncestors(byId, id, prev));
      setSelectedId(id);
      setDetailOpen(true);
      setResultsOpen(false);
      pendingScrollId.current = id;
    },
    [byId]
  );

  const clearSearch = () => {
    setSearch("");
    setResultsOpen(false);
  };

  const closeDetail = () => {
    if (saving) return;
    setDetailOpen(false);
  };

  const onManagerChange = async (nextId) => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/employees/${selected.id}`, { reportingManagerId: nextId || null });
      toast.push("Reporting manager updated.");
      await load({ silent: true });
    } catch (err) {
      toast.push(err.response?.data?.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <>
        <HrPortalHeader title={title} showBack onBack={() => goBack()} />
        <Skeleton />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        <HrPortalHeader title={title} showBack onBack={() => goBack()} />
        <ErrorState message={error} onRetry={() => load()} />
      </>
    );
  }

  return (
    <div className="hr-org">
      <HrPortalHeader title={title} showBack onBack={() => goBack()} />
      {loading && tab === "hierarchy" ? <SoftRefresh active label="Refreshing" /> : null}

      <div style={{ padding: "0 0 12px" }}>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={canViewStructure ? ORG_TABS : ORG_TABS.filter((item) => item.value === "hierarchy")}
        />
      </div>

      {tab === "departments" ? <DepartmentsPanel /> : null}
      {tab === "titles" ? <DesignationsPanel /> : null}

      {tab === "hierarchy" ? (
        <>
      <div className="row-actions" style={{ marginBottom: 10, gap: 8 }}>
        <button type="button" className="btn-secondary" onClick={() => load()} disabled={loading}>
          <RefreshCw size={14} style={{ marginRight: 4 }} />
          Refresh
        </button>
        <span className="caption" style={{ alignSelf: "center" }}>
          {data?.meta?.total ?? 0} people
          {data?.meta?.unassigned != null ? ` · ${data.meta.unassigned} no manager` : ""}
        </span>
      </div>

      {Number(data?.meta?.cycleEdgesBroken || 0) > 0 ? (
        <p className="caption" role="status" style={{ margin: "0 0 12px", color: "#7a5200" }}>
          {data.meta.cycleEdgesBroken} circular reporting link
          {data.meta.cycleEdgesBroken === 1 ? " was" : "s were"} skipped. Fix those managers so the
          chart stays accurate.
        </p>
      ) : null}

      <p className="caption" style={{ margin: "0 0 12px" }}>
        Hierarchy comes from each employee&apos;s reporting manager. Changes here update the chart and
        who employees can see.
      </p>

      <div className="hr-org-search-wrap" ref={searchWrapRef}>
        <label className="caption" htmlFor="hr-org-search">
          Search
        </label>
        <div className="hr-org-search-field">
          <Search size={15} className="hr-org-search-icon" aria-hidden="true" />
          <input
            id="hr-org-search"
            value={search}
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              setResultsOpen(Boolean(next.trim()));
            }}
            onFocus={() => {
              if (search.trim()) setResultsOpen(true);
            }}
            placeholder="Name, code, designation, department…"
            aria-expanded={resultsOpen}
            aria-controls="hr-org-search-results"
            autoComplete="off"
          />
          {search ? (
            <button type="button" className="hr-org-search-clear" onClick={clearSearch} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : null}
        </div>

        {resultsOpen && query ? (
          <div id="hr-org-search-results" className="hr-org-search-panel" role="listbox" aria-label="Search results">
            <div className="hr-org-search-panel-head">
              <strong>Search results</strong>
              <span>
                {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
              </span>
            </div>
            {searchResults.length === 0 ? (
              <p className="hr-org-search-empty">No employees match “{search.trim()}”.</p>
            ) : (
              <ul className="hr-org-search-list">
                {searchResults.map((emp) => {
                  const mgr = managerNameOf(emp, byId);
                  return (
                    <li key={emp.id}>
                      <button
                        type="button"
                        className="hr-org-search-item"
                        role="option"
                        onClick={() => openEmployee(emp.id)}
                      >
                        <span className="hr-org-avatar" aria-hidden="true">
                          {initials(emp.fullName)}
                        </span>
                        <span className="hr-org-search-item-body">
                          <strong>{emp.fullName}</strong>
                          <span>
                            {[emp.employeeCode, emp.jobTitle || "Team member", emp.department]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="hr-org-search-mgr">{mgr ? `Manager: ${mgr}` : "No manager"}</span>
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

      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>
          <Network size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
          Reporting structure
        </h3>
        {(data?.hierarchyRootIds || []).length === 0 ? (
          <p className="caption">No hierarchy trees yet. Assign managers to build structure.</p>
        ) : (
          (data.hierarchyRootIds || []).map((id) => (
            <Branch
              key={id}
              id={id}
              byId={byId}
              depth={0}
              expandedIds={expandedIds}
              selectedId={selectedId}
              matchIds={matchIds}
              onToggle={toggle}
              onSelect={openEmployee}
            />
          ))
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>No reporting manager</h3>
        <p className="caption" style={{ margin: "0 0 8px" }}>
          People without a manager appear here until you assign one.
        </p>
        {(data?.unassignedIds || []).length === 0 ? (
          <p className="caption">Everyone has a reporting manager assigned.</p>
        ) : (
          (data.unassignedIds || []).map((id) => {
            const emp = byId.get(id);
            if (!emp) return null;
            if (query && !matchIds.has(id)) return null;
            return (
              <MobileNode
                key={id}
                emp={emp}
                depth={0}
                expanded={false}
                hasChildren={false}
                selected={selectedId === id}
                match={matchIds.has(id)}
                onToggle={() => {}}
                onSelect={openEmployee}
              />
            );
          })
        )}
      </section>

      <Modal
        open={detailOpen && Boolean(selected)}
        onClose={closeDetail}
        locked={saving}
        title={selected?.fullName || "Employee"}
        size="md"
        footer={
          selected ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() =>
                  navigate(`/admin?reportingManagerId=${encodeURIComponent(selected.id)}`)
                }
              >
                View direct reports
                {selected.directReportCount ? ` (${selected.directReportCount})` : ""}
              </button>
              {user?.role === "COMPANY_ADMIN" ? null : (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving}
                  onClick={() => navigate(`/admin/employees/${selected.id}`)}
                >
                  Open profile
                </button>
              )}
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="hr-org-detail">
            <div className="hr-org-detail-hero">
              <span className="hr-org-avatar hr-org-avatar-lg" aria-hidden="true">
                {initials(selected.fullName)}
              </span>
              <div>
                <p className="caption" style={{ margin: "0 0 4px" }}>
                  {[selected.employeeCode, selected.jobTitle, selected.department]
                    .filter(Boolean)
                    .join(" · ") || "Team member"}
                </p>
                <p className="caption" style={{ margin: 0 }}>
                  Status: <strong style={{ color: "var(--ink)" }}>{selected.status || "ACTIVE"}</strong>
                </p>
                <p className="caption" style={{ margin: "4px 0 0" }}>
                  Manager:{" "}
                  <strong style={{ color: "var(--ink)" }}>{selectedManagerName || "No manager"}</strong>
                </p>
                <p className="caption" style={{ margin: "4px 0 0" }}>
                  Direct reports:{" "}
                  <strong style={{ color: "var(--ink)" }}>{selected.directReportCount || 0}</strong>
                </p>
              </div>
            </div>

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
              disabled={saving}
              onChange={onManagerChange}
              description="Updates the organisation chart and colleague visibility for this person."
            />
            {saving ? <p className="caption">Saving manager…</p> : null}
          </div>
        ) : null}
      </Modal>
        </>
      ) : null}
    </div>
  );
}

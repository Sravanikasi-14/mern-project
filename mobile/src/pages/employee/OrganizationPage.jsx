import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Network, RefreshCw, Search, X } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import SoftRefresh from "../../components/SoftRefresh";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import api from "../../services/api";

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function managerLabel(manager) {
  if (!manager || typeof manager !== "object") return "";
  const name = manager.fullName || "";
  const code = manager.employeeCode || "";
  if (name && code) return `${name} (${code})`;
  return name || code || "";
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

function Branch({ id, byId, depth, expandedIds, selectedId, onToggle, onSelect }) {
  const emp = byId.get(id);
  if (!emp) return null;
  const childIds = emp.childIds || [];
  const hasChildren = childIds.length > 0;
  const expanded = expandedIds.has(id);

  return (
    <div style={{ marginLeft: depth ? 12 : 0 }} data-org-id={emp.id}>
      <button
        type="button"
        onClick={() => onSelect(emp.id)}
        className={`hr-org-node${selectedId === emp.id ? " is-selected" : ""}`}
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
      {hasChildren && expanded
        ? childIds.map((childId) => (
            <Branch
              key={childId}
              id={childId}
              byId={byId}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

export default function EmployeeOrganizationPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/employees/organization-view");
      const payload = res.data || {};
      setData(payload);
      const roots = payload.hierarchyRootIds?.length
        ? payload.hierarchyRootIds
        : payload.rootIds || [];
      const byIdMap = new Map((payload.employees || []).map((emp) => [String(emp.id), emp]));
      const viewerId = payload.meta?.viewerEmployeeId
        ? String(payload.meta.viewerEmployeeId)
        : null;
      const next = new Set(roots);
      if (viewerId && byIdMap.has(viewerId)) {
        let cur = byIdMap.get(viewerId)?.treeManagerId;
        let guard = 0;
        while (cur && guard < 40) {
          next.add(cur);
          cur = byIdMap.get(cur)?.treeManagerId;
          guard += 1;
        }
        next.add(viewerId);
      }
      setExpandedIds(next);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load organisation.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const emp of data?.employees || []) {
      map.set(String(emp.id), emp);
    }
    return map;
  }, [data]);

  const rootIds = useMemo(() => {
    if (!data) return [];
    if (data.hierarchyRootIds?.length) return data.hierarchyRootIds;
    return data.rootIds || [];
  }, [data]);

  const q = search.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!q) return [];
    return (data?.employees || []).filter((emp) => {
      const manager = emp.reportingManagerId ? byId.get(emp.reportingManagerId) : null;
      const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""} ${
        emp.department || ""
      } ${manager?.fullName || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data, byId, q]);

  const openEmployee = useCallback(
    (id) => {
      setExpandedIds((prev) => expandAncestors(byId, id, prev));
      setSelectedId(id);
      setProfile(null);
      setProfileError("");
      setProfileStatus(null);
    },
    [byId]
  );

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    (async () => {
      setProfileLoading(true);
      setProfileError("");
      setProfileStatus(null);
      try {
        const res = await api.get(`/employees/${selectedId}/visible-profile`);
        if (!active) return;
        setProfile(res.data?.employee || null);
      } catch (err) {
        if (!active) return;
        const status = err.response?.status;
        setProfileStatus(status || null);
        setProfile(null);
        setProfileError(
          status === 404
            ? "This employee is not available in your organisation view."
            : err.response?.data?.message || "Failed to load employee profile."
        );
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const toggle = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeProfile = () => {
    setSelectedId(null);
    setProfile(null);
    setProfileError("");
    setProfileStatus(null);
  };

  return (
    <div className="hr-org">
      <PageHeader title="Organisation" subtitle="People in your reporting network" />
      {loading ? <SoftRefresh active label="Refreshing" /> : null}

      <div className="stack" style={{ gap: 12, padding: "0 16px 24px" }}>
        <div className="hr-org-search-field">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people you can see"
            aria-label="Search organisation"
          />
          {search ? (
            <button type="button" className="icon-btn" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className="row-actions" style={{ gap: 8 }}>
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} style={{ marginRight: 4 }} />
            Refresh
          </button>
          <span className="caption" style={{ alignSelf: "center" }}>
            <Network size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {data?.meta?.total ?? 0} visible
          </span>
        </div>

        {loading && !data ? <Skeleton rows={6} /> : null}
        {error && !data ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error && q ? (
          <div className="stack" style={{ gap: 8 }}>
            {searchHits.length === 0 ? (
              <p className="caption">No matching people in your organisation view.</p>
            ) : (
              searchHits.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  className="hr-org-node"
                  onClick={() => openEmployee(emp.id)}
                >
                  <span className="hr-org-avatar">{initials(emp.fullName)}</span>
                  <span className="hr-org-node-body">
                    <strong>{emp.fullName}</strong>
                    <span>
                      {[emp.jobTitle, emp.department, emp.employeeCode].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {!loading && !error && !q ? (
          <div className="stack" style={{ gap: 4 }}>
            {rootIds.length === 0 ? (
              <p className="caption">No organisation relationships are visible yet.</p>
            ) : (
              rootIds.map((id) => (
                <Branch
                  key={id}
                  id={id}
                  byId={byId}
                  depth={0}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                  onToggle={toggle}
                  onSelect={openEmployee}
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      <Modal open={Boolean(selectedId)} onClose={closeProfile} title="Employee profile">
        {profileLoading ? <Skeleton rows={4} /> : null}
        {profileError ? (
          <div className="stack" style={{ gap: 12 }}>
            <p className="caption" role="alert">
              {profileError}
            </p>
            {profileStatus === 404 ? (
              <button type="button" className="btn-secondary" onClick={closeProfile}>
                Close
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const id = selectedId;
                  setSelectedId(null);
                  window.setTimeout(() => setSelectedId(id), 0);
                }}
              >
                Retry
              </button>
            )}
          </div>
        ) : null}
        {!profileLoading && !profileError && profile ? (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <span className="hr-org-avatar" aria-hidden="true">
                {initials(profile.fullName)}
              </span>
              <div>
                <strong>{profile.fullName || "—"}</strong>
                <div className="caption">{profile.employeeCode || ""}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {profile.job?.jobTitle ? (
                <div>
                  <div className="caption">Designation</div>
                  <div>{profile.job.jobTitle}</div>
                </div>
              ) : null}
              {profile.job?.department ? (
                <div>
                  <div className="caption">Department</div>
                  <div>{profile.job.department}</div>
                </div>
              ) : null}
              {profile.email ? (
                <div>
                  <div className="caption">Official email</div>
                  <a href={`mailto:${profile.email}`}>{profile.email}</a>
                </div>
              ) : null}
              {managerLabel(profile.job?.reportingManagerId) ? (
                <div>
                  <div className="caption">Reporting manager</div>
                  <div>{managerLabel(profile.job.reportingManagerId)}</div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

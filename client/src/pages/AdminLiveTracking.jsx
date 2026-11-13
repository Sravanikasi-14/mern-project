import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import AttendanceMap from "../components/AttendanceMap";
import DateRangePicker from "../components/DateRangePicker";
import EmployeeAttendanceDrawer from "../components/EmployeeAttendanceDrawer";
import ModuleToolbar from "../components/ModuleToolbar";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import { IconMapPin, IconClipboardList } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { useTrackingSessionsQuery } from "../hooks/useAdminQueries";
import { attendancePollIntervalMs } from "../lib/attendancePollInterval";
import { getCompanyBusinessDate, resolveCompanyTimezone } from "../utils/dateUtils";
import AuthedAvatar from "../components/AuthedAvatar";
import { initialsFromName } from "../utils/employeeAvatar";
import "./Attendance.css";

/** Live map refresh while the tab is visible; slower when nobody is eligible. */
const POLL_MS = 60_000;
const POLL_EMPTY_MS = 180_000;

const HISTORY_STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "STOPPED", label: "Stopped" },
  { value: "EXPIRED", label: "Expired" },
];

const CARD_STYLE = {
  background: "var(--card, #ffffff)",
  border: "1px solid var(--hair, #e6ede8)",
  borderRadius: 10,
  padding: "16px 18px",
  boxShadow: "var(--shadow-sm)",
  marginBottom: 16,
};

const SECTION_HEAD_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 12,
};

const PILL_STYLE = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--g-800, #155a37)",
  background: "var(--g-100, #e3f2e9)",
  padding: "2px 8px",
  borderRadius: 10,
};

function hasCoords(loc) {
  return Boolean(loc) && typeof loc.latitude === "number" && typeof loc.longitude === "number";
}

function matchesSearch(row, q) {
  if (!q) return true;
  return (
    (row.fullName || "").toLowerCase().includes(q) ||
    (row.employeeCode || "").toLowerCase().includes(q) ||
    (row.department || "").toLowerCase().includes(q)
  );
}

const LOCATION_TONE = {
  LIVE: { color: "#15803d", bg: "#dcfce7", label: "Live sharing" },
  STALE: { color: "#9a3412", bg: "#ffedd5", label: "Stale location" },
  TRACKING_NO_LOCATION: { color: "#92400e", bg: "#fff7ed", label: "Sharing — location unavailable" },
  PUNCH_ONLY: { color: "#0369a1", bg: "#e0f2fe", label: "Last known from punch-in" },
  UNAVAILABLE: { color: "#52525b", bg: "#f4f4f5", label: "Location unavailable" },
};

function locationTone(row) {
  const state = row.locationState || (row.isTrackingActive
    ? hasCoords(row.lastLocation) ? "LIVE" : "TRACKING_NO_LOCATION"
    : hasCoords(row.lastLocation) || hasCoords(row.checkInLocation) ? "PUNCH_ONLY" : "UNAVAILABLE");
  return LOCATION_TONE[state] || LOCATION_TONE.UNAVAILABLE;
}

/** Shape a live row for AttendanceMap (live coords preferred; punch coords as fallback). */
function toMapEmployee(row) {
  const liveLoc = row.isTrackingActive && hasCoords(row.lastLocation) ? row.lastLocation : null;
  const punchLoc = hasCoords(row.checkInLocation)
    ? row.checkInLocation
    : hasCoords(row.lastLocation) && !row.isTrackingActive
      ? row.lastLocation
      : null;
  return {
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    department: row.department,
    jobTitle: row.jobTitle,
    attendanceStatus: row.attendanceStatus || (row.punchInAt ? "CHECKED_IN" : ""),
    checkInTime: row.checkInTime || row.punchInAt || null,
    checkInLocation: punchLoc,
    isTrackingActive: Boolean(row.isTrackingActive && liveLoc),
    liveTracking: liveLoc
      ? {
          sessionId: row.sessionId,
          expiresAt: row.expiresAt,
          lastLocation: liveLoc,
        }
      : null,
    locationState: row.locationState,
    locationLabel: row.locationLabel,
  };
}

function uniqueEmployees(rows) {
  const seen = new Set();
  const list = [];
  for (const row of rows) {
    const id = String(row.employeeId);
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({
      employeeId: row.employeeId,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      department: row.department,
      jobTitle: row.jobTitle,
    });
  }
  return list;
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt) - new Date(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function AdminLiveTracking() {
  const { company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);
  const today = getCompanyBusinessDate(new Date(), timeZone);

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [department, setDepartment] = useState("ALL");
  const [historyStatus, setHistoryStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [knownDepartments, setKnownDepartments] = useState([]);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [drawer, setDrawer] = useState({ employeeId: null, index: -1, source: "live" });

  // Live map: punched-in employees (+ optional live sharing); no date range → `live` only.
  // F38: single poller for live; history is on-demand (no duplicate 60s cycle).
  const liveQuery = useTrackingSessionsQuery(
    { department },
    {
      refetchInterval: (query) =>
        attendancePollIntervalMs(POLL_MS, query, {
          slowWhenEmptyMs: POLL_EMPTY_MS,
          emptyPath: (data) => data?.live,
        }),
      refetchIntervalInBackground: false,
    }
  );

  // History: sessions started within the selected range (fetch on filter change only).
  const historyQuery = useTrackingSessionsQuery(
    { startDate, endDate, department, status: historyStatus },
    { refetchInterval: false, refetchIntervalInBackground: false }
  );

  const liveRows = useMemo(() => liveQuery.data?.live || [], [liveQuery.data]);
  const historyRows = useMemo(() => historyQuery.data?.history || [], [historyQuery.data]);
  const supportsHistory = historyQuery.data?.supportsHistory !== false;

  useEffect(() => {
    const err = liveQuery.error || historyQuery.error;
    if (err) {
      setError(err.response?.data?.message || "Failed to load live tracking data.");
    } else if (liveQuery.isSuccess || historyQuery.isSuccess) {
      setError("");
    }
  }, [liveQuery.error, historyQuery.error, liveQuery.isSuccess, historyQuery.isSuccess]);

  // Departments are only discoverable from returned sessions; accumulate so the filter stays usable.
  useEffect(() => {
    const found = [...liveRows, ...historyRows].map((r) => r.department).filter(Boolean);
    if (!found.length) return;
    setKnownDepartments((prev) => {
      const next = new Set(prev);
      found.forEach((d) => next.add(d));
      return next.size === prev.length ? prev : [...next].sort();
    });
  }, [liveRows, historyRows]);

  const departmentOptions = useMemo(() => {
    const set = new Set(knownDepartments);
    if (department !== "ALL") set.add(department);
    return ["ALL", ...[...set].sort()];
  }, [knownDepartments, department]);

  const q = search.trim().toLowerCase();
  const filteredLive = useMemo(() => liveRows.filter((r) => matchesSearch(r, q)), [liveRows, q]);
  const filteredHistory = useMemo(() => historyRows.filter((r) => matchesSearch(r, q)), [historyRows, q]);

  const mapEmployees = useMemo(() => filteredLive.map(toMapEmployee), [filteredLive]);
  const locatedLiveCount = useMemo(
    () =>
      filteredLive.filter(
        (r) => hasCoords(r.lastLocation) || hasCoords(r.checkInLocation)
      ).length,
    [filteredLive]
  );
  const sharingCount = useMemo(
    () => filteredLive.filter((r) => r.isTrackingActive).length,
    [filteredLive]
  );

  useEffect(() => {
    setPage(1);
  }, [q, startDate, endDate, department, historyStatus]);

  const totalPages = Math.ceil((filteredHistory.length || 1) / pageSize);
  const pagedHistory = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredHistory.slice(start, start + pageSize);
  }, [filteredHistory, page, pageSize]);

  const liveLoading = liveQuery.isLoading && !liveQuery.data;
  const historyLoading = historyQuery.isLoading && !historyQuery.data;
  const softRefreshing =
    (liveQuery.isFetching && Boolean(liveQuery.data)) ||
    (historyQuery.isFetching && Boolean(historyQuery.data));

  const drawerList = useMemo(
    () => uniqueEmployees(drawer.source === "history" ? filteredHistory : filteredLive),
    [drawer.source, filteredHistory, filteredLive]
  );

  const openDrawer = (row, source) => {
    const list = uniqueEmployees(source === "history" ? filteredHistory : filteredLive);
    const index = list.findIndex((e) => String(e.employeeId) === String(row.employeeId));
    setDrawer({ employeeId: row.employeeId, index: Math.max(index, 0), source });
  };

  const selectDrawerIndex = (index) => {
    if (index < 0 || index >= drawerList.length) return;
    setDrawer((prev) => ({ ...prev, index, employeeId: drawerList[index].employeeId }));
  };

  const fmtTime = (value) =>
    value
      ? new Date(value).toLocaleString([], {
          timeZone,
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const handleRangeChange = ({ startDate: s, endDate: e }) => {
    setStartDate(s || today);
    setEndDate(e || s || today);
  };

  const refreshAll = () => {
    liveQuery.refetch();
    historyQuery.refetch();
  };

  const rangeLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
  const filterCount = (department !== "ALL" ? 1 : 0) + (historyStatus !== "ALL" ? 1 : 0);

  return (
    <div className="attendance-page-container">
      <AppHeader title="Live Tracking" actions={<SoftRefresh active={softRefreshing} />} />

      <ModuleToolbar
        searchValue={search}
        onSearchChange={(e) => setSearch(e.target.value)}
        searchPlaceholder="Search name, code, or department..."
        searchAriaLabel="Search tracked employees"
        leading={
          <DateRangePicker
            label=""
            placeholder="Select dates"
            className="module-toolbar-drp"
            startDate={startDate}
            endDate={endDate}
            maxDate={today}
            onChange={handleRangeChange}
          />
        }
        secondaryActions={
          <button
            type="button"
            className="btn-secondary"
            onClick={refreshAll}
            title="Refresh live tracking data"
          >
            Refresh
          </button>
        }
        filterCount={filterCount}
        onFiltersClear={() => {
          setDepartment("ALL");
          setHistoryStatus("ALL");
        }}
        filters={
          <>
            <label className="module-toolbar-filter-field">
              Department
              <select
                className="filter-select"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                {departmentOptions.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept === "ALL" ? "All Departments" : dept}
                  </option>
                ))}
              </select>
            </label>
            <label className="module-toolbar-filter-field">
              History status
              <select
                className="filter-select"
                value={historyStatus}
                onChange={(e) => setHistoryStatus(e.target.value)}
              >
                {HISTORY_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />

      {error && (
        <div className="error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Section 1: On duty / live tracking */}
      <section style={CARD_STYLE} aria-labelledby="live-now-heading">
        <div style={SECTION_HEAD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", display: "inline-block" }}
            />
            <h3 id="live-now-heading" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              On duty now
            </h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Punched-in employees · live sharing when started · refreshes every 60s
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={PILL_STYLE}>{filteredLive.length} On duty</span>
            <span style={PILL_STYLE}>{sharingCount} Sharing</span>
            <span style={PILL_STYLE}>{locatedLiveCount} Located</span>
          </div>
        </div>

        {!liveLoading && filteredLive.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "var(--g-100, #e3f2e9)",
                color: "var(--g-800, #155a37)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <IconMapPin size={22} />
            </div>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--ink)", fontSize: 14.5 }}>
              No employees are punched in right now
            </p>
            <p style={{ margin: "4px 0 0" }}>
              {liveRows.length > 0
                ? "No on-duty employees match your search."
                : "Employees appear here after punch-in. Map pins show when coordinates are available from punch-in or live sharing."}
            </p>
          </div>
        ) : (
          <>
            <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--hair)" }}>
              <AttendanceMap employees={mapEmployees} filterLabel="On duty now" height={440} />
            </div>
            {filteredLive.length > locatedLiveCount && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>
                {filteredLive.length - locatedLiveCount} employee
                {filteredLive.length - locatedLiveCount === 1 ? "" : "s"} have no usable coordinates and are not
                shown on the map (permission denied, GPS unavailable, or punch without location).
              </p>
            )}
            {filteredLive.length > 0 && (
              <ul className="lt-on-duty-list" style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 8 }}>
                {filteredLive.map((row) => {
                  const tone = locationTone(row);
                  const loc = hasCoords(row.lastLocation)
                    ? row.lastLocation
                    : hasCoords(row.checkInLocation)
                      ? row.checkInLocation
                      : null;
                  return (
                    <li key={String(row.id || row.sessionId || row.employeeId)}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => openDrawer(row, "live")}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) auto",
                          gap: 12,
                          alignItems: "center",
                          padding: "10px 12px",
                        }}
                      >
                        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                          <AuthedAvatar
                            className="lt-emp-avatar"
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 10,
                              background: "linear-gradient(135deg, #1d7347, #0d3a23)",
                              color: "#fff",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 700,
                              flexShrink: 0,
                              overflow: "hidden",
                            }}
                            employee={{ _id: row.employeeId, avatar: row.avatar }}
                            avatar={row.avatar}
                            name={row.fullName}
                            initials={initialsFromName(row.fullName, "E")}
                            alt={row.fullName || "Employee"}
                          />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 700, color: "var(--ink)" }}>
                              {row.fullName || "Employee"}
                            </span>
                            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                              {[row.employeeCode, row.department, row.jobTitle].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </span>
                        <span style={{ minWidth: 0, fontSize: 12.5, color: "var(--muted)" }}>
                          <span style={{ display: "block" }}>
                            Punch-in {fmtTime(row.punchInAt || row.checkInTime || row.startedAt)}
                          </span>
                          <span style={{ display: "block" }}>
                            {loc
                              ? `${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(4)}`
                              : "No coordinates"}
                            {row.lastLocationAt || loc?.capturedAt
                              ? ` · Updated ${fmtTime(row.lastLocationAt || loc.capturedAt)}`
                              : ""}
                          </span>
                        </span>
                        <span
                          style={{
                            justifySelf: "end",
                            fontSize: 11.5,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 999,
                            color: tone.color,
                            background: tone.bg,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.locationLabel || tone.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Section 2: Session history */}
      <section style={{ ...CARD_STYLE, overflow: "hidden" }} aria-labelledby="session-history-heading">
        <div style={SECTION_HEAD_STYLE}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3
              id="session-history-heading"
              style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}
            >
              Session history
            </h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Sessions started {rangeLabel}</span>
          </div>
          <span style={PILL_STYLE}>{filteredHistory.length} Sessions</span>
        </div>

        {!supportsHistory ? (
          <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Session history is not available for this workspace.
          </div>
        ) : historyLoading ? (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Ended / Expires</th>
                  <th>Duration</th>
                  <th>Last location</th>
                </tr>
              </thead>
              <tbody>
                <TableSkeletonRows rows={5} cols={6} />
              </tbody>
            </table>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "var(--g-100, #e3f2e9)",
                color: "var(--g-800, #155a37)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <IconClipboardList size={22} />
            </div>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--ink)", fontSize: 14.5 }}>
              No tracking sessions in this range
            </p>
            <p style={{ margin: "4px 0 0" }}>Try a wider date range or clear the filters.</p>
          </div>
        ) : (
          <>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Ended / Expires</th>
                    <th>Duration</th>
                    <th>Last location</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedHistory.map((row) => {
                    const ended = row.stoppedAt || row.expiresAt;
                    const loc = hasCoords(row.lastLocation) ? row.lastLocation : null;
                    return (
                      <tr
                        key={String(row.sessionId)}
                        style={{ cursor: "pointer" }}
                        onClick={() => openDrawer(row, "history")}
                      >
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <AuthedAvatar
                              className="lt-emp-avatar"
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 10,
                                background: "linear-gradient(135deg, #1d7347, #0d3a23)",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                fontWeight: 700,
                                flexShrink: 0,
                                overflow: "hidden",
                              }}
                              employee={{ _id: row.employeeId, avatar: row.avatar }}
                              avatar={row.avatar}
                              name={row.fullName}
                              initials={initialsFromName(row.fullName, "E")}
                              alt={row.fullName || "Employee"}
                            />
                            <div>
                              <div style={{ fontWeight: 600, color: "var(--ink)" }}>{row.fullName || "—"}</div>
                              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                                {row.employeeCode} · {row.department}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <StatusBadge status={row.status} />
                        </td>
                        <td style={{ padding: "12px 14px" }}>{fmtTime(row.startedAt)}</td>
                        <td style={{ padding: "12px 14px" }}>
                          {row.isTrackingActive ? "In progress" : fmtTime(ended)}
                        </td>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--g-800, #155a37)" }}>
                          {row.isTrackingActive ? "—" : formatDuration(row.startedAt, ended)}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          {loc ? (
                            <div style={{ fontSize: 12 }}>
                              <div style={{ color: "var(--g-700, #1d7347)", fontWeight: 600 }}>
                                {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                              </div>
                              {loc.accuracy ? (
                                <div style={{ color: "var(--faint)", fontSize: 10.5 }}>
                                  ±{Math.round(loc.accuracy)}m accuracy
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span style={{ color: "#a1a1aa", fontSize: 12 }}>No location recorded</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={filteredHistory.length}
              pageSize={pageSize}
              pageSizeOptions={[10, 25, 50, 100]}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              itemLabel="sessions"
            />
          </>
        )}
      </section>

      {drawer.employeeId && (
        <EmployeeAttendanceDrawer
          employeeId={drawer.employeeId}
          employeeList={drawerList}
          currentIndex={drawer.index}
          onSelectEmployee={selectDrawerIndex}
          onClose={() => setDrawer({ employeeId: null, index: -1, source: drawer.source })}
        />
      )}
    </div>
  );
}

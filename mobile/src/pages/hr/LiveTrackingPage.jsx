import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, List, Map as MapIcon, MoreVertical, Search, X } from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import EmployeeTrackMap, { distanceLabel } from "../../components/EmployeeTrackMap";
import ProfileAvatar from "../../components/ProfileAvatar";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import api from "../../services/api";
import { getCompanyBusinessDate, resolveCompanyTimezone } from "../../utils/dateUtils";

function pushPoint(list, loc, meta) {
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") return;
  if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return;
  const key = `${loc.latitude.toFixed(5)},${loc.longitude.toFixed(5)}`;
  if (list.some((p) => p.key === key && p.kind === meta.kind)) return;
  list.push({
    key,
    lat: loc.latitude,
    lng: loc.longitude,
    label: meta.label,
    at: meta.at || loc.receivedAt || loc.capturedAt || null,
    kind: meta.kind,
  });
}

function trackingState(row) {
  if (!row) return { key: "none", label: "Select an employee" };
  if (row.isTrackingActive && row.liveTracking?.lastLocation) {
    return { key: "live", label: "Sharing location" };
  }
  if (row.liveTracking?.lastLocation || row.checkInLocation || row.checkOutLocation) {
    const stamp =
      row.liveTracking?.lastLocation?.receivedAt ||
      row.checkOutTime ||
      row.checkInTime ||
      null;
    if (stamp) {
      const ageMin = (Date.now() - new Date(stamp).getTime()) / 60000;
      if (Number.isFinite(ageMin) && ageMin > 60) {
        return { key: "stale", label: "Location outdated" };
      }
    }
    return { key: "available", label: "Location on file" };
  }
  return { key: "unavailable", label: "Location unavailable" };
}

export default function HrLiveTrackingPage() {
  const { company, user } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const timezone = resolveCompanyTimezone(company);
  const todayStr = getCompanyBusinessDate(new Date(), timezone);

  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [date, setDate] = useState(todayStr);
  const [view, setView] = useState("map");

  const loadOverview = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/admin/attendance/overview", { params: { date } });
      setRows(res.data?.employees || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load live tracking.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(loadOverview, 120);
    return () => clearTimeout(t);
  }, [date]);

  const selected = useMemo(() => {
    const fromOverview = rows.find((row) => String(row.employeeId) === String(selectedId));
    if (fromOverview) return fromOverview;
    const emp = detail?.employee;
    if (selectedId && emp && String(emp._id || emp.id || emp.employeeId) === String(selectedId)) {
      return {
        employeeId: selectedId,
        fullName: emp.fullName || emp.name,
        employeeCode: emp.employeeCode,
        department: emp.department,
        jobTitle: emp.jobTitle,
        attendanceStatus: null,
        isTrackingActive: false,
        liveTracking: null,
        checkInLocation: null,
        checkOutLocation: null,
      };
    }
    return null;
  }, [rows, selectedId, detail]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const res = await api.get(`/admin/attendance/employee/${selectedId}`, {
          params: { startDate: date, endDate: date, limit: 31 },
        });
        if (!cancelled) setDetail(res.data);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, date]);

  // When employee changes, clear previous selection artifacts immediately.
  const selectEmployee = (row) => {
    setSelectedId(String(row.employeeId));
    setDetail(null);
    setPickerOpen(false);
    setSearch("");
  };

  const clearEmployee = () => {
    setSelectedId("");
    setDetail(null);
    setPickerOpen(true);
  };

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.fullName} ${row.employeeCode} ${row.department}`.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const dayRecord = useMemo(() => {
    const records = detail?.records || detail?.history || [];
    return (
      records.find((r) => String(r.date || "").slice(0, 10) === date) ||
      records[0] ||
      null
    );
  }, [detail, date]);

  const trackPoints = useMemo(() => {
    const points = [];
    // Clear path: only points belonging to the selected employee/date.
    if (!selectedId || !selected) return points;

    pushPoint(points, dayRecord?.checkInLocation || selected.checkInLocation, {
      label: "Punch in",
      at: dayRecord?.checkIn || dayRecord?.checkInTime || selected.checkInTime,
      kind: "in",
    });
    pushPoint(points, dayRecord?.checkOutLocation || selected.checkOutLocation, {
      label: "Punch out",
      at: dayRecord?.checkOut || dayRecord?.checkOutTime || selected.checkOutTime,
      kind: "out",
    });

    // Live breadcrumbs are not exposed by current admin APIs — use lastLocation only for today.
    if (
      date === todayStr &&
      selected.isTrackingActive &&
      selected.liveTracking?.lastLocation
    ) {
      pushPoint(points, selected.liveTracking.lastLocation, {
        label: "Live location",
        at: selected.liveTracking.lastLocation.receivedAt,
        kind: "live",
      });
    }

    return points;
  }, [selectedId, selected, dayRecord, date, todayStr]);

  const state = trackingState(selected);
  const distance = distanceLabel(trackPoints);
  const lastUpdate =
    trackPoints[trackPoints.length - 1]?.at ||
    selected?.liveTracking?.lastLocation?.receivedAt ||
    null;

  const durationLabel = useMemo(() => {
    if (trackPoints.length < 2) return null;
    const times = trackPoints
      .map((p) => (p.at ? new Date(p.at).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    if (times.length < 2) return null;
    const mins = Math.round((Math.max(...times) - Math.min(...times)) / 60000);
    if (mins <= 0) return null;
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }, [trackPoints]);

  return (
    <div className="st-live">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Live Tracking</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <ProfileAvatar name={user?.name || user?.fullName || user?.email || "HR"} size={36} className="hr-portal-avatar" />
        </div>
      </header>

      <div className="st-live-toggle" role="tablist" aria-label="Tracking view">
        <button
          type="button"
          className={view === "map" ? "is-active" : ""}
          onClick={() => setView("map")}
        >
          <MapIcon size={15} strokeWidth={2} aria-hidden="true" />
          Map
        </button>
        <button
          type="button"
          className={view === "list" ? "is-active" : ""}
          onClick={() => setView("list")}
        >
          <List size={15} strokeWidth={2} aria-hidden="true" />
          List
        </button>
      </div>

      <label className="st-live-date">
        Route date
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} max={todayStr} />
      </label>

      <section className="st-live-picker">
        {selected ? (
          <div className="st-live-selected">
            <ProfileAvatar name={selected.fullName} photo={selected.avatar} size={44} className="st-live-avatar" />
            <div className="st-live-selected-copy">
              <strong>{selected.fullName}</strong>
              <span>
                {selected.employeeCode || "—"} · {state.label}
              </span>
            </div>
            <button type="button" className="btn-ghost-sm" onClick={() => setPickerOpen(true)}>
              Change
            </button>
            <button type="button" className="icon-btn" aria-label="Clear employee" onClick={clearEmployee}>
              <X size={18} strokeWidth={1.85} />
            </button>
          </div>
        ) : (
          <button type="button" className="st-live-pick-cta" onClick={() => setPickerOpen(true)}>
            <Search size={18} strokeWidth={1.85} aria-hidden="true" />
            Search and select an employee
          </button>
        )}

        {pickerOpen ? (
          <div className="st-live-dropdown">
            <div className="st-att-search">
              <Search size={18} strokeWidth={1.85} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or employee ID"
                aria-label="Search employees for tracking"
                autoFocus
              />
            </div>
            {loading ? (
              <Skeleton />
            ) : filteredPeople.length === 0 ? (
              <EmptyState message="No employees match this search." />
            ) : (
              <div className="st-live-people">
                {filteredPeople.slice(0, 40).map((row) => {
                  const st = trackingState(row);
                  return (
                    <button
                      key={row.employeeId}
                      type="button"
                      className={`st-live-person${String(row.employeeId) === String(selectedId) ? " is-active" : ""}`}
                      onClick={() => selectEmployee(row)}
                    >
                      <ProfileAvatar name={row.fullName} photo={row.avatar} size={40} className="st-live-avatar" />
                      <span className="st-live-person-copy">
                        <strong>{row.fullName}</strong>
                        <span>
                          {row.employeeCode} · {st.label}
                        </span>
                      </span>
                      <StatusBadge status={row.isTrackingActive ? "IN_PROGRESS" : row.attendanceStatus} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {error ? <ErrorState message={error} onRetry={loadOverview} /> : null}

      {!selectedId ? (
        <EmptyState message="Select one employee to view their location and travelled route." />
      ) : view === "map" ? (
        <div className="st-live-map-block">
          <div className={`st-live-state is-${state.key}`}>{state.label}</div>
          {detailLoading && trackPoints.length === 0 ? (
            <Skeleton />
          ) : (
            <EmployeeTrackMap
              key={`${selectedId}-${date}`}
              employeeKey={`${selectedId}-${date}`}
              points={trackPoints}
              isLive={Boolean(selected?.isTrackingActive)}
              height={340}
              emptyMessage="No GPS points recorded for this employee on the selected date. Routes appear from punch locations and live last-known coordinates when available."
            />
          )}
          <div className="st-live-meta">
            <div>
              <span>Last update</span>
              <strong>
                {lastUpdate
                  ? new Date(lastUpdate).toLocaleString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Distance</span>
              <strong>{distance || "—"}</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong>{durationLabel || "—"}</strong>
            </div>
            <div>
              <span>Points</span>
              <strong>{trackPoints.length}</strong>
            </div>
          </div>
          <p className="caption st-live-note">
            Map shows only the selected employee. Full breadcrumb trails are not exposed by the current
            admin API—only punch and live last-location points from existing responses are drawn.
          </p>
        </div>
      ) : (
        <div className="st-live-list-view">
          <div className="st-att-card is-static">
            <ProfileAvatar name={selected?.fullName} photo={selected?.avatar} size={44} className="st-att-avatar" />
            <span className="st-att-copy">
              <strong>{selected?.fullName}</strong>
              <span>
                {selected?.jobTitle || selected?.department} · {selected?.employeeCode}
              </span>
            </span>
            <StatusBadge status={selected?.attendanceStatus} />
          </div>
          {trackPoints.length === 0 ? (
            <EmptyState message="No location points for this employee on the selected date." />
          ) : (
            trackPoints.map((p) => (
              <div key={`${p.kind}-${p.key}`} className="st-live-point">
                <strong>{p.label}</strong>
                <span>
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </span>
                <em>
                  {p.at
                    ? new Date(p.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </em>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

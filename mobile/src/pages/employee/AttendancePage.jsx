import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import LocationBanner from "../../components/LocationBanner";
import { useToast } from "../../components/Toast";
import useLocationPermission from "../../hooks/useLocationPermission";
import { useAuth } from "../../app/AuthContext";
import api from "../../services/api";
import { watchPosition, clearWatch } from "../../services/location";
import {
  buildMonthGrid,
  formatCivilDate,
  formatDisplayDate,
  getCompanyBusinessDate,
  resolveCompanyTimezone,
  shiftMonth,
} from "../../utils/dateUtils";
import {
  useAttendanceHistoryQuery,
  useDashboardQuery,
  useTrackingStatusQuery,
} from "../../hooks/useEmployeeQueries";
import { invalidateAttendance } from "../../app/queryKeys";

function recordKey(row) {
  const raw = row?.date || "";
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return formatDisplayDate(raw).replace(/ /g, "-");
}

function civilFromRecord(row) {
  const raw = row?.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatStamp(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    }).format(date);
  } catch {
    return null;
  }
}

function stampOrFallback(value, timezone) {
  return formatStamp(value, timezone) || "Not recorded";
}

function getTimes(rec) {
  return {
    checkIn: rec?.checkIn || rec?.checkInTime || rec?.punchIn || null,
    checkOut: rec?.checkOut || rec?.checkOutTime || rec?.punchOut || null,
  };
}

function workedHours(rec) {
  const { checkIn, checkOut } = getTimes(rec);
  if (!checkIn || !checkOut) return 0;
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) return 0;
  return (outDate - inDate) / (1000 * 3600);
}

/**
 * Calendar visual categories from real attendance records.
 * Model statuses: PRESENT | HALF_DAY | ON_LEAVE | ABSENT (+ live CHECKED_IN/CHECKED_OUT).
 * There is no REGULARIZED status. Overtime is derived when a present day exceeds 8h.
 */
function calendarCategory(rec) {
  if (!rec) return "";
  const status = String(rec.status || rec.attendanceStatus || "").toUpperCase();
  if (status === "ABSENT") return "absent";
  if (status === "ON_LEAVE") return "leave";
  if (status === "HALF_DAY") return "leave";
  if (
    status === "PRESENT" ||
    status === "CHECKED_IN" ||
    status === "CHECKED_OUT" ||
    status === "LATE"
  ) {
    return workedHours(rec) > 8 ? "overtime" : "present";
  }
  return "";
}

function statusLabel(rec) {
  if (!rec) return "No record";
  const cat = calendarCategory(rec);
  if (cat === "overtime") return "Overtime";
  if (cat === "absent") return "Absent";
  if (cat === "leave") {
    const status = String(rec.status || rec.attendanceStatus || "").toUpperCase();
    return status === "HALF_DAY" ? "Half day" : "On leave";
  }
  if (cat === "present") {
    const status = String(rec.status || rec.attendanceStatus || "").toUpperCase();
    if (status === "CHECKED_IN") return "Checked in";
    if (status === "CHECKED_OUT") return "Checked out";
    if (status === "LATE") return "Present (late)";
    return "Present";
  }
  return String(rec.status || rec.attendanceStatus || "Recorded");
}

export default function EmployeeAttendancePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const geo = useLocationPermission();
  const { company } = useAuth();
  const timezone = resolveCompanyTimezone(company);
  const [actionError, setActionError] = useState("");
  const [punching, setPunching] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const watchId = useRef(null);
  const tipRef = useRef(null);
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selected, setSelected] = useState("");
  const [hoverTip, setHoverTip] = useState(null);

  const monthBounds = useMemo(() => {
    const startDate = formatCivilDate(month.year, month.month, 1);
    const last = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
    const endDate = formatCivilDate(month.year, month.month, last);
    return { startDate, endDate };
  }, [month]);

  const historyQuery = useAttendanceHistoryQuery(monthBounds.startDate, monthBounds.endDate);
  const dashQuery = useDashboardQuery();
  const trackingQuery = useTrackingStatusQuery();

  const history = useMemo(() => historyQuery.data || [], [historyQuery.data]);
  const today = dashQuery.data?.attendance?.today || null;
  const loading = historyQuery.isLoading && history.length === 0;
  const error = actionError
    || historyQuery.error?.response?.data?.message
    || historyQuery.error?.message
    || "";

  const load = () => {
    setActionError("");
    return Promise.all([historyQuery.refetch(), dashQuery.refetch()]);
  };

  const attachTrackingWatch = () => {
    if (watchId.current != null) clearWatch(watchId.current);
    watchId.current = watchPosition(async (loc) => {
      try {
        await api.post("/employees/me/tracking/update", { location: loc });
      } catch (err) {
        if (err.response?.status === 400 && String(err.response?.data?.message || "").includes("expired")) {
          if (watchId.current != null) {
            clearWatch(watchId.current);
            watchId.current = null;
          }
          setTracking(false);
          api.post("/employees/me/tracking/stop").catch(() => {});
          invalidateAttendance(queryClient);
        }
      }
    });
  };

  useEffect(() => {
    if (trackingQuery.data?.isTrackingActive && trackingQuery.data?.session) {
      setTracking(true);
      attachTrackingWatch();
    }
    return () => {
      if (watchId.current != null) {
        clearWatch(watchId.current);
        watchId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingQuery.data?.isTrackingActive]);

  const punch = async (kind) => {
    if (punching) return;
    try {
      setPunching(true);
      setActionError("");
      const loc = await geo.readPosition();
      const path = kind === "in" ? "/employees/me/attendance/punch-in" : "/employees/me/attendance/punch-out";
      await api.post(path, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        location: loc,
      });
      toast.push(kind === "in" ? "Punched in." : "Punched out.");
      await invalidateAttendance(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || err.message || "Could not record punch.");
    } finally {
      setPunching(false);
    }
  };

  const startTracking = async () => {
    try {
      setTrackingError("");
      const location = await geo.readPosition();
      const res = await api.post("/employees/me/tracking/start", { durationMinutes: 30, location });
      if (res.data?.success || res.status < 300) {
        setTracking(true);
        attachTrackingWatch();
        toast.push("Live tracking started.");
        await invalidateAttendance(queryClient);
      }
    } catch (err) {
      setTrackingError(err.response?.data?.message || err.message || "Could not start tracking.");
    }
  };

  const stopTracking = async () => {
    if (watchId.current != null) {
      clearWatch(watchId.current);
      watchId.current = null;
    }
    setTracking(false);
    try {
      await api.post("/employees/me/tracking/stop");
      await invalidateAttendance(queryClient);
    } catch {
      // ignore
    }
  };

  const byDate = useMemo(() => {
    const map = {};
    for (const row of history) {
      const key = civilFromRecord(row);
      if (key) map[key] = row;
    }
    return map;
  }, [history]);

  const todayStr = getCompanyBusinessDate(new Date(), timezone);
  const grid = buildMonthGrid(month.year, month.month, { weekStartsOn: 0, todayStr });
  const monthLabel = new Date(Date.UTC(month.year, month.month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const list = useMemo(() => {
    const rows = [...history].sort((a, b) => String(civilFromRecord(b)).localeCompare(String(civilFromRecord(a))));
    if (selected) return rows.filter((row) => civilFromRecord(row) === selected);
    return rows;
  }, [history, selected]);

  const distribution = useMemo(() => {
    let present = 0;
    let absent = 0;
    let overtime = 0;
    let leave = 0;

    for (const rec of history) {
      const cat = calendarCategory(rec);
      if (cat === "present") present++;
      else if (cat === "overtime") overtime++;
      else if (cat === "absent") absent++;
      else if (cat === "leave") leave++;
    }

    const attended = present + overtime;
    const scored = attended + absent;
    const percent = scored > 0 ? Math.round((attended / scored) * 100) : null;
    const total = present + absent + overtime + leave;
    return { present, absent, overtime, leave, attended, scored, percent, total };
  }, [history]);

  const placeTip = (dateStr, el, fromHover) => {
    if (!el) return;
    const rec = byDate[dateStr];
    const rect = el.getBoundingClientRect();
    const tipW = 168;
    const tipH = 88;
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    let top = rect.top - tipH - 8;
    let place = "above";
    if (top < 8) {
      top = rect.bottom + 8;
      place = "below";
    }
    setHoverTip({
      dateStr,
      left,
      top,
      place,
      fromHover: Boolean(fromHover),
      status: statusLabel(rec),
      checkIn: stampOrFallback(getTimes(rec).checkIn, timezone),
      checkOut: stampOrFallback(getTimes(rec).checkOut, timezone),
      hasRecord: Boolean(rec),
    });
  };

  const clearHoverTip = () => {
    setHoverTip((prev) => (prev?.fromHover ? null : prev));
  };

  useEffect(() => {
    if (!selected) {
      setHoverTip((prev) => (prev && !prev.fromHover ? null : prev));
      return;
    }
    const btn = document.querySelector(`[data-cal-day="${selected}"]`);
    if (btn) placeTip(selected, btn, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, byDate, timezone]);

  if (loading) return <><PageHeader title="Attendance History" back /><Skeleton /></>;
  if (error && history.length === 0) {
    return <><PageHeader title="Attendance History" back /><ErrorState message={error} onRetry={() => load()} /></>;
  }

  const todayStatus = String(today?.status || "").toUpperCase();
  const canPunchIn = !punching && todayStatus !== "CHECKED_IN" && todayStatus !== "ON_LEAVE" && todayStatus !== "CHECKED_OUT";
  const canPunchOut = !punching && todayStatus === "CHECKED_IN";
  const barTotal = Math.max(distribution.total, 1);

  return (
    <>
      <PageHeader title="Attendance History" back />
      {(historyQuery.isFetching || dashQuery.isFetching) && history.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      <LocationBanner status={geo.status} error={geo.error} busy={geo.busy} onAsk={geo.ask} onRetry={geo.ask} />
      <section className="card compact-card" style={{ marginBottom: 12 }}>
        <div className="summary-row" style={{ padding: 0, border: "none" }}>
          <span className="summary-body">
            <span className="summary-title">Today</span>
            <span className="summary-sub">
              In {stampOrFallback(today?.checkInTime || today?.checkIn, timezone)} · Out {stampOrFallback(today?.checkOutTime || today?.checkOut, timezone)}
            </span>
          </span>
          <StatusBadge status={todayStatus || "NOT_CHECKED_IN"} />
        </div>
        {canPunchIn ? (
          <button type="button" className="btn-primary btn-block" style={{ marginTop: 10 }} disabled={punching} onClick={() => punch("in")}>
            {punching ? "Recording..." : "Punch in"}
          </button>
        ) : null}
        {canPunchOut ? (
          <button type="button" className="btn-danger btn-block" style={{ marginTop: 10 }} disabled={punching} onClick={() => punch("out")}>
            {punching ? "Recording..." : "Punch out"}
          </button>
        ) : null}
        {todayStatus === "CHECKED_OUT" ? <p className="caption" style={{ marginTop: 8 }}>Shift completed for today.</p> : null}
        {todayStatus === "ON_LEAVE" ? <p className="caption" style={{ marginTop: 8 }}>You are on leave today.</p> : null}
      </section>

      <section className="att-bar-card" aria-label="Attendance summary">
        <div className="att-bar-head">
          <strong>
            {distribution.percent == null ? "Attendance —" : `Attendance ${distribution.percent}%`}
          </strong>
          <span>
            {distribution.scored > 0
              ? `${distribution.attended} of ${distribution.scored} scored days`
              : distribution.total > 0
                ? `${distribution.total} recorded days`
                : "No records this month"}
          </span>
        </div>
        <div className="att-bar-track" role="img" aria-label="Attendance distribution">
          {distribution.total === 0 ? (
            <span className="att-bar-seg is-empty" style={{ flex: 1 }} />
          ) : (
            <>
              {distribution.present > 0 ? (
                <span className="att-bar-seg is-present" style={{ flex: distribution.present / barTotal }} title={`Present ${distribution.present}`} />
              ) : null}
              {distribution.overtime > 0 ? (
                <span className="att-bar-seg is-overtime" style={{ flex: distribution.overtime / barTotal }} title={`Overtime ${distribution.overtime}`} />
              ) : null}
              {distribution.leave > 0 ? (
                <span className="att-bar-seg is-leave" style={{ flex: distribution.leave / barTotal }} title={`Leave ${distribution.leave}`} />
              ) : null}
              {distribution.absent > 0 ? (
                <span className="att-bar-seg is-absent" style={{ flex: distribution.absent / barTotal }} title={`Absent ${distribution.absent}`} />
              ) : null}
            </>
          )}
        </div>
        <div className="att-bar-legend">
          <span><i className="is-present" /> Present {distribution.present}</span>
          <span><i className="is-overtime" /> Overtime {distribution.overtime}</span>
          <span><i className="is-leave" /> Leave {distribution.leave}</span>
          <span><i className="is-absent" /> Absent {distribution.absent}</span>
        </div>
      </section>

      <section className="card cal-card">
        <div className="month-nav" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn-secondary"
            aria-label="Previous month"
            onClick={() => {
              setSelected("");
              setHoverTip(null);
              setMonth(shiftMonth(month.year, month.month, -1));
            }}
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            className="btn-secondary"
            aria-label="Next month"
            onClick={() => {
              setSelected("");
              setHoverTip(null);
              setMonth(shiftMonth(month.year, month.month, 1));
            }}
          >
            ›
          </button>
        </div>
        <div className="cal-weekdays" aria-hidden="true">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>
        <div className="cal-grid">
          {grid.map((day) => {
            const rec = byDate[day.dateStr];
            const cat = calendarCategory(rec);
            const klass = [
              "cal-day",
              day.isOtherMonth ? "is-muted" : "",
              day.isToday ? "is-today" : "",
              selected === day.dateStr ? "is-selected" : "",
              cat ? `is-${cat}` : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={day.dateStr}
                type="button"
                className={klass}
                data-cal-day={day.dateStr}
                onClick={(event) => {
                  const next = selected === day.dateStr ? "" : day.dateStr;
                  setSelected(next);
                  if (next) placeTip(next, event.currentTarget, false);
                  else setHoverTip(null);
                }}
                onMouseEnter={(event) => placeTip(day.dateStr, event.currentTarget, true)}
                onMouseLeave={clearHoverTip}
                aria-label={`${day.dateStr}${rec ? `, ${statusLabel(rec)}` : ""}`}
              >
                {day.day}
              </button>
            );
          })}
        </div>
        <div className="cal-legend">
          <span><i className="is-present" /> Present</span>
          <span><i className="is-absent" /> Absent</span>
          <span><i className="is-overtime" /> Overtime</span>
          <span><i className="is-leave" /> Leave / half day</span>
        </div>
      </section>

      {hoverTip ? (
        <div
          ref={tipRef}
          className={`cal-tip cal-tip--${hoverTip.place}`}
          style={{ left: hoverTip.left, top: hoverTip.top }}
          role="tooltip"
        >
          <strong>{hoverTip.status}</strong>
          <span>In {hoverTip.checkIn}</span>
          <span>Out {hoverTip.checkOut}</span>
          {!hoverTip.hasRecord ? <em>No attendance recorded</em> : null}
        </div>
      ) : null}

      {trackingError ? <div className="alert alert-error">{trackingError}</div> : null}
      {tracking ? (
        <button type="button" className="btn-danger btn-block" style={{ marginBottom: 12 }} onClick={stopTracking}>
          Stop live tracking
        </button>
      ) : (
        <button type="button" className="btn-secondary btn-block" style={{ marginBottom: 12 }} onClick={startTracking}>
          Start live tracking
        </button>
      )}

      {list.length === 0 ? (
        <EmptyState message={selected ? "No attendance record for this date." : "No attendance records for this month."} />
      ) : (
        list.map((row) => {
          const dateStr = civilFromRecord(row);
          const { checkIn, checkOut } = getTimes(row);
          return (
            <div key={row._id || dateStr || recordKey(row)} className="summary-row att-history-row">
              <span className="summary-body" style={{ width: "100%" }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span className="summary-title">{formatDisplayDate(dateStr || row.date, timezone)}</span>
                  <StatusBadge status={row.status || row.attendanceStatus} />
                </span>
                <span className="att-times">
                  <span>Check in<strong>{stampOrFallback(checkIn, timezone)}</strong></span>
                  <span>Check out<strong>{stampOrFallback(checkOut, timezone)}</strong></span>
                  <span>Duration<strong>{row.workingHours && row.workingHours !== "--" ? row.workingHours : "—"}</strong></span>
                </span>
              </span>
            </div>
          );
        })
      )}
    </>
  );
}

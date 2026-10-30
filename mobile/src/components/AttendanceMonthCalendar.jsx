import { useEffect, useMemo, useState } from "react";
import {
  buildMonthGrid,
  getCompanyBusinessDate,
  shiftMonth,
} from "../utils/dateUtils";

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

function formatDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Same visual categories as Employee Portal attendance calendar. */
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

/**
 * Monthly attendance calendar matching Employee Portal visuals.
 * Controlled month via `month` / `onMonthChange` so parents can refetch by range.
 */
export default function AttendanceMonthCalendar({
  records = [],
  timezone = "Asia/Kolkata",
  month,
  onMonthChange,
  onDaySelect,
}) {
  const [selected, setSelected] = useState("");
  const [hoverTip, setHoverTip] = useState(null);

  const now = new Date();
  const activeMonth = month || { year: now.getFullYear(), month: now.getMonth() + 1 };

  const setMonthSafe = (next) => {
    setSelected("");
    setHoverTip(null);
    onMonthChange?.(next);
  };

  const byDate = useMemo(() => {
    const map = {};
    for (const row of records) {
      const key = civilFromRecord(row);
      if (key) map[key] = row;
    }
    return map;
  }, [records]);

  const todayStr = getCompanyBusinessDate(new Date(), timezone);
  const grid = buildMonthGrid(activeMonth.year, activeMonth.month, { weekStartsOn: 0, todayStr });
  const monthLabel = new Date(Date.UTC(activeMonth.year, activeMonth.month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const distribution = useMemo(() => {
    let present = 0;
    let absent = 0;
    let overtime = 0;
    let leave = 0;
    for (const rec of records) {
      const cat = calendarCategory(rec);
      if (cat === "present") present += 1;
      else if (cat === "overtime") overtime += 1;
      else if (cat === "absent") absent += 1;
      else if (cat === "leave") leave += 1;
    }
    const attended = present + overtime;
    const scored = attended + absent;
    const percent = scored > 0 ? Math.round((attended / scored) * 100) : null;
    const total = present + absent + overtime + leave;
    return { present, absent, overtime, leave, attended, scored, percent, total };
  }, [records]);

  const placeTip = (dateStr, el, fromHover) => {
    if (!el) return;
    const rec = byDate[dateStr];
    const times = getTimes(rec);
    const cat = calendarCategory(rec);
    const hours = workedHours(rec);
    const overtimeExtra = cat === "overtime" ? formatDuration(Math.max(0, hours - 8)) : null;
    const rect = el.getBoundingClientRect();
    const tipW = 176;
    const tipH = overtimeExtra || cat === "leave" ? 108 : 88;
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
      checkIn: stampOrFallback(times.checkIn, timezone),
      checkOut: stampOrFallback(times.checkOut, timezone),
      overtime: overtimeExtra,
      leaveNote: cat === "leave" ? statusLabel(rec) : null,
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

  const barTotal = Math.max(distribution.total, 1);

  return (
    <div className="hr-att-cal">
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
                <span className="att-bar-seg is-present" style={{ flex: distribution.present / barTotal }} />
              ) : null}
              {distribution.overtime > 0 ? (
                <span className="att-bar-seg is-overtime" style={{ flex: distribution.overtime / barTotal }} />
              ) : null}
              {distribution.leave > 0 ? (
                <span className="att-bar-seg is-leave" style={{ flex: distribution.leave / barTotal }} />
              ) : null}
              {distribution.absent > 0 ? (
                <span className="att-bar-seg is-absent" style={{ flex: distribution.absent / barTotal }} />
              ) : null}
            </>
          )}
        </div>
        <div className="att-bar-legend">
          <span>
            <i className="is-present" /> Present {distribution.present}
          </span>
          <span>
            <i className="is-overtime" /> Overtime {distribution.overtime}
          </span>
          <span>
            <i className="is-leave" /> Leave {distribution.leave}
          </span>
          <span>
            <i className="is-absent" /> Absent {distribution.absent}
          </span>
        </div>
      </section>

      <section className="card cal-card">
        <div className="month-nav" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn-secondary"
            aria-label="Previous month"
            onClick={() => setMonthSafe(shiftMonth(activeMonth.year, activeMonth.month, -1))}
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            className="btn-secondary"
            aria-label="Next month"
            onClick={() => setMonthSafe(shiftMonth(activeMonth.year, activeMonth.month, 1))}
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
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={day.dateStr}
                type="button"
                className={klass}
                data-cal-day={day.dateStr}
                onClick={(event) => {
                  const next = selected === day.dateStr ? "" : day.dateStr;
                  setSelected(next);
                  onDaySelect?.(next || null, rec || null);
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
          <span>
            <i className="is-present" /> Present
          </span>
          <span>
            <i className="is-absent" /> Absent
          </span>
          <span>
            <i className="is-overtime" /> Overtime
          </span>
          <span>
            <i className="is-leave" /> Leave / half day
          </span>
        </div>
      </section>

      {hoverTip ? (
        <div
          className={`cal-tip cal-tip--${hoverTip.place}`}
          style={{ left: hoverTip.left, top: hoverTip.top, width: 176 }}
          role="tooltip"
        >
          <strong>{hoverTip.status}</strong>
          <span>In {hoverTip.checkIn}</span>
          <span>Out {hoverTip.checkOut}</span>
          {hoverTip.overtime ? <span>OT {hoverTip.overtime}</span> : null}
          {hoverTip.leaveNote && hoverTip.hasRecord ? <span>{hoverTip.leaveNote}</span> : null}
          {!hoverTip.hasRecord ? <em>No attendance recorded</em> : null}
        </div>
      ) : null}
    </div>
  );
}

import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { computeWeeklyBars } from "./attendanceTrendsModel.js";

/**
 * AttendanceTrends — Dedicated, narrowly scoped Attendance Trends component.
 *
 * Keeps hoveredDay state, hover interaction handlers, and range controls local to this card,
 * preventing mouse movement and hover interactions from re-rendering the root AdminDashboard
 * or unrelated dashboard widgets.
 */
function AttendanceTrends({
  overview,
  calendarDays,
  totalEmployees = 0,
  attendanceRestricted = false,
  canAttendance = false,
  summary = {},
  meta = {},
  initialRange = "7D",
}) {
  const [attendanceRange, setAttendanceRange] = useState(initialRange);
  const [hoveredDay, setHoveredDay] = useState(null);

  const weeklyBars = useMemo(
    () => computeWeeklyBars(overview, calendarDays, totalEmployees, attendanceRange),
    [overview, calendarDays, totalEmployees, attendanceRange]
  );

  const hasAttendanceTrendData = useMemo(
    () => weeklyBars.some((b) => (b.present || 0) + (b.late || 0) + (b.onLeave || 0) > 0),
    [weeklyBars]
  );

  return (
    <section className="card analytics-card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Attendance Trends</h2>
        </div>
        <div className="analytics-toolbar">
          <div className="seg-control" role="tablist" aria-label="Select date range">
            <button
              type="button"
              className={`seg-btn ${attendanceRange === "TODAY" ? "is-active" : ""}`}
              onClick={() => setAttendanceRange("TODAY")}
            >
              Today
            </button>
            <button
              type="button"
              className={`seg-btn ${attendanceRange === "7D" ? "is-active" : ""}`}
              onClick={() => setAttendanceRange("7D")}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`seg-btn ${attendanceRange === "30D" ? "is-active" : ""}`}
              onClick={() => setAttendanceRange("30D")}
            >
              30 Days
            </button>
          </div>
          {canAttendance ? (
            <Link to="/admin/live-tracking" className="card-shortcut-pill" title="Live Attendance Tracking">
              <span className="pulse-dot" />
              <span>Live Tracking</span>
            </Link>
          ) : null}
          {canAttendance ? (
            <Link to="/admin/attendance" className="card-shortcut-link" title="Open Attendance">
              <span>Attendance Hub</span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card-scroll-body dash-card-body">
        <div
          className={`capsule-bars-container ${
            attendanceRange === "30D"
              ? "capsule-bars-container--month"
              : attendanceRange === "TODAY"
                ? "capsule-bars-container--today"
                : ""
          }`}
          role="img"
          aria-label="Attendance trend capsule bars"
        >
          {attendanceRestricted ? (
            <p className="activity-empty">Attendance counts are unavailable for this access level.</p>
          ) : weeklyBars.length === 0 || !hasAttendanceTrendData ? (
            <p className="activity-empty">
              No attendance records for this range yet. Punch-ins will appear here once employees check in.
            </p>
          ) : (
            weeklyBars.map((bar, idx) => {
              const isPeak = bar.pct >= 90 && !bar.isWeekend && !bar.isHoliday;
              const isLight = bar.pct < 70 && !bar.isWeekend && !bar.isHoliday;
              const barClass = bar.isWeekend || bar.isHoliday
                ? "bar--weekend"
                : isPeak
                  ? "bar--peak"
                  : isLight
                    ? "bar--light"
                    : "bar--mid";

              return (
                <div
                  key={`${bar.date || bar.dayLetter}-${idx}`}
                  className={`capsule-bar-item ${bar.isToday ? "is-today" : ""}`}
                  onMouseEnter={() => setHoveredDay(bar)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  <div className="capsule-bar-track">
                    <button
                      type="button"
                      className={`capsule-bar ${barClass}`}
                      style={{ "--h": bar.heightVal }}
                      aria-label={`${bar.date || "Day"}: ${bar.present} present, ${bar.absent} absent, ${bar.late} late (${bar.pct}%)`}
                    >
                      <span className="bar-fill" />
                    </button>
                  </div>
                  <span className="bar-day-label">
                    {attendanceRange === "30D" ? (bar.date || "").slice(8) : bar.dayLetter}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="attendance-breakdown-row">
          <div className="attendance-legend-group">
            <span className="legend-item">
              <span className="legend-dot dot-present" />
              <span>
                Present: <b>{attendanceRestricted ? "—" : (hoveredDay ? hoveredDay.present : (summary.todayPresent ?? 0))}</b>
              </span>
            </span>
            <span className="legend-item">
              <span className="legend-dot dot-late" />
              <span>
                Late: <b>{summary.todayLate == null && !hoveredDay ? "—" : (hoveredDay ? hoveredDay.late : (summary.todayLate ?? 0))}</b>
              </span>
            </span>
            <span className="legend-item">
              <span className="legend-dot dot-absent" />
              <span>
                Absent: <b>{attendanceRestricted ? "—" : (hoveredDay ? hoveredDay.absent : (summary.todayAbsent ?? 0))}</b>
              </span>
            </span>
            <span className="legend-item">
              <span className="legend-dot dot-leave" />
              <span>
                On Leave: <b>{summary.onLeave == null && !hoveredDay ? "—" : (hoveredDay ? hoveredDay.onLeave : (summary.onLeave ?? 0))}</b>
              </span>
            </span>
          </div>
          <div className="shift-status-pill">
            <span className="pulse-dot" />
            <span>{hoveredDay ? hoveredDay.date : `Starts ${meta.officeStartTime || "09:30 AM"}`}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(AttendanceTrends);

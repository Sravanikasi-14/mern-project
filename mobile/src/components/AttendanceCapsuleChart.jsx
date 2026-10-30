import { useMemo, useState } from "react";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Mobile adaptation of the desktop AdminDashboard capsule attendance chart.
 * Data: weekly overview days (present/late/absent/leave) + active employee count.
 */
export default function AttendanceCapsuleChart({
  days = [],
  activeEmployees = 0,
  todaySummary = {},
}) {
  const [activeIdx, setActiveIdx] = useState(-1);

  const bars = useMemo(() => {
    const source = Array.isArray(days) ? days.slice(-7) : [];
    const maxVal = Math.max(1, Number(activeEmployees) || 0);

    if (source.length === 0) {
      return DAY_LETTERS.map((letter, idx) => ({
        key: `empty-${idx}`,
        dayLetter: letter,
        pct: 0,
        heightVal: 0.15,
        present: 0,
        late: 0,
        absent: 0,
        onLeave: 0,
        isWeekend: idx === 0 || idx === 6,
        isToday: false,
      }));
    }

    return source.map((d, idx) => {
      const present = Number(d.present ?? d.presentCount ?? 0);
      const late = Number(d.late ?? d.lateCount ?? 0);
      const absent = Number(d.absent ?? d.absentCount ?? 0);
      const onLeave = Number(d.onLeave ?? d.leave ?? d.leaveCount ?? 0);
      const pct = maxVal > 0 ? Math.min(100, Math.round((present / maxVal) * 100)) : 0;
      const label = String(d.label || "");
      const dayLetter =
        DAY_LETTERS[
          (() => {
            if (d.dayOfWeek != null) return Number(d.dayOfWeek);
            const match = label.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
            if (match) {
              const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
              return map[match[1].toLowerCase()] ?? idx;
            }
            if (d.date) {
              const dt = new Date(`${d.date}T12:00:00Z`);
              if (!Number.isNaN(dt.getTime())) return dt.getUTCDay();
            }
            return idx % 7;
          })()
        ] || "•";
      const isWeekend = dayLetter === "S" && (idx === 0 || idx === 6 || present === 0);
      return {
        key: d.date || `${label}-${idx}`,
        date: d.date,
        dayLetter,
        pct,
        heightVal: Math.max(0.18, pct / 100),
        present,
        late,
        absent,
        onLeave,
        isWeekend: Boolean(d.isWeekend) || isWeekend,
        isToday: Boolean(d.isToday),
      };
    });
  }, [days, activeEmployees]);

  const focused = activeIdx >= 0 ? bars[activeIdx] : null;
  const legend = {
    present: focused ? focused.present : Number(todaySummary.todayPresent ?? todaySummary.present ?? 0),
    late: focused ? focused.late : Number(todaySummary.todayLate ?? todaySummary.late ?? 0),
    absent: focused ? focused.absent : Number(todaySummary.todayAbsent ?? todaySummary.absent ?? 0),
    onLeave: focused
      ? focused.onLeave
      : Number(todaySummary.onLeave ?? todaySummary.todayOnLeave ?? 0),
  };

  return (
    <div className="hr-capsule">
      <div className="hr-capsule-bars" role="img" aria-label="Weekly attendance capsule bars">
        {bars.map((bar, idx) => {
          const isPeak = bar.pct >= 90 && !bar.isWeekend;
          const isLight = bar.pct < 70 && !bar.isWeekend;
          const barClass = bar.isWeekend
            ? "bar--weekend"
            : isPeak
              ? "bar--peak"
              : isLight
                ? "bar--light"
                : "bar--mid";
          return (
            <div
              key={bar.key}
              className={`hr-capsule-item${bar.isToday ? " is-today" : ""}${
                activeIdx === idx ? " is-active" : ""
              }`}
            >
              <div className="hr-capsule-track">
                <button
                  type="button"
                  className={`hr-capsule-bar ${barClass}`}
                  style={{ "--h": bar.heightVal }}
                  aria-label={`${bar.date || "Day"}: ${bar.present} present (${bar.pct}%)`}
                  onClick={() => setActiveIdx((prev) => (prev === idx ? -1 : idx))}
                >
                  <span className="hr-capsule-fill" />
                </button>
              </div>
              <span className="hr-capsule-day">{bar.dayLetter}</span>
            </div>
          );
        })}
      </div>

      <div className="hr-capsule-legend">
        <span>
          <i className="dot-present" /> Present: <b>{legend.present}</b>
        </span>
        <span>
          <i className="dot-late" /> Late: <b>{legend.late}</b>
        </span>
        <span>
          <i className="dot-absent" /> Absent: <b>{legend.absent}</b>
        </span>
        <span>
          <i className="dot-leave" /> On Leave: <b>{legend.onLeave}</b>
        </span>
      </div>
    </div>
  );
}

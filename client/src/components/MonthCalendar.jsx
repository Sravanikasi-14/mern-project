import { useMemo, useState } from "react";
import { IconArrowLeft, IconArrowRight } from "./Icons";
import {
  buildMonthGrid,
  dateOnlyInRange,
  getCompanyBusinessDate,
  monthTitle,
  shiftMonth,
  toDateOnlyString,
} from "../utils/dateUtils";
import "./MonthCalendar.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function eventTone(event) {
  const code = String(event.leaveTypeCode || event.leaveType || event.tone || "").toLowerCase();
  if (code.includes("sick")) return "sick";
  if (code.includes("earn") || code.includes("privilege")) return "earned";
  if (event.status && event.status !== "APPROVED") return "pending";
  return "casual";
}

function eventLabel(event) {
  const name = (event.label || event.employeeName || event.employeeId?.fullName || "").trim();
  const first = name ? name.split(" ")[0] : "";
  const type = (event.leaveTypeCode || event.leaveType || "").slice(0, 3);
  if (first && type) return `${first} · ${type}`;
  return first || type || event.title || "Leave";
}

function attendanceTone(dayMeta) {
  return dayMeta?.statusKey || "none";
}

/**
 * Shared month calendar.
 * - Default (leave): event chips
 * - mode="attendance": status-colored days + tooltip/detail via dayStatuses
 */
export default function MonthCalendar({
  year,
  month,
  timeZone,
  events = [],
  dayStatuses = {},
  mode = "events",
  heading,
  onMonthChange,
  onDaySelect,
  selectedDate = "",
  emptyMessage = "No scheduled leave this month.",
  legend = null,
}) {
  const [expandedDate, setExpandedDate] = useState("");
  const [tipDate, setTipDate] = useState("");
  const todayStr = getCompanyBusinessDate(new Date(), timeZone);
  const days = useMemo(
    () => buildMonthGrid(year, month, { weekStartsOn: 1, todayStr }),
    [year, month, todayStr]
  );

  const normalizedEvents = useMemo(
    () =>
      (events || []).map((event) => ({
        ...event,
        startDate: toDateOnlyString(event.startDate || event.fromDate, timeZone),
        endDate: toDateOnlyString(event.endDate || event.toDate || event.startDate || event.fromDate, timeZone),
      })),
    [events, timeZone]
  );

  const handlePrev = () => {
    const next = shiftMonth(year, month, -1);
    onMonthChange?.(next);
  };

  const handleNext = () => {
    const next = shiftMonth(year, month, 1);
    onMonthChange?.(next);
  };

  const isAttendance = mode === "attendance";

  return (
    <div className={`mc-card ${isAttendance ? "mc-card--attendance" : ""}`}>
      <div className="mc-header">
        <h3 className="mc-title">{heading || monthTitle(year, month)}</h3>
        <div className="mc-nav">
          <button type="button" className="mc-nav-btn" onClick={handlePrev} aria-label="Previous month">
            <IconArrowLeft size={18} />
          </button>
          <button type="button" className="mc-nav-btn" onClick={handleNext} aria-label="Next month">
            <IconArrowRight size={18} />
          </button>
        </div>
      </div>

      {legend}

      <div className="mc-grid" role="grid" aria-label={monthTitle(year, month)}>
        {WEEKDAYS.map((label) => (
          <div key={label} className="mc-weekday" role="columnheader">
            {label}
          </div>
        ))}

        {days.map((day) => {
          if (isAttendance) {
            const meta = dayStatuses[day.dateStr] || { statusKey: day.isOtherMonth ? "other" : "none" };
            const tip = meta.tooltip || meta.label || "";
            const isSelected = selectedDate === day.dateStr;
            const showTip = tipDate === day.dateStr && tip;

            return (
              <button
                key={day.dateStr}
                type="button"
                className={`mc-cell mc-cell--status is-${attendanceTone(meta)} ${
                  day.isOtherMonth ? "is-muted" : ""
                } ${day.isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}
                role="gridcell"
                aria-label={`${day.dateStr}: ${meta.label || meta.statusKey}`}
                title={tip}
                disabled={day.isOtherMonth}
                onClick={() => {
                  if (day.isOtherMonth) return;
                  setTipDate((prev) => (prev === day.dateStr ? "" : day.dateStr));
                  onDaySelect?.(day.dateStr, meta);
                }}
                onMouseEnter={() => setTipDate(day.dateStr)}
                onMouseLeave={() => setTipDate((prev) => (prev === day.dateStr ? "" : prev))}
                onFocus={() => setTipDate(day.dateStr)}
                onBlur={() => setTipDate("")}
              >
                <span className={`mc-date ${day.isToday ? "is-today" : ""}`}>{day.day}</span>
                {!day.isOtherMonth && meta.shortLabel ? (
                  <span className="mc-status-label">{meta.shortLabel}</span>
                ) : null}
                {showTip ? <span className="mc-tooltip">{tip}</span> : null}
              </button>
            );
          }

          const dayEvents = normalizedEvents.filter((event) =>
            dateOnlyInRange(day.dateStr, event.startDate, event.endDate)
          );
          const visible = dayEvents.slice(0, 2);
          const extra = dayEvents.length - visible.length;
          const isExpanded = expandedDate === day.dateStr;

          return (
            <div
              key={day.dateStr}
              className={`mc-cell ${day.isOtherMonth ? "is-muted" : ""} ${day.isToday ? "is-today" : ""}`}
              role="gridcell"
              aria-label={day.dateStr}
            >
              <span className={`mc-date ${day.isToday ? "is-today" : ""}`}>{day.day}</span>
              <div className="mc-events">
                {visible.map((event) => (
                  <span
                    key={`${event.id || event._id || eventLabel(event)}-${day.dateStr}`}
                    className={`mc-chip ${eventTone(event)}`}
                    title={
                      event.title ||
                      `${event.employeeName || event.label || "Leave"} (${event.startDate} – ${event.endDate})`
                    }
                  >
                    {eventLabel(event)}
                  </span>
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    className="mc-more"
                    onClick={() => setExpandedDate(isExpanded ? "" : day.dateStr)}
                  >
                    {isExpanded ? "Hide" : `+${extra} more`}
                  </button>
                )}
                {isExpanded &&
                  dayEvents.slice(2).map((event) => (
                    <span
                      key={`extra-${event.id || event._id}-${day.dateStr}`}
                      className={`mc-chip ${eventTone(event)}`}
                      title={event.title || event.employeeName}
                    >
                      {eventLabel(event)}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {!isAttendance && normalizedEvents.length === 0 && <p className="mc-empty">{emptyMessage}</p>}
    </div>
  );
}

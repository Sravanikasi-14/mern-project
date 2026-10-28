import { useMemo } from "react";
import StatusBadge from "./StatusBadge";
import { getCompanyBusinessDate } from "../utils/dateUtils";

/**
 * Reusable horizontal attendance timeline component
 * Follows layout & interaction patterns of Reference Image 2.
 */
export default function AttendanceTimeline({
  date,
  checkIn,
  checkOut,
  workingHours,
  durationMinutes,
  status = "PRESENT",
  notes = "",
  startHour = 8,
  endHour = 24,
}) {
  const totalScaleHours = endHour - startHour; // default 16 hours (8:00 - 24:00)

  // Parse Date label
  const { dayTitle, daySubtitle, isToday } = useMemo(() => {
    if (!date) return { dayTitle: "--", daySubtitle: "", isToday: false };
    try {
      const [year, month, day] = date.split("-").map(Number);
      const utcDate = new Date(Date.UTC(year, month - 1, day));
      const todayStr = getCompanyBusinessDate();
      const todayCheck = date === todayStr;
      const weekday = utcDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      const monthShort = utcDate.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

      return {
        dayTitle: todayCheck ? "Today" : `${weekday}, ${day}`,
        daySubtitle: `${monthShort} ${year}`,
        isToday: todayCheck,
      };
    } catch {
      return { dayTitle: date, daySubtitle: "", isToday: false };
    }
  }, [date]);

  // Parse time values and positions
  const {
    checkInTimeStr,
    checkOutTimeStr,
    displayDuration,
    hasRecord,
    isLate,
    isLiveCheckedIn,
    workingStartPct,
    workingWidthPct,
    hasOvertime,
    overtimeStartPct,
    overtimeWidthPct,
    isOnLeave,
  } = useMemo(() => {
    const onLeave = status === "ON_LEAVE";
    if (onLeave) {
      return {
        checkInTimeStr: "—",
        checkOutTimeStr: "—",
        displayDuration: "Day Off",
        hasRecord: true,
        isLate: false,
        isLiveCheckedIn: false,
        workingStartPct: 0,
        workingWidthPct: 0,
        hasOvertime: false,
        overtimeStartPct: 0,
        overtimeWidthPct: 0,
        isOnLeave: true,
      };
    }

    if (!checkIn) {
      return {
        checkInTimeStr: "—",
        checkOutTimeStr: "—",
        displayDuration: "—",
        hasRecord: false,
        isLate: false,
        isLiveCheckedIn: false,
        workingStartPct: 0,
        workingWidthPct: 0,
        hasOvertime: false,
        overtimeStartPct: 0,
        overtimeWidthPct: 0,
        isOnLeave: false,
      };
    }

    const checkInDate = new Date(checkIn);
    const inHours = checkInDate.getHours() + checkInDate.getMinutes() / 60;
    const inTimeFormatted = checkInDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // Late if checked in after 9:30 AM
    const late = inHours > 9.5;

    let outTimeFormatted = "—";
    let outHours = inHours;
    let liveCheckedIn = false;

    if (checkOut) {
      const checkOutDate = new Date(checkOut);
      outHours = checkOutDate.getHours() + checkOutDate.getMinutes() / 60;
      if (outHours < inHours) outHours += 24; // overnight shift handling
      outTimeFormatted = checkOutDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else {
      liveCheckedIn = true;
      outTimeFormatted = "In Progress";
      const now = new Date();
      outHours = Math.max(inHours + 0.5, now.getHours() + now.getMinutes() / 60);
    }

    // Scale mapping relative to startHour (8) and endHour (24)
    const startPct = Math.max(0, Math.min(95, ((inHours - startHour) / totalScaleHours) * 100));
    const endPct = Math.max(startPct + 3, Math.min(99, ((outHours - startHour) / totalScaleHours) * 100));
    const totalWidth = endPct - startPct;

    // Overtime calculation: if total hours worked > 8.0 hours
    const totalHoursWorked = outHours - inHours;
    const standardLimit = 8.0;

    let workWidth = totalWidth;
    let otStart = 0;
    let otWidth = 0;
    let overtimeDetected = false;

    if (totalHoursWorked > standardLimit && checkOut) {
      overtimeDetected = true;
      const standardWidth = (standardLimit / totalScaleHours) * 100;
      workWidth = Math.min(totalWidth, standardWidth);
      otStart = startPct + workWidth;
      otWidth = Math.max(2, totalWidth - workWidth);
    }

    let dur = workingHours;
    if (!dur || dur === "--") {
      if (durationMinutes) {
        const h = Math.floor(durationMinutes / 60);
        const m = durationMinutes % 60;
        dur = `${h}h ${m}m`;
      } else if (liveCheckedIn) {
        dur = "Active";
      } else {
        const diffMs = Math.max(0, (outHours - inHours) * 3600 * 1000);
        const h = Math.floor(diffMs / 3600000);
        const m = Math.floor((diffMs % 3600000) / 60000);
        dur = `${h}h ${m}m`;
      }
    }

    return {
      checkInTimeStr: inTimeFormatted,
      checkOutTimeStr: outTimeFormatted,
      displayDuration: dur,
      hasRecord: true,
      isLate: late,
      isLiveCheckedIn: liveCheckedIn,
      workingStartPct: startPct,
      workingWidthPct: workWidth,
      hasOvertime: overtimeDetected,
      overtimeStartPct: otStart,
      overtimeWidthPct: otWidth,
      isOnLeave: false,
    };
  }, [checkIn, checkOut, workingHours, durationMinutes, status, startHour, totalScaleHours]);

  // Hour tick marks across the timeline
  const hourTicks = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:59"];

  return (
    <div className="att-timeline-card">
      {/* Header row with Day label, date subtitle, and status badge */}
      <div className="att-timeline-header-row">
        <div className="att-timeline-day-label">
          <span>{dayTitle}</span>
          <span className="att-timeline-day-sub">{daySubtitle}</span>
          {isToday && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#15803d",
                background: "#dcfce7",
                padding: "2px 7px",
                borderRadius: 10,
              }}
            >
              TODAY
            </span>
          )}
        </div>

        <div className="att-timeline-status-group">
          {notes && (
            <span style={{ fontSize: 12, color: "#64748b", fontStyle: "italic", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              "{notes}"
            </span>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Main Timeline Grid: Check-In | Timeline Track & Ticks | Check-Out | Duration */}
      <div className="att-timeline-body">
        {/* Left Side: Check-in Time */}
        <div className="att-time-side punch-in">
          <span className="att-time-caption">Clock-in</span>
          <span>{checkInTimeStr}</span>
        </div>

        {/* Center: Interactive Timeline Track */}
        <div className="att-track-wrapper">
          {/* Hour Scale Ticks */}
          <div className="att-scale-ticks" aria-hidden="true">
            {hourTicks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>

          {/* Bar track container */}
          <div className="att-track-bar">
            {isOnLeave ? (
              <div
                className="att-segment off-day"
                style={{ left: "12%", width: "76%" }}
                title="Approved Leave / Day Off"
              >
                Requested Day Off
                <span className="att-segment-tooltip">Approved Leave Day</span>
              </div>
            ) : hasRecord ? (
              <>
                {/* Late Arrival Indicator Pill */}
                {isLate && (
                  <div
                    className="att-segment late-marker"
                    style={{ left: `${workingStartPct}%` }}
                    title="Late Clock-In"
                  />
                )}

                {/* Working Time Bar */}
                <div
                  className={`att-segment working ${isLiveCheckedIn ? "in-progress-pulse" : ""}`}
                  style={{
                    left: `${workingStartPct}%`,
                    width: `${workingWidthPct}%`,
                  }}
                >
                  {workingWidthPct > 12 && (isLiveCheckedIn ? "In Progress" : "Working time")}
                  <span className="att-segment-tooltip">
                    Working time: {checkInTimeStr} – {checkOutTimeStr} ({displayDuration})
                  </span>
                </div>

                {/* Overtime Segment */}
                {hasOvertime && (
                  <div
                    className="att-segment overtime"
                    style={{
                      left: `${overtimeStartPct}%`,
                      width: `${overtimeWidthPct}%`,
                    }}
                  >
                    {overtimeWidthPct > 10 && "Over time"}
                    <span className="att-segment-tooltip">
                      Overtime: beyond 8 standard hours
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="att-empty-day-track">
                <span>No punch recorded</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Check-out Time */}
        <div className="att-time-side punch-out">
          <span className="att-time-caption">Clock-out</span>
          <span>{checkOutTimeStr}</span>
        </div>

        {/* Far Right: Working Duration */}
        <div className="att-duration-badge">
          <span className="att-duration-sub">Duration</span>
          <span>{displayDuration}</span>
        </div>
      </div>
    </div>
  );
}

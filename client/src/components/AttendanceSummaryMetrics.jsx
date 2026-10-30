import {
  IconCalendarOff,
  IconCheckCircle,
  IconCircleAlert,
  IconClock,
  IconTimer,
  IconTimerOff,
} from "./EmployeeIcon";

/**
 * Compact Attendance Summary Metrics row
 * Inspired by Reference Image 2 top metrics row.
 */

export default function AttendanceSummaryMetrics({
  metrics = {},
  periodLabel = "Current Period",
  showAccentFirst = false,
}) {
  const {
    daysPresent = 0,
    lateClockIns = 0,
    earlyDepartures = 0,
    noClockOuts = 0,
    overtimeHours = 0,
    absentDays = 0,
  } = metrics;

  const items = [
    {
      id: "present",
      label: "Days Present",
      value: daysPresent,
      sub: "Days recorded",
      accent: showAccentFirst,
      icon: <IconCheckCircle size={18} />,
    },
    {
      id: "late",
      label: "Late Clock-In",
      value: lateClockIns,
      sub: "After 09:30 AM",
      accent: false,
      icon: <IconClock size={18} />,
    },
    {
      id: "early-out",
      label: "Early Departure",
      value: earlyDepartures,
      sub: "Before shift end",
      accent: false,
      icon: <IconTimerOff size={18} />,
    },
    {
      id: "no-checkout",
      label: "No Clock-Out",
      value: noClockOuts,
      sub: "Missing punch-out",
      accent: false,
      icon: <IconCircleAlert size={18} />,
    },
    {
      id: "overtime",
      label: "Overtime Hours",
      value: typeof overtimeHours === "number" ? `${overtimeHours}h` : overtimeHours || "0h",
      sub: "Beyond 8h workday",
      accent: false,
      icon: <IconTimer size={18} />,
    },
    {
      id: "absent",
      label: "Absences / Off",
      value: absentDays,
      sub: "Leaves or absent",
      accent: false,
      icon: <IconCalendarOff size={18} />,
    },
  ];

  return (
    <div className="att-summary-row">
      {items.map((item) => (
        <div
          key={item.id}
          className={`att-metric-card ${item.accent ? "accent-card" : ""}`}
        >
          <div className="att-metric-header">
            <span className="att-metric-label">{item.label}</span>
            <div className="att-metric-icon" aria-hidden="true">
              {item.icon}
            </div>
          </div>
          <div className="att-metric-val">{item.value}</div>
          <div className="att-metric-sub">
            <span>{item.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

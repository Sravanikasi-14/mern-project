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
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    {
      id: "late",
      label: "Late Clock-In",
      value: lateClockIns,
      sub: "After 09:30 AM",
      accent: false,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      id: "early-out",
      label: "Early Departure",
      value: earlyDepartures,
      sub: "Before shift end",
      accent: false,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 8 14" />
        </svg>
      ),
    },
    {
      id: "no-checkout",
      label: "No Clock-Out",
      value: noClockOuts,
      sub: "Missing punch-out",
      accent: false,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ),
    },
    {
      id: "overtime",
      label: "Overtime Hours",
      value: typeof overtimeHours === "number" ? `${overtimeHours}h` : overtimeHours || "0h",
      sub: "Beyond 8h workday",
      accent: false,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      id: "absent",
      label: "Absences / Off",
      value: absentDays,
      sub: "Leaves or absent",
      accent: false,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
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

import { ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function shiftPeriod(month, year, delta) {
  const dt = new Date(Date.UTC(Number(year), Number(month) - 1 + delta, 1));
  return { month: dt.getUTCMonth() + 1, year: dt.getUTCFullYear() };
}

export function periodKey(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function isAfterCurrent(month, year, now = new Date()) {
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  return Number(year) > curY || (Number(year) === curY && Number(month) > curM);
}

export function monthYearLabel(month, year) {
  const name = MONTHS[Number(month) - 1] || "Month";
  return `${name} ${year}`;
}

/**
 * Compact previous/next month control. Blocks navigation past the current month by default.
 */
export default function MonthNav({
  month,
  year,
  onChange,
  allowFuture = false,
  className = "",
  label = "Pay period",
}) {
  const canNext = allowFuture || !isAfterCurrent(...Object.values(shiftPeriod(month, year, 1)));

  const go = (delta) => {
    const next = shiftPeriod(month, year, delta);
    if (!allowFuture && isAfterCurrent(next.month, next.year)) return;
    onChange?.(next);
  };

  return (
    <div className={`month-nav${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      <button type="button" className="month-nav__btn" aria-label="Previous month" onClick={() => go(-1)}>
        <ChevronLeft size={18} strokeWidth={2} />
      </button>
      <div className="month-nav__label">
        <span>{label}</span>
        <strong>{monthYearLabel(month, year)}</strong>
      </div>
      <button
        type="button"
        className="month-nav__btn"
        aria-label="Next month"
        disabled={!canNext}
        onClick={() => go(1)}
      >
        <ChevronRight size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

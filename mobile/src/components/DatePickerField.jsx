import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "./Modal";
import {
  buildMonthGrid,
  getCompanyBusinessDate,
  monthTitle,
  parseCivilDate,
  shiftMonth,
} from "../utils/dateUtils";

/**
 * Single compact date control with in-modal month/year navigation + day grid.
 */
export default function DatePickerField({
  value,
  onChange,
  timezone,
  label = "Date",
  className = "",
}) {
  const today = getCompanyBusinessDate(new Date(), timezone);
  const selected = value || today;
  const parts = parseCivilDate(selected) || parseCivilDate(today);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: parts.year, month: parts.month });

  const openPicker = () => {
    const p = parseCivilDate(value || today);
    if (p) setView({ year: p.year, month: p.month });
    setOpen(true);
  };

  const grid = useMemo(
    () => buildMonthGrid(view.year, view.month, { weekStartsOn: 1, todayStr: today }),
    [view.year, view.month, today]
  );

  const display = useMemo(() => {
    const p = parseCivilDate(selected);
    if (!p) return selected;
    return new Date(Date.UTC(p.year, p.month - 1, p.day)).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [selected]);

  const pickDay = (cell) => {
    if (!cell?.dateStr || cell.isOtherMonth) return;
    onChange?.(cell.dateStr);
    setOpen(false);
  };

  return (
    <div className={`date-picker-field${className ? ` ${className}` : ""}`}>
      <button type="button" className="date-picker-field__trigger" onClick={openPicker}>
        <CalendarDays size={18} strokeWidth={1.85} aria-hidden="true" />
        <span className="date-picker-field__copy">
          <span className="date-picker-field__label">{label}</span>
          <strong>{display}</strong>
        </span>
        <em aria-hidden="true">▾</em>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Select date"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onChange?.(today);
                setOpen(false);
              }}
            >
              Today
            </button>
            <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
              Done
            </button>
          </>
        }
      >
        <div className="date-picker-cal">
          <div className="date-picker-cal__nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            >
              <ChevronLeft size={20} strokeWidth={1.85} />
            </button>
            <strong>{monthTitle(view.year, view.month, "en-IN")}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            >
              <ChevronRight size={20} strokeWidth={1.85} />
            </button>
          </div>
          <div className="date-picker-cal__weekdays" aria-hidden="true">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="date-picker-cal__grid" role="grid" aria-label="Calendar">
            {grid.map((cell) => {
              const isSelected = cell.dateStr === selected;
              const isToday = cell.isToday;
              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  role="gridcell"
                  disabled={cell.isOtherMonth}
                  className={`date-picker-cal__day${cell.isOtherMonth ? " is-outside" : ""}${
                    isSelected ? " is-selected" : ""
                  }${isToday ? " is-today" : ""}`}
                  onClick={() => pickDay(cell)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}

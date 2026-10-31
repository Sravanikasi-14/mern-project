import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconClose } from "./Icons";
import {
  buildMonthGrid,
  formatCivilDate,
  formatDisplayDate,
  monthTitle,
  shiftMonth,
} from "../utils/dateUtils";
import "./DateRangePicker.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function cmp(a, b) {
  if (!a || !b) return 0;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeRange(start, end) {
  if (!start && !end) return { startDate: "", endDate: "" };
  if (start && !end) return { startDate: start, endDate: start };
  if (!start && end) return { startDate: end, endDate: end };
  return cmp(start, end) <= 0
    ? { startDate: start, endDate: end }
    : { startDate: end, endDate: start };
}

function inRange(dateStr, start, end) {
  if (!dateStr || !start || !end) return false;
  const { startDate, endDate } = normalizeRange(start, end);
  return dateStr >= startDate && dateStr <= endDate;
}

function formatTriggerLabel(start, end) {
  if (!start && !end) return "";
  if (start && end && start === end) return formatDisplayDate(start);
  if (start && end) return `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
  if (start) return `${formatDisplayDate(start)} – …`;
  return formatDisplayDate(end);
}

/**
 * Reusable inclusive date-range picker (YYYY-MM-DD).
 * Supports drag selection and click-start / click-end.
 */
export default function DateRangePicker({
  startDate = "",
  endDate = "",
  onChange,
  minDate = "",
  maxDate = "",
  label = "Date range",
  placeholder = "Select date range",
  disabled = false,
  className = "",
  autoApply = false,
}) {
  const triggerId = useId();
  const rootRef = useRef(null);
  const draggingRef = useRef(false);
  const anchorRef = useRef("");

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const seed = startDate || endDate || formatCivilDate(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      1
    );
    const [y, m] = seed.split("-").map(Number);
    return { year: y, month: m };
  });
  const [draftStart, setDraftStart] = useState(startDate || "");
  const [draftEnd, setDraftEnd] = useState(endDate || "");
  const [hoverDate, setHoverDate] = useState("");
  const [clickPhase, setClickPhase] = useState("idle"); // idle | wait-end

  useEffect(() => {
    if (!open) {
      setDraftStart(startDate || "");
      setDraftEnd(endDate || "");
      setClickPhase("idle");
      setHoverDate("");
    }
  }, [open, startDate, endDate]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(
    () => buildMonthGrid(view.year, view.month, { weekStartsOn: 1 }),
    [view.year, view.month]
  );

  const preview = useMemo(() => {
    if (draggingRef.current && anchorRef.current && hoverDate) {
      return normalizeRange(anchorRef.current, hoverDate);
    }
    if (clickPhase === "wait-end" && draftStart && hoverDate) {
      return normalizeRange(draftStart, hoverDate);
    }
    return normalizeRange(draftStart, draftEnd);
  }, [draftStart, draftEnd, hoverDate, clickPhase, open]);

  const isDisabledDay = useCallback(
    (dateStr) => {
      if (minDate && dateStr < minDate) return true;
      if (maxDate && dateStr > maxDate) return true;
      return false;
    },
    [minDate, maxDate]
  );

  const commitRange = useCallback(
    (start, end) => {
      const next = normalizeRange(start, end);
      setDraftStart(next.startDate);
      setDraftEnd(next.endDate);
      if (autoApply) {
        onChange?.(next);
        setOpen(false);
      }
    },
    [autoApply, onChange]
  );

  const handlePointerDown = (e, dateStr) => {
    if (disabled || isDisabledDay(dateStr)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    anchorRef.current = dateStr;
    setHoverDate(dateStr);
  };

  const handlePointerEnter = (dateStr) => {
    if (isDisabledDay(dateStr)) return;
    setHoverDate(dateStr);
    if (draggingRef.current && anchorRef.current && dateStr !== anchorRef.current) {
      const next = normalizeRange(anchorRef.current, dateStr);
      setDraftStart(next.startDate);
      setDraftEnd(next.endDate);
      setClickPhase("idle");
    }
  };

  const handlePointerUp = (e, dateStr) => {
    if (!draggingRef.current) return;
    const anchor = anchorRef.current;
    const end = dateStr || hoverDate || anchor;
    const moved = Boolean(anchor && end && anchor !== end);
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (moved) {
      const next = normalizeRange(anchor, end);
      commitRange(next.startDate, next.endDate);
      setClickPhase("idle");
      return;
    }

    // Click-start / click-end
    if (clickPhase === "wait-end" && draftStart) {
      const next = normalizeRange(draftStart, end);
      commitRange(next.startDate, next.endDate);
      setClickPhase("idle");
      return;
    }

    setDraftStart(end);
    setDraftEnd("");
    setClickPhase("wait-end");
  };

  const handleApply = () => {
    const next = normalizeRange(draftStart, draftEnd || draftStart);
    onChange?.(next);
    setOpen(false);
  };

  const handleClear = () => {
    setDraftStart("");
    setDraftEnd("");
    setClickPhase("idle");
    setHoverDate("");
    if (autoApply) {
      onChange?.({ startDate: "", endDate: "" });
      setOpen(false);
    }
  };

  const handleCancel = () => {
    setDraftStart(startDate || "");
    setDraftEnd(endDate || "");
    setOpen(false);
  };

  const triggerText = formatTriggerLabel(startDate, endDate) || placeholder;

  return (
    <div className={`drp-root ${className}`.trim()} ref={rootRef}>
      {label ? (
        <label className="drp-label" htmlFor={triggerId}>
          {label}
        </label>
      ) : null}
      <button
        id={triggerId}
        type="button"
        className={`drp-trigger ${startDate || endDate ? "has-value" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label || "Date range"}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="drp-trigger-text">{triggerText}</span>
        {(startDate || endDate) && (
          <span
            className="drp-trigger-clear"
            role="button"
            tabIndex={0}
            aria-label="Clear date range"
            onClick={(e) => {
              e.stopPropagation();
              onChange?.({ startDate: "", endDate: "" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onChange?.({ startDate: "", endDate: "" });
              }
            }}
          >
            <IconClose size={12} />
          </span>
        )}
      </button>

      {open && (
        <div className="drp-popover" role="dialog" aria-label="Choose date range">
          <div className="drp-nav">
            <button
              type="button"
              className="drp-nav-btn"
              aria-label="Previous month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            >
              <IconArrowLeft size={16} />
            </button>
            <div className="drp-month-title">{monthTitle(view.year, view.month)}</div>
            <button
              type="button"
              className="drp-nav-btn"
              aria-label="Next month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            >
              <IconArrowRight size={16} />
            </button>
          </div>

          <div
            className="drp-grid"
            onPointerLeave={() => {
              if (!draggingRef.current) setHoverDate("");
            }}
          >
            {WEEKDAYS.map((d) => (
              <div key={d} className="drp-weekday">
                {d}
              </div>
            ))}
            {days.map((day) => {
              const disabledDay = isDisabledDay(day.dateStr);
              const isStart = preview.startDate && day.dateStr === preview.startDate;
              const isEnd = preview.endDate && day.dateStr === preview.endDate;
              const isMid =
                preview.startDate &&
                preview.endDate &&
                inRange(day.dateStr, preview.startDate, preview.endDate) &&
                !isStart &&
                !isEnd;

              return (
                <button
                  key={day.dateStr}
                  type="button"
                  className={[
                    "drp-day",
                    day.isOtherMonth ? "is-other" : "",
                    disabledDay ? "is-disabled" : "",
                    isStart ? "is-start" : "",
                    isEnd ? "is-end" : "",
                    isMid ? "is-in-range" : "",
                    isStart && isEnd ? "is-single" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={disabledDay}
                  aria-label={day.dateStr}
                  aria-pressed={isStart || isEnd || isMid}
                  onPointerDown={(e) => handlePointerDown(e, day.dateStr)}
                  onPointerEnter={() => handlePointerEnter(day.dateStr)}
                  onPointerUp={(e) => handlePointerUp(e, day.dateStr)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (clickPhase === "wait-end" && draftStart) {
                        const next = normalizeRange(draftStart, day.dateStr);
                        commitRange(next.startDate, next.endDate);
                        setClickPhase("idle");
                      } else {
                        setDraftStart(day.dateStr);
                        setDraftEnd("");
                        setClickPhase("wait-end");
                      }
                    }
                  }}
                >
                  {day.day}
                </button>
              );
            })}
          </div>

          <div className="drp-footer">
            <button type="button" className="btn-secondary btn-sm" onClick={handleClear}>
              Clear
            </button>
            <div className="drp-footer-right">
              {!autoApply && (
                <button type="button" className="btn-secondary btn-sm" onClick={handleCancel}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={handleApply}
                disabled={!draftStart}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

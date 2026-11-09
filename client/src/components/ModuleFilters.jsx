import { useEffect, useId, useRef, useState } from "react";

/**
 * Shared filter trigger + popover used by ModuleToolbar.
 * Page-specific filter fields are passed as children.
 */
export default function ModuleFilters({
  children,
  filterCount = 0,
  onClear,
  label = "Filters",
  applyLabel = "Done",
  clearLabel = "Clear",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!children) return null;

  return (
    <div className={`module-toolbar-filters ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`btn-secondary module-toolbar-filters-btn${filterCount > 0 ? " is-active" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <span>{label}</span>
        {filterCount > 0 ? (
          <span className="module-toolbar-filters-count" aria-label={`${filterCount} active filters`}>
            {filterCount}
          </span>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open ? (
        <div id={panelId} className="module-toolbar-filters-panel" role="dialog" aria-label={label}>
          <div className="module-toolbar-filters-body">{children}</div>
          <div className="module-toolbar-filters-footer">
            {onClear ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onClear()}
                disabled={filterCount === 0}
              >
                {clearLabel}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
              {applyLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Consistent labeled control used inside ModuleFilters panels. */
export function ModuleFilterField({ label, children, className = "" }) {
  return (
    <label className={`module-toolbar-filter-field ${className}`.trim()}>
      {label}
      {children}
    </label>
  );
}

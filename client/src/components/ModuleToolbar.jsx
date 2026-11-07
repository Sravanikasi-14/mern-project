import { useEffect, useId, useRef, useState } from "react";
import ModuleSearch from "./ModuleSearch";
import "./ModuleToolbar.css";

/**
 * Unified HRMS module toolbar.
 * Layout: [optional leading] [Search] ........ [actions] [Filters]
 * Module-specific filters render inside one Filters popover.
 */
export default function ModuleToolbar({
  className = "",
  leading = null,
  hideSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = "Search…",
  searchAriaLabel = "Search",
  actions = null,
  filters = null,
  filterCount = 0,
  onFiltersClear,
  filtersLabel = "Filters",
  applyLabel = "Done",
  clearLabel = "Clear",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();
  const hasFilters = Boolean(filters);

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

  const handleClear = () => {
    onFiltersClear?.();
  };

  const handleApply = () => {
    setOpen(false);
  };

  return (
    <div className={`module-toolbar ${className}`.trim()} ref={rootRef}>
      <div className="module-toolbar-left">
        {leading}
        {!hideSearch && onSearchChange ? (
          <ModuleSearch
            value={searchValue}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
            placeholder={searchPlaceholder}
            ariaLabel={searchAriaLabel}
          />
        ) : null}
      </div>

      <div className="module-toolbar-right">
        {actions}
        {hasFilters ? (
          <div className="module-toolbar-filters">
            <button
              type="button"
              className={`btn-secondary module-toolbar-filters-btn${filterCount > 0 ? " is-active" : ""}`}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((prev) => !prev)}
            >
              <span>{filtersLabel}</span>
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
              <div id={panelId} className="module-toolbar-filters-panel" role="dialog" aria-label={filtersLabel}>
                <div className="module-toolbar-filters-body">{filters}</div>
                <div className="module-toolbar-filters-footer">
                  {onFiltersClear ? (
                    <button type="button" className="btn-secondary" onClick={handleClear} disabled={filterCount === 0}>
                      {clearLabel}
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="btn-primary" onClick={handleApply}>
                    {applyLabel}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

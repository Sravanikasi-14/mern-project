import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeFilterPanelPlacement } from "./moduleFilterPanelPlacement";

/**
 * Shared filter trigger + popover used by ModuleToolbar.
 * Page-specific filter fields are passed as children.
 *
 * Panel is portaled + position:fixed so page scroll / table overflow cannot
 * push Clear/Done off-screen. Body scrolls independently; footer stays pinned.
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
  const [panelStyle, setPanelStyle] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }

    const place = () => {
      const root = rootRef.current;
      if (!root) return;
      const triggerEl =
        root.querySelector(".module-toolbar-filters-btn") || root;
      const trigger = triggerEl.getBoundingClientRect();
      const placed = computeFilterPanelPlacement(trigger, window);
      setPanelStyle({
        position: "fixed",
        top: `${placed.top}px`,
        left: `${placed.left}px`,
        width: `${placed.width}px`,
        maxHeight: `${placed.maxHeight}px`,
        right: "auto",
        zIndex: 1200,
      });
    };

    place();
    const panel = panelRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && panel
        ? new ResizeObserver(() => place())
        : null;
    if (ro && panel) ro.observe(panel);

    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      const t = event.target;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      // Nested menus (manager / date range) portal to document.body while open
      if (typeof t?.closest === "function" && t.closest("[data-filter-submenu='true']")) return;
      setOpen(false);
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

  const panel = open ? (
    <div
      id={panelId}
      ref={panelRef}
      className="module-toolbar-filters-panel is-viewport-fixed"
      role="dialog"
      aria-label={label}
      style={panelStyle || undefined}
      data-filter-panel="true"
    >
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
  ) : null;

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

      {open && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
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

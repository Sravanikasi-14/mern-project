import { useState } from "react";
import MobileSheet from "./MobileSheet";

export default function MobileFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search",
  filterCount = 0,
  onReset,
  children,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="m-filter-bar">
        {onSearchChange && (
          <input
            type="search"
            className="search-input"
            value={search}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        )}
        <button
          type="button"
          className={`m-filter-btn${filterCount > 0 ? " is-active" : ""}`}
          onClick={() => setOpen(true)}
        >
          Filters{filterCount > 0 ? ` (${filterCount})` : ""}
        </button>
      </div>
      <MobileSheet open={open} onClose={() => setOpen(false)} title="Filters">
        {children}
        <div className="m-sheet-actions">
          {onReset && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onReset();
              }}
            >
              Reset
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => setOpen(false)}>
            Apply
          </button>
        </div>
      </MobileSheet>
    </>
  );
}

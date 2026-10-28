import { useId } from "react";
import { IconArrowLeft, IconArrowRight } from "./Icons";
export { useClientPagination } from "./useClientPagination.js";

/**
 * Reusable Enterprise Pagination Component
 * Aligned with the green-and-white theme.
 */
export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  itemLabel = "records",
  compact = false,
  className = "",
}) {
  const selectId = useId();
  const safeCurrentPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  const canPrev = safeCurrentPage > 1;
  const canNext = safeCurrentPage < totalPages;

  const handlePrev = () => {
    if (canPrev && onPageChange) {
      onPageChange(safeCurrentPage - 1);
    }
  };

  const handleNext = () => {
    if (canNext && onPageChange) {
      onPageChange(safeCurrentPage + 1);
    }
  };

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = [];
    pages.push(1);

    if (safeCurrentPage > 3) {
      pages.push("ellipsis-1");
    }

    const start = Math.max(2, safeCurrentPage - 1);
    const end = Math.min(totalPages - 1, safeCurrentPage + 1);

    for (let p = start; p <= end; p++) {
      pages.push(p);
    }

    if (safeCurrentPage < totalPages - 2) {
      pages.push("ellipsis-2");
    }

    pages.push(totalPages);
    return pages;
  };

  return (
    <div
      className={`app-pagination-bar ${compact ? "app-pagination-compact" : ""} ${className}`}
      role="navigation"
      aria-label="Pagination Navigation"
    >
      <div className="app-pagination-info">
        {totalItems > 0 ? (
          <span>
            Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of{" "}
            <strong>{totalItems}</strong> {itemLabel}
          </span>
        ) : (
          <span>No {itemLabel} found</span>
        )}
      </div>

      <div className="app-pagination-controls">
        {onPageSizeChange && pageSizeOptions && pageSizeOptions.length > 0 && (
          <div className="app-pagination-size-wrap">
            <label htmlFor={selectId} className="app-pagination-size-label">
              Rows:
            </label>
            <select
              id={selectId}
              className="app-pagination-size-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Select rows per page"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} / page
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="app-pagination-nav-group">
          <button
            type="button"
            className="app-pagination-btn prev-btn"
            disabled={!canPrev}
            onClick={handlePrev}
            aria-label="Previous page"
            title="Previous page"
          >
            <IconArrowLeft size={20} />
            <span className="app-pagination-btn-text">Prev</span>
          </button>

          {!compact && (
            <div className="app-pagination-pages-list">
              {getPageNumbers().map((item, idx) => {
                if (typeof item === "string") {
                  return (
                    <span key={`ell-${idx}`} className="app-pagination-ellipsis" aria-hidden="true">
                      …
                    </span>
                  );
                }
                const isActive = item === safeCurrentPage;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`app-pagination-page-btn ${isActive ? "active" : ""}`}
                    onClick={() => onPageChange && onPageChange(item)}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`Page ${item}`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          )}

          {compact && (
            <span className="app-pagination-compact-indicator">
              Page {safeCurrentPage} of {totalPages || 1}
            </span>
          )}

          <button
            type="button"
            className="app-pagination-btn next-btn"
            disabled={!canNext}
            onClick={handleNext}
            aria-label="Next page"
            title="Next page"
          >
            <span className="app-pagination-btn-text">Next</span>
            <IconArrowRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

import { IconArrowLeft, IconArrowRight } from "./Icons";

/**
 * Reusable Enterprise Pagination Component
 * Aligned with the green-and-white theme.
 *
 * @param {Object} props
 * @param {number} props.currentPage - Current page number (1-based)
 * @param {number} props.totalPages - Total number of pages
 * @param {number} props.totalItems - Total count of records
 * @param {number} props.pageSize - Number of items per page
 * @param {number[]} [props.pageSizeOptions] - Configurable page sizes (e.g. [10, 25, 50, 100])
 * @param {function} props.onPageChange - Callback when page changes (newPage: number)
 * @param {function} [props.onPageSizeChange] - Callback when page size changes (newSize: number)
 * @param {string} [props.itemLabel] - Label for items (default: "records")
 * @param {boolean} [props.compact] - Compact mode for tight panels
 * @param {string} [props.className] - Additional class name
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

  // Generate page numbers to display with intelligent truncation
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
      {/* Left: Range and Record Counter */}
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

      {/* Center/Right: Page Size Selector & Navigation Controls */}
      <div className="app-pagination-controls">
        {onPageSizeChange && pageSizeOptions && pageSizeOptions.length > 0 && (
          <div className="app-pagination-size-wrap">
            <label htmlFor="pagination-page-size-select" className="app-pagination-size-label">
              Rows:
            </label>
            <select
              id="pagination-page-size-select"
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
            <IconArrowLeft size={14} />
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
            <IconArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

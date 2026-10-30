/**
 * Compact mobile pagination. Reuses server page/limit — does not client-slice full datasets.
 */
export default function Pagination({
  page = 1,
  totalPages = 1,
  totalItems = 0,
  pageSize = 10,
  onPageChange,
  itemLabel = "records",
  className = "",
}) {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safePage = Math.min(Math.max(1, Number(page) || 1), safeTotalPages);
  const total = Math.max(0, Number(totalItems) || 0);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);
  const canPrev = safePage > 1;
  const canNext = safePage < safeTotalPages;

  if (total === 0 && safeTotalPages <= 1) return null;

  return (
    <nav
      className={`m-pagination${className ? ` ${className}` : ""}`}
      aria-label="Pagination"
    >
      <p className="m-pagination__meta">
        {total > 0 ? (
          <>
            <strong>
              {start}–{end}
            </strong>{" "}
            of <strong>{total}</strong> {itemLabel}
          </>
        ) : (
          <>No {itemLabel}</>
        )}
      </p>
      <div className="m-pagination__controls">
        <button
          type="button"
          className="m-pagination__btn"
          disabled={!canPrev}
          onClick={() => canPrev && onPageChange?.(safePage - 1)}
          aria-label="Previous page"
        >
          Prev
        </button>
        <span className="m-pagination__page">
          {safePage} / {safeTotalPages}
        </span>
        <button
          type="button"
          className="m-pagination__btn"
          disabled={!canNext}
          onClick={() => canNext && onPageChange?.(safePage + 1)}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

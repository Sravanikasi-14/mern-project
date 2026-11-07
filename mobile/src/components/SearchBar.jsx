export default function SearchBar({
  value,
  onChange,
  placeholder = "Search",
  onFilter,
  filterActive = false,
  filterCount = 0,
}) {
  const count = Number(filterCount) > 0 ? Number(filterCount) : 0;
  return (
    <div className="search-row">
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        autoComplete="off"
      />
      {onFilter ? (
        <button
          type="button"
          className={`filter-btn${filterActive || count > 0 ? " is-active" : ""}`}
          onClick={onFilter}
          aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {count > 0 ? (
            <span className="filter-btn-count" aria-hidden="true">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

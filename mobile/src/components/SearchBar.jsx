export default function SearchBar({
  value,
  onChange,
  placeholder = "Search",
  onFilter,
  filterActive = false,
}) {
  return (
    <div className="search-row">
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {onFilter ? (
        <button
          type="button"
          className={`filter-btn${filterActive ? " is-active" : ""}`}
          onClick={onFilter}
          aria-label="Filters"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

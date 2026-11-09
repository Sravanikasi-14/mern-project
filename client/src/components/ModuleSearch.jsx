/**
 * Shared page-level search field for ModuleToolbar / MobileFilterBar.
 * Distinct from GlobalSearch (header cross-module search).
 */
export default function ModuleSearch({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = "Search…",
  ariaLabel = "Search",
  id,
  name = "q",
  className = "",
  loading = false,
  disabled = false,
  autoFocus = false,
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(event);
  };

  const handleClear = () => {
    if (disabled) return;
    if (onClear) {
      onClear();
      return;
    }
    if (onChange) {
      onChange({ target: { value: "", name } });
    }
  };

  const hasValue = Boolean(String(value || "").length);

  return (
    <form
      className={`module-search${loading ? " is-loading" : ""}${disabled ? " is-disabled" : ""} ${className}`.trim()}
      onSubmit={handleSubmit}
      role="search"
    >
      <span className="module-search-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>
      <input
        id={id}
        name={name}
        type="search"
        className="module-search-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {loading ? (
        <span className="module-search-spinner" aria-label="Searching" role="status" />
      ) : null}
      {hasValue && !loading ? (
        <button
          type="button"
          className="module-search-clear"
          onClick={handleClear}
          aria-label="Clear search"
          disabled={disabled}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : null}
    </form>
  );
}

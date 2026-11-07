/**
 * Standard module toolbar search field.
 * Preserves caller-controlled value/onChange/submit behaviour.
 */
export default function ModuleSearch({
  value,
  onChange,
  onSubmit,
  placeholder = "Search…",
  ariaLabel = "Search",
  id,
  name = "q",
  className = "",
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(event);
  };

  return (
    <form
      className={`module-search ${className}`.trim()}
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
      />
    </form>
  );
}

import { Search, X } from "lucide-react";

export default function ExplorerGroupSearch({
  value,
  onChange,
  placeholder = "Search…",
  ariaLabel = "Search",
}) {
  return (
    <div className="org-search-field oe-group-search">
      <Search size={15} className="org-search-icon" aria-hidden="true" />
      <input
        className="org-search"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="org-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

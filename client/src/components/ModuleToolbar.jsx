import ModuleSearch from "./ModuleSearch";
import ModuleFilters from "./ModuleFilters";
import "./ModuleToolbar.css";

/**
 * Page tools strip under PageIdentity (not the sticky global bar).
 * Layout: [leading + primary actions] [expandable local search] [secondary + filters]
 * Search grows to fill remaining space — never a fixed centered 320px column.
 * GlobalSearch remains exclusively in AppHeader.
 */
export default function ModuleToolbar({
  className = "",
  leading = null,
  hideSearch = false,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  onSearchClear,
  searchPlaceholder = "Search…",
  searchAriaLabel = "Search",
  searchLoading = false,
  searchDisabled = false,
  searchId,
  actions = null,
  secondaryActions = null,
  filters = null,
  filterCount = 0,
  onFiltersClear,
  filtersLabel = "Filters",
  applyLabel = "Done",
  clearLabel = "Clear",
}) {
  const showSearch = !hideSearch && typeof onSearchChange === "function";
  const hasStart = Boolean(leading) || Boolean(actions);
  const hasEnd = Boolean(secondaryActions) || Boolean(filters);

  return (
    <div
      className={`module-toolbar ${className}`.trim()}
      role="toolbar"
      aria-label="Page tools"
      data-toolbar="module"
      data-has-search={showSearch ? "true" : "false"}
    >
      <div className={`module-toolbar-start${hasStart ? "" : " is-empty"}`}>
        {leading}
        {actions ? <div className="module-toolbar-actions">{actions}</div> : null}
      </div>

      <div className={`module-toolbar-search-slot${showSearch ? "" : " is-empty"}`}>
        {showSearch ? (
          <ModuleSearch
            id={searchId}
            value={searchValue}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
            onClear={onSearchClear}
            placeholder={searchPlaceholder}
            ariaLabel={searchAriaLabel}
            loading={searchLoading}
            disabled={searchDisabled}
          />
        ) : null}
      </div>

      <div className={`module-toolbar-end${hasEnd ? "" : " is-empty"}`}>
        {secondaryActions ? (
          <div className="module-toolbar-actions module-toolbar-actions--secondary">
            {secondaryActions}
          </div>
        ) : null}
        {filters ? (
          <ModuleFilters
            filterCount={filterCount}
            onClear={onFiltersClear}
            label={filtersLabel}
            applyLabel={applyLabel}
            clearLabel={clearLabel}
          >
            {filters}
          </ModuleFilters>
        ) : null}
      </div>
    </div>
  );
}

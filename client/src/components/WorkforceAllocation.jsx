export default function WorkforceAllocation({
  departments = [],
  total = 0,
  loading = false,
  compact = false,
  hideTitle = false,
  layout = "list",
}) {
  const list = Array.isArray(departments) ? departments : [];
  const totalCount = total || list.reduce((sum, d) => sum + Number(d.count || 0), 0);

  const emptyState = loading && list.length === 0 ? (
    <p className="wf-alloc-empty">Loading department distribution…</p>
  ) : list.length === 0 ? (
    <p className="wf-alloc-empty">No department data available.</p>
  ) : null;

  if (emptyState) {
    return hideTitle ? emptyState : <div className={compact ? "wf-alloc wf-alloc--compact" : "wf-alloc"}>{emptyState}</div>;
  }

  if (layout === "sections") {
    // One section node per department — no redundant outer wrappers.
    // Equal columns across full width; wrap only when many departments.
    const columnCount = list.length > 0 && list.length <= 8 ? list.length : undefined;
    const grid = (
      <div
        className="wf-dept-grid"
        role="list"
        aria-label="Departments"
        style={
          columnCount
            ? { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {list.map((dept) => {
          const count = Number(dept.count || 0);
          const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
          return (
            <section key={dept.name} className="wf-dept-section" role="listitem" aria-label={dept.name}>
              <span className="wf-dept-name" title={dept.name}>
                {dept.name}
              </span>
              <div className="wf-dept-figures">
                <span className="wf-dept-count">{count}</span>
                <span className="wf-dept-pct">{pct}% of team</span>
              </div>
              <div
                className="wf-alloc-track"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label={`${dept.name} ${pct} percent`}
              >
                <div className="wf-alloc-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
              </div>
            </section>
          );
        })}
      </div>
    );

    if (hideTitle) return grid;

    return (
      <div className={compact ? "wf-alloc wf-alloc--compact" : "wf-alloc"}>
        <div className="wf-alloc-head">
          <h3 className="wf-alloc-title">Workforce Allocation</h3>
          <span className="wf-alloc-badge">By department</span>
        </div>
        {grid}
      </div>
    );
  }

  return (
    <div className={compact ? "wf-alloc wf-alloc--compact" : "wf-alloc"}>
      {!hideTitle && (
        <div className="wf-alloc-head">
          <h3 className="wf-alloc-title">Workforce Allocation</h3>
          <span className="wf-alloc-badge">By department</span>
        </div>
      )}
      <div className="wf-alloc-list">
        {list.slice(0, 8).map((dept) => {
          const count = Number(dept.count || 0);
          const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
          return (
            <div key={dept.name} className="wf-alloc-item">
              <div className="wf-alloc-item-head">
                <span className="wf-alloc-name" title={dept.name}>
                  {dept.name}
                </span>
                <span className="wf-alloc-count">
                  {count} ({pct}%)
                </span>
              </div>
              <div
                className="wf-alloc-track"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label={`${dept.name} ${pct} percent`}
              >
                <div className="wf-alloc-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

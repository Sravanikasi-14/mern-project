export default function WorkforceAllocation({
  departments = [],
  total = 0,
  loading = false,
  compact = false,
  hideTitle = false,
}) {
  const list = Array.isArray(departments) ? departments : [];
  const totalCount = total || list.reduce((sum, d) => sum + Number(d.count || 0), 0);

  return (
    <div className={compact ? "wf-alloc wf-alloc--compact" : "wf-alloc"}>
      {!hideTitle && (
        <div className="wf-alloc-head">
          <h3 className="wf-alloc-title">Workforce Allocation</h3>
          <span className="wf-alloc-badge">By department</span>
        </div>
      )}

      {loading && list.length === 0 ? (
        <p className="wf-alloc-empty">Loading department distribution…</p>
      ) : list.length === 0 ? (
        <p className="wf-alloc-empty">No department data available.</p>
      ) : (
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
      )}
    </div>
  );
}

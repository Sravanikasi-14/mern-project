/**
 * TableSkeleton.jsx
 * Provides consistent, layout-stable skeleton placeholder rows matching
 * table structures across all HRMS modules.
 */

export function TableSkeletonRows({
  rowCount = 5,
  colCount = 6,
  widths = ["80px", "180px", "140px", "110px", "90px", "70px"],
}) {
  const rows = Array.from({ length: rowCount }, (_, i) => i);
  const cols = Array.from({ length: colCount }, (_, j) => j);

  return (
    <>
      {rows.map((rIdx) => (
        <tr key={`skeleton-row-${rIdx}`} className="skeleton-row">
          {cols.map((cIdx) => {
            const width = widths[cIdx % widths.length] || "100px";
            return (
              <td key={`skeleton-cell-${rIdx}-${cIdx}`} style={{ verticalAlign: "middle" }}>
                <div
                  className="skeleton-bar"
                  style={{
                    width,
                    maxWidth: "100%",
                    opacity: 0.6 + ((rIdx + cIdx) % 3) * 0.15,
                  }}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export default function TableSkeleton({
  rowCount = 5,
  colCount = 6,
  headers = [],
  widths,
}) {
  return (
    <div className="data-table-container">
      <table className="data-table">
        {headers && headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          <TableSkeletonRows
            rowCount={rowCount}
            colCount={headers.length > 0 ? headers.length : colCount}
            widths={widths}
          />
        </tbody>
      </table>
    </div>
  );
}

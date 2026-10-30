import { Link } from "react-router-dom";

export default function StatTiles({ items }) {
  return (
    <div className="stat-grid">
      {items.map((item) => {
        const body = (
          <>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.hint ? <em>{item.hint}</em> : null}
          </>
        );
        if (item.to) {
          return (
            <Link key={item.label} className="stat-tile" to={item.to}>
              {body}
            </Link>
          );
        }
        return (
          <div key={item.label} className="stat-tile">
            {body}
          </div>
        );
      })}
    </div>
  );
}

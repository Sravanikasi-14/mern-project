import Icon from "./Icon";

export default function MoreList({ items, onSelect }) {
  return (
    <div className="card more-list">
      {items.map((item) => (
        <button key={item.path || item.id} type="button" onClick={() => onSelect(item)}>
          <span className="more-icon" style={{ background: item.color || "var(--g-100)", color: item.ink || "var(--g-800)" }}>
            <Icon name={item.icon || "policies"} />
          </span>
          <span className="summary-body">
            <span className="summary-title">{item.label || item.title}</span>
            {item.sub ? <span className="summary-sub">{item.sub}</span> : null}
          </span>
          <span className="chevron" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

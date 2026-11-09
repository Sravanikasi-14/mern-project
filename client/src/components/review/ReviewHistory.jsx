import "./review.css";

/**
 * items: [{ id, title, detail, tone? }]
 */
export default function ReviewHistory({ items = [], className = "" }) {
  if (!items.length) return null;

  return (
    <div className={`review-history ${className}`.trim()}>
      {items.map((item) => (
        <div key={item.id} className="review-history-item">
          <span
            className="review-history-dot"
            style={
              item.tone === "rejected"
                ? { background: "#c23b3b" }
                : item.tone === "changes"
                  ? { background: "#b06d0a" }
                  : undefined
            }
            aria-hidden="true"
          />
          <div className="review-history-body">
            <strong>{item.title}</strong>
            {item.detail ? <span>{item.detail}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

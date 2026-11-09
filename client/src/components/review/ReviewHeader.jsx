import ReviewStatusBadge from "./ReviewStatusBadge";
import "./review.css";

export default function ReviewHeader({
  title,
  meta,
  avatarText,
  status,
  statusLabel,
  statusTone,
  actions = null,
  className = "",
}) {
  return (
    <header className={`review-header ${className}`.trim()}>
      <div className="review-header-identity">
        {avatarText ? (
          <span className="review-header-avatar" aria-hidden="true">
            {avatarText}
          </span>
        ) : null}
        <div className="review-header-text">
          <h3 className="review-header-title">{title}</h3>
          {meta ? <p className="review-header-meta">{meta}</p> : null}
        </div>
      </div>
      <div className="review-header-actions">
        {status ? (
          <ReviewStatusBadge status={status} label={statusLabel} tone={statusTone} />
        ) : null}
        {actions}
      </div>
    </header>
  );
}

import "./review.css";

export default function ReviewSection({ title, children, className = "", id }) {
  return (
    <section className={`review-section ${className}`.trim()} aria-labelledby={id}>
      {title ? (
        <h3 id={id} className="review-section-title">
          {title}
        </h3>
      ) : null}
      <div className="review-section-body">{children}</div>
    </section>
  );
}

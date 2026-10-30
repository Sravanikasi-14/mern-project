import StatusBadge from "../StatusBadge";

export default function MobileSummaryRow({
  initials,
  title,
  subtitle,
  status,
  statusLabel,
  onClick,
  children,
}) {
  return (
    <div className="m-summary-wrap">
      <button type="button" className="m-summary" onClick={onClick}>
        {initials ? <span className="m-summary-avatar">{initials}</span> : null}
        <span className="m-summary-body">
          <span className="m-summary-title">{title}</span>
          {subtitle ? <span className="m-summary-sub">{subtitle}</span> : null}
        </span>
        {status ? <StatusBadge status={status} label={statusLabel} /> : null}
        <span className="m-chevron" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

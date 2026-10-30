import StatusBadge from "./StatusBadge";

export default function SummaryRow({
  initials,
  title,
  subtitle,
  status,
  statusLabel,
  onClick,
  children,
}) {
  const inner = (
    <>
      {initials ? <span className="summary-avatar">{initials}</span> : null}
      <span className="summary-body">
        <span className="summary-title">{title}</span>
        {subtitle ? <span className="summary-sub">{subtitle}</span> : null}
      </span>
      {status ? <StatusBadge status={status} label={statusLabel} /> : null}
      {onClick ? <span className="chevron" aria-hidden="true" /> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="summary-row" onClick={onClick}>
        {inner}
        {children}
      </button>
    );
  }

  return (
    <div className="summary-row">
      {inner}
      {children}
    </div>
  );
}

export { initialsFrom } from "./ProfileAvatar";

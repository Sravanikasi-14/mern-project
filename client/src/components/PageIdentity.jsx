import "./PageIdentity.css";

/**
 * Row 2 under the sticky global toolbar: page title, optional subtitle, optional nav.
 * Tabs / stage chips / category selectors belong here (or as siblings immediately below).
 */
export default function PageIdentity({
  title,
  subtitle,
  className = "",
  children = null,
}) {
  if (!title && !subtitle && !children) return null;

  return (
    <div className={`page-identity ${className}`.trim()}>
      {(title || subtitle) && (
        <div className="page-identity-heading">
          {title ? <h1 className="page-identity-title">{title}</h1> : null}
          {subtitle ? <p className="page-identity-subtitle">{subtitle}</p> : null}
        </div>
      )}
      {children ? <div className="page-identity-nav">{children}</div> : null}
    </div>
  );
}

import { AlertCircle, AlertTriangle, CheckCircle2, Info, Inbox } from "lucide-react";

export function PaPageHeader({ title, description, actions = null }) {
  return (
    <header className="pa-page-header">
      <div className="pa-page-header-text">
        <h1 className="pa-page-title">{title}</h1>
        {description ? <p className="pa-page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="pa-page-actions">{actions}</div> : null}
    </header>
  );
}

export function PaStatusBadge({ status, tone = null }) {
  const raw = String(status || "UNKNOWN").toUpperCase();
  const resolved =
    tone ||
    (raw === "SUSPENDED" || raw === "CANCELLED" || raw === "DENIED"
      ? "danger"
      : raw === "FAILED" || raw === "UNKNOWN" || raw === "PENDING" || raw === "EXPIRED" || raw === "PAST_DUE"
        ? "warn"
        : raw === "ACTIVE" || raw === "SUCCESS" || raw === "CURRENT"
          ? "success"
          : raw === "TRIAL"
            ? "info"
            : "neutral");

  return <span className={`pa-badge is-${resolved}`}>{raw}</span>;
}

export function PaLoadingState({ title = "Loading", message = "Fetching platform data…" }) {
  return (
    <div className="pa-state pa-state-loading" role="status" aria-live="polite">
      <div className="pa-state-spinner" aria-hidden />
      <div>
        <div className="pa-state-title">{title}</div>
        <p className="pa-state-copy">{message}</p>
      </div>
    </div>
  );
}

export function PaErrorState({ title = "Unable to load", message }) {
  return (
    <div className="pa-state pa-state-error" role="alert">
      <AlertCircle size={20} strokeWidth={2} />
      <div>
        <div className="pa-state-title">{title}</div>
        <p className="pa-state-copy">{message || "Something went wrong. Try again."}</p>
      </div>
    </div>
  );
}

export function PaEmptyState({ title = "Nothing here yet", message, action = null }) {
  return (
    <div className="pa-empty">
      <Inbox size={22} strokeWidth={1.75} className="pa-empty-icon" aria-hidden />
      <div className="pa-empty-title">{title}</div>
      {message ? <p className="pa-empty-copy">{message}</p> : null}
      {action}
    </div>
  );
}

export function PaAlert({ tone = "info", children }) {
  const Icon =
    tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={`pa-alert is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} strokeWidth={2} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Classify unavailable metric keys for clearer presentation. */
export function classifyUnavailableMetric(key) {
  const k = String(key || "");
  if (
    k.includes("employee") ||
    k.includes("storage") ||
    k.includes("Storage") ||
    k === "storageUsage" ||
    k === "storageConsumption"
  ) {
    return { label: "Deferred", tone: "deferred" };
  }
  if (k.includes("api") || k.includes("Api") || k.includes("cron") || k.includes("Response")) {
    return { label: "Not implemented", tone: "unimplemented" };
  }
  return { label: "Unavailable", tone: "unavailable" };
}

export function PaUnavailableMetrics({ metrics = [], title = "Metrics not shown" }) {
  if (!metrics.length) return null;
  return (
    <section className="pa-panel pa-unavailable-panel">
      <div className="pa-panel-head">
        <h2>{title}</h2>
        <p className="pa-panel-desc">
          These measurements are omitted on purpose — never shown as zero or invented values.
        </p>
      </div>
      <div className="pa-unavailable-grid">
        {metrics.map((m) => {
          const meta = classifyUnavailableMetric(m.key);
          return (
            <article key={m.key} className={`pa-unavailable-card is-${meta.tone}`}>
              <div className="pa-unavailable-top">
                <span className={`pa-chip is-${meta.tone}`}>{meta.label}</span>
                <code className="pa-code">{m.key}</code>
              </div>
              <p>{m.reason}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function formatPaDate(value, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

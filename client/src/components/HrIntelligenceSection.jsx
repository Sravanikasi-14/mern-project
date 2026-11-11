import { useMemo, useState, useEffect, useId } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Users,
  ListTodo,
  CalendarDays,
  Wallet,
  Clock3,
  Activity,
  Layers,
} from "lucide-react";
import {
  fetchHrIntelligence,
  getCachedIntelligence,
} from "../services/hrIntelligenceClient";
import "./HrIntelligenceSection.css";

function formatRefreshedAt(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function severityKey(severity) {
  return String(severity || "LOW").toUpperCase();
}

function severityRank(severity) {
  const key = severityKey(severity);
  if (key === "HIGH") return 0;
  if (key === "MEDIUM") return 1;
  return 2;
}

function categoryIcon(category) {
  const key = String(category || "").toUpperCase();
  if (key.includes("WORK") || key.includes("TASK")) return ListTodo;
  if (key.includes("LEAVE")) return CalendarDays;
  if (key.includes("PAY")) return Wallet;
  if (key.includes("ATTEND")) return Clock3;
  if (key.includes("ONBOARD") || key.includes("PROFILE")) return Users;
  return Activity;
}

function categoryLabel(category) {
  const key = String(category || "").toUpperCase();
  if (key.includes("WORK_IMPACT")) return "Work impact";
  if (key.includes("WORK") || key.includes("TASK")) return "Work";
  if (key.includes("LEAVE")) return "Leave";
  if (key.includes("PAY")) return "Payroll";
  if (key.includes("ATTEND")) return "Attendance";
  if (key.includes("ONBOARD") || key.includes("PROFILE") || key.includes("PEOPLE")) {
    return "People";
  }
  return "Operations";
}

function affectedLabel(insight) {
  const count = insight?.count;
  if (count == null || count === "") return null;
  const n = Number(count);
  if (!Number.isFinite(n)) return null;
  const key = String(insight.category || "").toUpperCase();
  if (key.includes("WORK_IMPACT")) return `${n} ${n === 1 ? "signal" : "signals"}`;
  if (key.includes("TASK") || key.includes("WORK_MANAGEMENT")) {
    return `${n} ${n === 1 ? "task signal" : "task signals"}`;
  }
  if (key.includes("LEAVE")) return `${n} ${n === 1 ? "leave request" : "leave requests"}`;
  if (key.includes("PAY")) return `${n} ${n === 1 ? "payroll issue" : "payroll issues"}`;
  if (key.includes("ATTEND")) {
    return `${n} ${n === 1 ? "attendance exception" : "attendance exceptions"}`;
  }
  if (key.includes("ONBOARD") || key.includes("PROFILE") || key.includes("PEOPLE")) {
    return `${n} ${n === 1 ? "employee record" : "employee records"}`;
  }
  return `${n} ${n === 1 ? "signal" : "signals"}`;
}

/** Briefing built only from returned insights — no invented AI narrative. */
function buildBriefing(insights, overview) {
  if (!insights.length) {
    return {
      lead: "No actionable findings in the current refresh.",
      detail:
        "Live attendance, leave, work, payroll, and people checks did not surface issues requiring attention.",
    };
  }

  const highTitles = insights
    .filter((i) => severityKey(i.severity) === "HIGH")
    .map((i) => i.title)
    .filter(Boolean);

  const lead = `${overview.total} actionable ${
    overview.total === 1 ? "finding" : "findings"
  } across the workforce`;

  const mix = [
    overview.high > 0 ? `${overview.high} high` : null,
    overview.medium > 0 ? `${overview.medium} medium` : null,
    overview.low > 0 ? `${overview.low} low` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const detail =
    highTitles.length > 0
      ? `${mix ? `${mix}. ` : ""}Priority focus: ${highTitles.slice(0, 3).join("; ")}${
          highTitles.length > 3 ? ` (+${highTitles.length - 3} more)` : ""
        }.`
      : insights[0]?.summary ||
        insights[0]?.explanation ||
        "Review the intelligence feed for findings and recommended next steps.";

  return { lead, detail };
}

function InsightRow({ insight }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const severity = severityKey(insight.severity).toLowerCase();
  const Icon = categoryIcon(insight.category);
  const affected = affectedLabel(insight);
  const category = categoryLabel(insight.category);

  return (
    <article
      className={`hr-row severity-${severity}${open ? " is-open" : ""}`}
      data-severity={severity}
    >
      <button
        type="button"
        className="hr-row-toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`hr-row-sev severity-${severity}`} aria-label={`${insight.severity} priority`}>
          <span className="hr-row-sev-dot" aria-hidden="true" />
          {insight.severity}
        </span>

        <span className="hr-row-body">
          <span className="hr-row-topline">
            <span className="hr-row-category">
              <Icon size={13} aria-hidden="true" />
              {category}
            </span>
            {affected ? <span className="hr-row-count">{affected}</span> : null}
          </span>
          <span className="hr-row-title">{insight.title}</span>
          {!open && insight.summary ? (
            <span className="hr-row-preview">{insight.summary}</span>
          ) : null}
        </span>

        <ChevronDown size={16} className="hr-row-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div id={panelId} className="hr-row-panel">
          <div className="hr-row-detail-grid">
            {insight.summary ? (
              <div className="hr-row-block">
                <h4 className="hr-row-label">Findings</h4>
                <p className="hr-row-copy">{insight.summary}</p>
              </div>
            ) : null}

            {insight.explanation ? (
              <div className="hr-row-block">
                <h4 className="hr-row-label">Business impact</h4>
                <p className="hr-row-copy">{insight.explanation}</p>
              </div>
            ) : null}
          </div>

          {insight.action ? (
            <div className="hr-row-reco">
              <div className="hr-row-reco-head">
                <Sparkles size={14} aria-hidden="true" />
                <span>AI-recommended action</span>
              </div>
              <p className="hr-row-reco-text">{insight.action}</p>
              {insight.link ? (
                <Link to={insight.link} className="hr-row-link">
                  <span>{insight.linkText || "Open related module"}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : insight.link ? (
            <Link to={insight.link} className="hr-row-link">
              <span>{insight.linkText || "Open related module"}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function HrIntelligenceSection() {
  const [data, setData] = useState(() => getCachedIntelligence());
  const [loading, setLoading] = useState(() => !getCachedIntelligence());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchHrIntelligence({ forceRefresh: false })
      .then((report) => {
        if (isMounted) {
          setData(report);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            err.response?.data?.message ||
              err.message ||
              "Unable to retrieve operational intelligence insights."
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [data]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const freshReport = await fetchHrIntelligence({ forceRefresh: true });
      setData(freshReport);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to refresh operational intelligence insights."
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const report = await fetchHrIntelligence({ forceRefresh: true });
      setData(report);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Unable to retrieve operational intelligence insights."
      );
    } finally {
      setLoading(false);
    }
  };

  const insights = data?.insights || [];
  const aiEnriched = Boolean(data?.aiEnriched);
  const refreshedLabel = formatRefreshedAt(data?.generatedAt);

  const overview = useMemo(() => {
    const high =
      typeof data?.highPriorityCount === "number"
        ? data.highPriorityCount
        : insights.filter((i) => severityKey(i.severity) === "HIGH").length;
    const medium = insights.filter((i) => severityKey(i.severity) === "MEDIUM").length;
    const low = insights.filter((i) => severityKey(i.severity) === "LOW").length;
    const total =
      typeof data?.totalInsightsCount === "number" ? data.totalInsightsCount : insights.length;
    return { high, medium, low, total };
  }, [data, insights]);

  const sortedInsights = useMemo(
    () =>
      [...insights].sort((a, b) => {
        const bySeverity = severityRank(a.severity) - severityRank(b.severity);
        if (bySeverity !== 0) return bySeverity;
        return String(a.title || "").localeCompare(String(b.title || ""));
      }),
    [insights]
  );

  const workImpactInsight = sortedInsights.find(
    (insight) =>
      String(insight.category || "").toUpperCase() === "WORK_IMPACT" ||
      String(insight.id || "").includes("work-impact")
  );
  const feedInsights = sortedInsights.filter((insight) => insight !== workImpactInsight);
  const briefing = useMemo(
    () => buildBriefing(sortedInsights, overview),
    [sortedInsights, overview]
  );

  const statusLabel = loading
    ? "Loading live analysis…"
    : refreshing
      ? "Refreshing live analysis…"
      : aiEnriched
        ? "Gemini-assisted · live tenant data"
        : "Rules-verified · live tenant data";

  return (
    <div className="hr-intel" aria-label="AI Reports intelligence workspace">
      <section className="hr-brief" aria-labelledby="hr-brief-title">
        <div className="hr-brief-main">
          <div className="hr-brief-copy">
            <p className="hr-brief-eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              AI-powered HR Intelligence
            </p>
            <h1 id="hr-brief-title" className="hr-brief-title">
              AI Reports
            </h1>
            {!loading && !error && data ? (
              <>
                <p className="hr-brief-lead">{briefing.lead}</p>
                <p className="hr-brief-detail">{briefing.detail}</p>
              </>
            ) : (
              <p className="hr-brief-detail">
                Prioritized workforce findings from live attendance, leave, work, payroll, and
                people data — with recommended next steps for HR.
              </p>
            )}
          </div>

          <div className="hr-brief-actions">
            <div className="hr-brief-meta">
              <span className={`hr-brief-status${aiEnriched ? " is-ai" : ""}`}>
                <span className="hr-brief-status-dot" aria-hidden="true" />
                {statusLabel}
              </span>
              {refreshedLabel && !loading ? (
                <span className="hr-brief-refreshed">Last refreshed {refreshedLabel}</span>
              ) : null}
            </div>
            <button
              type="button"
              className="hr-brief-refresh"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              title="Refresh Insights"
              aria-label="Refresh Insights"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "hr-intel-spin" : ""}
                aria-hidden="true"
              />
              <span>{refreshing ? "Refreshing…" : "Refresh Insights"}</span>
            </button>
          </div>
        </div>

        {!loading && !error && data ? (
          <div className="hr-priority" aria-label="Priority overview">
            <div className="hr-priority-item">
              <span className="hr-priority-mark is-total" aria-hidden="true">
                <Layers size={12} />
              </span>
              <div className="hr-priority-text">
                <span className="hr-priority-label">Actionable</span>
                <strong className="hr-priority-value">{overview.total}</strong>
              </div>
            </div>
            <div className="hr-priority-item">
              <span className="hr-priority-mark is-high" aria-hidden="true" />
              <div className="hr-priority-text">
                <span className="hr-priority-label">High priority</span>
                <strong className="hr-priority-value is-high">{overview.high}</strong>
              </div>
            </div>
            <div className="hr-priority-item">
              <span className="hr-priority-mark is-medium" aria-hidden="true" />
              <div className="hr-priority-text">
                <span className="hr-priority-label">Medium</span>
                <strong className="hr-priority-value is-medium">{overview.medium}</strong>
              </div>
            </div>
            <div className="hr-priority-item">
              <span className="hr-priority-mark is-low" aria-hidden="true" />
              <div className="hr-priority-text">
                <span className="hr-priority-label">Low</span>
                <strong className="hr-priority-value is-low">{overview.low}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {loading && !refreshing ? (
        <div className="hr-intel-loading" aria-busy="true">
          <div className="hr-intel-skeleton hr-intel-skeleton-row" />
          <div className="hr-intel-skeleton hr-intel-skeleton-row" />
          <div className="hr-intel-skeleton hr-intel-skeleton-side" />
        </div>
      ) : null}

      {!loading && error ? (
        <div className="hr-intel-error" role="alert">
          <div className="hr-intel-error-msg">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button type="button" className="hr-intel-retry" onClick={handleRetry}>
            Try Again
          </button>
        </div>
      ) : null}

      {!loading && !error && data ? (
        <div className="hr-intel-body">
          <section className="hr-feed" aria-labelledby="hr-feed-heading">
            <div className="hr-feed-head">
              <div>
                <h2 id="hr-feed-heading" className="hr-section-title">
                  AI Action Reports
                </h2>
                <p className="hr-feed-desc">
                  Scan findings below. Expand any row for full context and recommended action.
                </p>
              </div>
              <span className="hr-feed-count">{feedInsights.length} in feed</span>
            </div>

            {feedInsights.length === 0 && insights.length === 0 ? (
              <div className="hr-intel-empty">
                <CheckCircle2 size={22} aria-hidden="true" />
                <div>
                  <h3>All clear</h3>
                  <p>No operational findings require attention right now.</p>
                </div>
              </div>
            ) : null}

            {feedInsights.length === 0 && workImpactInsight ? (
              <p className="hr-feed-only-work">
                The only current finding is shown under Work impact &amp; team availability.
              </p>
            ) : null}

            {feedInsights.length > 0 ? (
              <div className="hr-row-list" role="list">
                {feedInsights.map((insight) => (
                  <InsightRow key={insight.id} insight={insight} />
                ))}
              </div>
            ) : null}
          </section>

          <aside
            className={`hr-work${workImpactInsight ? "" : " is-empty"}`}
            aria-labelledby="hr-work-heading"
          >
            <div className="hr-work-head">
              <h2 id="hr-work-heading" className="hr-section-title">
                Work impact &amp; availability
              </h2>
              {workImpactInsight ? (
                <span
                  className={`hr-row-sev severity-${severityKey(workImpactInsight.severity).toLowerCase()}`}
                >
                  <span className="hr-row-sev-dot" aria-hidden="true" />
                  {workImpactInsight.severity}
                </span>
              ) : (
                <span className="hr-work-quiet">No signal</span>
              )}
            </div>

            {workImpactInsight ? (
              <div className="hr-work-body">
                <p className="hr-work-title">{workImpactInsight.title}</p>
                <p className="hr-work-summary">
                  {workImpactInsight.summary || workImpactInsight.explanation}
                </p>
                {workImpactInsight.explanation &&
                workImpactInsight.explanation !== workImpactInsight.summary ? (
                  <p className="hr-work-detail">{workImpactInsight.explanation}</p>
                ) : null}
                {workImpactInsight.action ? (
                  <div className="hr-row-reco">
                    <div className="hr-row-reco-head">
                      <Sparkles size={14} aria-hidden="true" />
                      <span>Recommended next action</span>
                    </div>
                    <p className="hr-row-reco-text">{workImpactInsight.action}</p>
                    {workImpactInsight.link ? (
                      <Link to={workImpactInsight.link} className="hr-row-link">
                        <span>{workImpactInsight.linkText || "Review leave impact"}</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="hr-work-empty">
                No approved-leave work-impact signal in this refresh. Availability and
                leave/workload overlap appear here when reliable data exists.
              </p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

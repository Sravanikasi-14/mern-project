import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  fetchHrIntelligence,
  getCachedIntelligence,
} from "../services/hrIntelligenceClient";
import "./HrIntelligenceSection.css";

export default function HrIntelligenceSection() {
  // Use in-memory session cache on revisits (zero network requests, instant render)
  const [data, setData] = useState(() => getCachedIntelligence());
  const [loading, setLoading] = useState(() => !getCachedIntelligence());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Only fetch on initial load if no cached result exists for this session
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

  return (
    <section className="hr-intelligence-section" aria-label="HR Operational Intelligence">
      {/* Header */}
      <div className="hr-intelligence-header">
        <div className="hr-intelligence-title-group">
          <div className="hr-intelligence-icon-badge" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div className="hr-intelligence-title-wrap">
            <div className="hr-intelligence-title-row">
              <h2 className="hr-intelligence-heading">HR Operational Intelligence</h2>
              <span className={`hr-intelligence-status-pill ${aiEnriched ? "ai-active" : ""}`}>
                <span className="hr-intelligence-dot-live" />
                {aiEnriched ? "Gemini AI Assisted" : "Operational Rules Verified"}
              </span>
            </div>
            <p className="hr-intelligence-subtitle">
              Proactive bottlenecks and compliance action items detected across tenant records
            </p>
          </div>
        </div>

        <button
          type="button"
          className="hr-intelligence-btn-refresh"
          onClick={handleRefresh}
          disabled={loading || refreshing}
          title="Refresh HR intelligence findings"
          aria-label="Refresh HR intelligence findings"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={refreshing ? "hr-intelligence-spin" : ""}
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>{refreshing ? "Refreshing..." : "Refresh Insights"}</span>
        </button>
      </div>

      {/* Loading Skeleton State */}
      {loading && !refreshing && (
        <div className="hr-intelligence-grid">
          {[1, 2].map((idx) => (
            <div key={idx} className="hr-intelligence-skeleton-card">
              <div className="hr-skeleton-line short" />
              <div className="hr-skeleton-line medium" />
              <div className="hr-skeleton-line full" />
              <div className="hr-skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="hr-intelligence-error" role="alert">
          <div className="hr-intelligence-error-msg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="hr-intelligence-btn-retry"
            onClick={handleRetry}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && insights.length === 0 && (
        <div className="hr-intelligence-empty">
          <div className="hr-intelligence-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <h3 className="hr-intelligence-empty-title">All Systems Clear</h3>
            <p className="hr-intelligence-empty-desc">
              No pending operational bottlenecks or data anomalies detected. All employee profiles, tasks, leaves, and payroll records are currently up to date.
            </p>
          </div>
        </div>
      )}

      {/* Actionable Insights Grid */}
      {!loading && !error && insights.length > 0 && (
        <div className="hr-intelligence-grid">
          {insights.map((insight) => {
            const severityClass = (insight.severity || "LOW").toLowerCase();
            return (
              <article
                key={insight.id}
                className={`hr-insight-card severity-${severityClass}`}
              >
                <div>
                  <div className="hr-insight-top">
                    <div className="hr-insight-badge-group">
                      <span className={`hr-severity-badge ${severityClass}`}>
                        {insight.severity} Priority
                      </span>
                      <span className="hr-insight-count-pill">
                        {insight.count} {insight.count === 1 ? "Item" : "Items"}
                      </span>
                    </div>
                  </div>

                  <h3 className="hr-insight-title">{insight.title}</h3>
                </div>

                <p className="hr-insight-explanation">{insight.explanation}</p>

                <div className="hr-insight-action-box">
                  <div className="hr-insight-action-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </div>
                  <div className="hr-insight-action-text">
                    <strong>Recommended Next Step:</strong> {insight.action}
                  </div>
                </div>

                <div className="hr-insight-footer">
                  <Link
                    to={insight.link}
                    className="hr-insight-link"
                    title={`Go to ${insight.linkText || "Take Action"}`}
                  >
                    <span>{insight.linkText || "Take Action"}</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

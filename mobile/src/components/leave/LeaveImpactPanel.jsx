import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDisplayDate } from "../../utils/dateUtils";
import { Skeleton } from "../EmptyState";

function TaskList({ tasks }) {
  if (!tasks?.length) return null;
  return (
    <ul className="li-task-list">
      {tasks.slice(0, 8).map((t) => (
        <li key={t._id || t.title}>
          <strong>{t.title}</strong>
          <span>
            {[t.priority, t.deadline ? `due ${formatDisplayDate(t.deadline)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
      {tasks.length > 8 ? <li className="li-muted">+{tasks.length - 8} more</li> : null}
    </ul>
  );
}

function StatButton({ label, count, open, onToggle, emphasis }) {
  const disabled = Number(count) === 0;
  return (
    <button
      type="button"
      className={`li-stat${open && !disabled ? " is-open" : ""}${emphasis ? " is-emphasis" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={open && !disabled}
    >
      <strong>{count}</strong>
      <span>{label}</span>
      {!disabled ? (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null}
    </button>
  );
}

/**
 * Leave impact / work continuity (responsibilities + planning + next steps).
 * Team availability is rendered separately via TeamAvailabilityPanel.
 */
export default function LeaveImpactPanel({ impact, loading, error, onRetry }) {
  const [openGroups, setOpenGroups] = useState({
    coverage: true,
    attention: false,
    wait: false,
    upcoming: false,
  });

  const toggle = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <div className="li-panel">
        <p className="li-muted">Loading work impact…</p>
        <Skeleton rows={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="li-panel li-panel--error">
        <p>{error}</p>
        {onRetry ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (!impact) {
    return (
      <div className="li-panel">
        <p className="li-chip">Work impact has not loaded yet.</p>
      </div>
    );
  }

  const attention = impact.responsibilities?.requiresAttentionBeforeLeave || [];
  const coverage = impact.responsibilities?.requiresCoverageDuringLeave || [];
  const canWait = impact.responsibilities?.canWaitUntilReturn || [];
  const upcoming = impact.responsibilities?.upcomingDependencies || [];
  const counts = impact.responsibilities?.counts || {};

  const attentionCount = counts.attentionBeforeLeave ?? attention.length;
  const coverageCount = counts.coverageDuringLeave ?? coverage.length;
  const waitCount = counts.canWaitUntilReturn ?? canWait.length;
  const upcomingCount = counts.upcomingDependencies ?? upcoming.length;

  const window = impact.leaveWindow;

  return (
    <div className="li-panel">
      <p className="li-lede">
        Advisory only — does not approve, reject, delay, or block this leave decision.
      </p>

      {impact.planningCategory ? (
        <div className={`li-banner li-banner--${impact.planningCategory.code || "NONE"}`}>
          <strong>{impact.planningCategory.label}</strong>
          <span>{impact.planningCategory.guidance}</span>
        </div>
      ) : null}

      {window?.fromDate ? (
        <p className="li-muted">
          Leave window {formatDisplayDate(window.fromDate)} – {formatDisplayDate(window.toDate)}
          {window.workingDays != null ? ` · ${window.workingDays} working day(s)` : ""}
        </p>
      ) : null}

      <div className="li-stat-grid">
        <StatButton
          label="Attention before leave"
          count={attentionCount}
          open={openGroups.attention}
          onToggle={() => toggle("attention")}
        />
        <StatButton
          label="Coverage during leave"
          count={coverageCount}
          open={openGroups.coverage}
          onToggle={() => toggle("coverage")}
          emphasis
        />
        <StatButton
          label="Can wait until return"
          count={waitCount}
          open={openGroups.wait}
          onToggle={() => toggle("wait")}
        />
        <StatButton
          label="Upcoming after return"
          count={upcomingCount}
          open={openGroups.upcoming}
          onToggle={() => toggle("upcoming")}
        />
      </div>

      {attentionCount > 0 && openGroups.attention ? <TaskList tasks={attention} /> : null}
      {coverageCount > 0 && openGroups.coverage ? <TaskList tasks={coverage} /> : null}
      {waitCount > 0 && openGroups.wait ? <TaskList tasks={canWait} /> : null}
      {upcomingCount > 0 && openGroups.upcoming ? <TaskList tasks={upcoming} /> : null}

      {!attentionCount && !coverageCount && !waitCount && !upcomingCount ? (
        <p className="li-chip">No open tasks were identified for this leave window.</p>
      ) : null}

      {Array.isArray(impact.suggestedNextSteps) && impact.suggestedNextSteps.length > 0 ? (
        <>
          <h4 className="li-subhead">Suggested next actions</h4>
          <ul className="li-steps">
            {impact.suggestedNextSteps.slice(0, 6).map((step) => (
              <li key={typeof step === "string" ? step : step.code || step.message}>
                {typeof step === "string" ? step : step.message || step.label || step.action}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {Array.isArray(impact.missingInformation) && impact.missingInformation.length > 0 ? (
        <div>
          {impact.missingInformation.slice(0, 3).map((m) => (
            <p key={m.code || m.message} className="li-chip">
              {m.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

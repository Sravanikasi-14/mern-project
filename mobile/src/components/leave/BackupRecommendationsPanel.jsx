import { formatDisplayDate } from "../../utils/dateUtils";
import { Skeleton } from "../EmptyState";

/**
 * Backup recommendations for a leave request (planning only).
 */
export default function BackupRecommendationsPanel({
  data,
  loading,
  error,
  onRetry,
  impactLoaded,
  coverageCount,
  onPropose,
  onClear,
  savingTaskId,
}) {
  if (loading) {
    return (
      <div className="li-panel">
        <p className="li-muted">Loading backup recommendations…</p>
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

  const arrangements = data?.arrangements || [];
  const summary = data?.summary || null;
  const missing = data?.missingInformation || [];

  if (!impactLoaded && !summary) {
    return (
      <div className="li-panel">
        <p className="li-muted">Waiting for work impact before recommending backups…</p>
      </div>
    );
  }

  const emptyCode =
    summary?.emptyState?.code ||
    (impactLoaded && coverageCount === 0 ? "NO_COVERAGE_NEEDED" : null);

  if (
    emptyCode === "NO_COVERAGE_NEEDED" ||
    (arrangements.length === 0 && coverageCount === 0 && impactLoaded)
  ) {
    return (
      <div className="li-panel">
        <p className="li-chip">
          {summary?.emptyState?.message ||
            "No backup arrangement is needed for this leave period. Identified responsibilities can wait until the employee returns."}
        </p>
      </div>
    );
  }

  if (arrangements.length === 0 && coverageCount > 0) {
    const incomplete =
      summary?.incompleteEmployeeInfo ||
      missing.some((m) =>
        ["DEPARTMENT_MISSING", "REPORTING_MANAGER_MISSING"].includes(m.code)
      );
    return (
      <div className="li-panel">
        <p className="li-chip">
          {incomplete
            ? "Backup recommendations are limited because some employee skill, role or availability information is missing."
            : summary?.emptyState?.message ||
              "Tasks requiring coverage were identified, but no suitable backup could be recommended."}
        </p>
        {missing.slice(0, 3).map((m) => (
          <p key={m.code || m.message} className="li-chip">
            {m.message}
          </p>
        ))}
      </div>
    );
  }

  if (arrangements.length === 0) {
    return (
      <div className="li-panel">
        <p className="li-chip">No backup recommendations are available for this leave window.</p>
      </div>
    );
  }

  return (
    <div className="li-panel">
      <p className="li-lede">
        System suggestions only. Propose selects a candidate for planning — it does not assign the
        task or start acknowledgement.
      </p>
      {summary?.incompleteEmployeeInfo || missing.length > 0 ? (
        <p className="li-chip">
          Some employee information is incomplete — recommendations may be limited.
        </p>
      ) : null}

      <div className="li-backup-stack">
        {arrangements.map((arr) => (
          <article key={arr.responsibility?.taskId} className="li-backup-card">
            <header className="li-backup-head">
              <div>
                <strong>{arr.responsibility?.title}</strong>
                <span>
                  {[
                    arr.responsibility?.priority,
                    arr.responsibility?.deadline
                      ? `due ${formatDisplayDate(arr.responsibility.deadline)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {arr.proposedBackup?.employee?.fullName ? (
                <em className="li-pill">Proposed: {arr.proposedBackup.employee.fullName}</em>
              ) : null}
            </header>

            {arr.noSuitableCandidate ? (
              <p className="li-chip">
                {arr.message ||
                  "No suitable backup could be recommended for this responsibility."}
              </p>
            ) : (
              <div className="li-backup-list">
                {(arr.recommendations || []).slice(0, 3).map((rec) => {
                  const selected =
                    String(arr.proposedBackup?.employee?._id || "") ===
                    String(rec.employee?._id || "");
                  const taskId = arr.responsibility?.taskId;
                  return (
                    <div
                      key={rec.employee?._id}
                      className={`li-backup-row${selected ? " is-selected" : ""}`}
                    >
                      <div>
                        <strong>{rec.employee?.fullName}</strong>
                        <span className="li-suitability">
                          {rec.suitability?.label || "Incomplete information"}
                          {rec.score != null ? ` · score ${Math.round(Number(rec.score) * 100) / 100}` : ""}
                        </span>
                        <span className="li-muted">
                          {[rec.employee?.jobTitle, rec.employee?.department]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <ul className="li-why">
                          {(rec.why || []).slice(0, 3).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="li-backup-actions">
                        {selected ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={savingTaskId === taskId}
                            onClick={() => onClear?.(taskId)}
                          >
                            {savingTaskId === taskId ? "Saving…" : "Clear proposal"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={savingTaskId === taskId}
                            onClick={() =>
                              onPropose?.(taskId, rec.employee._id, {
                                suitability: rec.suitability,
                                why: rec.why,
                                score: rec.score,
                              })
                            }
                          >
                            {savingTaskId === taskId ? "Saving…" : "Propose backup"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

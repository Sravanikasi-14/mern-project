import { useState } from "react";
import StatusBadge from "./StatusBadge";
import HandoverWorkspace from "./HandoverWorkspace";

/**
 * HR leave review: three clear sections.
 * Leave decision stays independent of backup / handover coordination.
 */
export default function LeaveReviewPanel({
  selectedRequest,
  employeeBalance,
  leaveImpact,
  leaveImpactLoading,
  leaveImpactError,
  backupRecs,
  backupRecsLoading,
  backupRecsError,
  onRetryBackup,
  requestDetailsLoading,
  formatDate,
  getInitials,
  mode = "decision", // decision | details
  onProposeBackup,
  onClearBackup,
  savingBackupTaskId,
  showHandover = false,
  handoverRefreshToken = 0,
}) {
  const [openGroups, setOpenGroups] = useState({
    coverage: true,
    attention: false,
    wait: false,
    upcoming: false,
  });

  const toggle = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const emp = selectedRequest.employee || selectedRequest.employeeId || {};
  const empName = emp.fullName || selectedRequest.employeeName || "Employee";
  const empTitle = emp.jobTitle || emp.job?.jobTitle || "Team Member";
  const empDept = emp.department || emp.job?.department || "General";
  const empCode = emp.employeeCode || "";
  const from = selectedRequest.fromDate || selectedRequest.startDate;
  const to = selectedRequest.toDate || selectedRequest.endDate;
  const days = selectedRequest.daysCount || selectedRequest.calculatedDays || 1;
  const balanceForType = (employeeBalance?.detailed || []).find(
    (b) => b.code === selectedRequest.leaveTypeCode
  );

  const attention = leaveImpact?.responsibilities?.requiresAttentionBeforeLeave || [];
  const coverage = leaveImpact?.responsibilities?.requiresCoverageDuringLeave || [];
  const canWait = leaveImpact?.responsibilities?.canWaitUntilReturn || [];
  const upcoming = leaveImpact?.responsibilities?.upcomingDependencies || [];
  const arrangements = backupRecs?.arrangements || [];
  const backupSummary = backupRecs?.summary || null;
  const team = leaveImpact?.teamAvailability;
  const missing = leaveImpact?.missingInformation || backupRecs?.missingInformation || [];

  const coverageCount =
    leaveImpact?.responsibilities?.counts?.coverageDuringLeave ?? coverage.length;
  const attentionCount =
    leaveImpact?.responsibilities?.counts?.attentionBeforeLeave ?? attention.length;
  const waitCount =
    leaveImpact?.responsibilities?.counts?.canWaitUntilReturn ?? canWait.length;
  const upcomingCount =
    leaveImpact?.responsibilities?.counts?.upcomingDependencies ?? upcoming.length;

  const eligibilityLabel =
    balanceForType?.available != null && Number(balanceForType.available) >= Number(days)
      ? "Within available balance"
      : balanceForType
        ? "Review balance vs request"
        : "Balance unavailable";

  return (
    <div className="lm-review">
      {/* ── Section 1: Leave Request ─────────────────────────────────────── */}
      <section className="lm-review-block" aria-labelledby="lm-sec-leave">
        <h3 id="lm-sec-leave" className="lm-review-block-title">
          Leave request
        </h3>
        <div className="lm-decision-emp">
          <div className="lm-req-avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
            {getInitials(empName)}
          </div>
          <div>
            <h4 className="lm-decision-emp-name">{empName}</h4>
            <div className="lm-decision-emp-meta">
              {empTitle} · {empDept}
              {empCode ? ` · ${empCode}` : ""}
            </div>
          </div>
        </div>
        <div className="lm-decision-grid">
          <div>
            <span>Leave type</span>
            <strong>{selectedRequest.leaveTypeCode}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>
              <StatusBadge status={selectedRequest.status} />
            </strong>
          </div>
          <div>
            <span>Working days</span>
            <strong>{days}</strong>
          </div>
          <div>
            <span>Dates</span>
            <strong>
              {formatDate(from)} – {formatDate(to)}
            </strong>
          </div>
        </div>
        {selectedRequest.reason ? (
          <p className="lm-decision-reason">“{selectedRequest.reason}”</p>
        ) : (
          <p className="lm-impact-muted">No leave reason provided.</p>
        )}

        <div className="lm-elig-grid" style={{ marginTop: 10 }}>
          {requestDetailsLoading && !employeeBalance ? (
            <p className="lm-impact-muted">Loading balances…</p>
          ) : employeeBalance ? (
            <>
              <div>
                <span>Available balance</span>
                <strong>{balanceForType?.available ?? "—"} days</strong>
              </div>
              <div>
                <span>Requested</span>
                <strong>{days} days</strong>
              </div>
              <div>
                <span>Eligibility</span>
                <strong>{eligibilityLabel}</strong>
              </div>
              <div>
                <span>Policy type</span>
                <strong>{selectedRequest.leaveTypeCode}</strong>
              </div>
            </>
          ) : (
            <p className="lm-info-chip">Balance details unavailable for this view.</p>
          )}
        </div>
      </section>

      {/* ── Section 2: Work Impact & Team Availability ───────────────────── */}
      <section className="lm-review-block" aria-labelledby="lm-sec-impact">
        <h3 id="lm-sec-impact" className="lm-review-block-title">
          Work impact &amp; team availability
        </h3>
        <p className="lm-impact-muted">
          Planning overview only — does not approve, reject, or delay this leave.
        </p>

        {leaveImpactLoading && <p className="lm-impact-muted">Loading work impact…</p>}
        {leaveImpactError && (
          <div className="error" style={{ marginBottom: 8 }}>
            {leaveImpactError}
          </div>
        )}

        {!leaveImpactLoading && !leaveImpactError && !leaveImpact && (
          <p className="lm-info-chip">Work impact has not loaded yet.</p>
        )}

        {leaveImpact && (
          <>
            {leaveImpact.planningCategory && (
              <div
                className={`lm-impact-banner lm-impact-banner--${leaveImpact.planningCategory.code || "NONE"}`}
              >
                <strong>{leaveImpact.planningCategory.label}</strong>
                <span>{leaveImpact.planningCategory.guidance}</span>
              </div>
            )}

            <div className="lm-impact-summary-grid">
              <ImpactStat
                label="Attention before leave"
                count={attentionCount}
                active={openGroups.attention}
                onClick={() => toggle("attention")}
              />
              <ImpactStat
                label="Coverage during leave"
                count={coverageCount}
                active={openGroups.coverage}
                onClick={() => toggle("coverage")}
                emphasis
              />
              <ImpactStat
                label="Can wait until return"
                count={waitCount}
                active={openGroups.wait}
                onClick={() => toggle("wait")}
              />
              <ImpactStat
                label="Upcoming after return"
                count={upcomingCount}
                active={openGroups.upcoming}
                onClick={() => toggle("upcoming")}
              />
            </div>

            {attentionCount > 0 && openGroups.attention && (
              <TaskList tasks={attention} formatDate={formatDate} />
            )}
            {coverageCount > 0 && openGroups.coverage && (
              <TaskList tasks={coverage} formatDate={formatDate} />
            )}
            {waitCount > 0 && openGroups.wait && (
              <TaskList tasks={canWait} formatDate={formatDate} />
            )}
            {upcomingCount > 0 && openGroups.upcoming && (
              <TaskList tasks={upcoming} formatDate={formatDate} />
            )}

            {!attentionCount && !coverageCount && !waitCount && !upcomingCount && (
              <p className="lm-info-chip">
                No open tasks were identified for this leave window.
              </p>
            )}

            <div className="lm-team-compact">
              <h4 className="lm-review-subhead">Team availability</h4>
              {team?.department ? (
                <>
                  <div className="lm-team-stats">
                    <div>
                      <span>Department peers</span>
                      <strong>{Math.max(0, (team.totalDepartmentEmployees || 1) - 1)}</strong>
                    </div>
                    <div>
                      <span>Available</span>
                      <strong>{team.employeesAvailableDuringPeriod}</strong>
                    </div>
                    <div>
                      <span>On approved leave</span>
                      <strong>{team.employeesOnApprovedLeave?.length || 0}</strong>
                    </div>
                    <div>
                      <span>Pending overlap</span>
                      <strong>{team.pendingOverlappingLeaveRequests?.length || 0}</strong>
                    </div>
                  </div>
                  <p className="lm-impact-muted">
                    Pending leave requests are not confirmed absences.
                  </p>
                </>
              ) : (
                <p className="lm-info-chip">
                  Department not set — team availability is limited.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Section 3: Backup & Handover Coordination ────────────────────── */}
      <section className="lm-review-block lm-review-block--last" aria-labelledby="lm-sec-coord">
        <h3 id="lm-sec-coord" className="lm-review-block-title">
          Backup &amp; handover coordination
        </h3>
        <p className="lm-impact-muted">
          Recommendations are planning suggestions only — not task assignments. Handover is
          optional and never required for leave approval.
        </p>

        <h4 className="lm-review-subhead">Backup recommendations</h4>
        <p className="lm-impact-muted">
          System suggestions only. Propose selects a candidate for planning — it does not assign the
          task or start acknowledgement.
        </p>
        <BackupRecommendationsBlock
          loading={backupRecsLoading}
          error={backupRecsError}
          onRetry={onRetryBackup}
          arrangements={arrangements}
          summary={backupSummary}
          missing={missing}
          coverageCount={coverageCount}
          impactLoaded={Boolean(leaveImpact) && !leaveImpactLoading}
          mode={mode}
          formatDate={formatDate}
          onProposeBackup={onProposeBackup}
          onClearBackup={onClearBackup}
          savingBackupTaskId={savingBackupTaskId}
        />

        {showHandover && (
          <HandoverWorkspace
            mode="leaveDetail"
            leaveRequestId={selectedRequest._id}
            canManage
            coverageTaskCount={
              backupSummary?.coverageTaskCount ??
              (leaveImpact ? coverageCount : null)
            }
            impactReady={Boolean(leaveImpact) && !leaveImpactLoading}
            arrangements={arrangements}
            refreshToken={handoverRefreshToken}
          />
        )}
      </section>
    </div>
  );
}

function ImpactStat({ label, count, active, onClick, emphasis }) {
  const disabled = Number(count) === 0;
  return (
    <button
      type="button"
      className={`lm-impact-stat${active && !disabled ? " is-open" : ""}${emphasis ? " is-emphasis" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active && !disabled}
    >
      <strong>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

function TaskList({ tasks, formatDate }) {
  if (!tasks?.length) return null;
  return (
    <div className="lm-task-list">
      {tasks.slice(0, 8).map((t) => (
        <div key={t._id} className="lm-impact-task">
          <span className="lm-impact-task-title">{t.title}</span>
          <span className="lm-impact-task-meta">
            {t.priority}
            {t.deadline ? ` · due ${formatDate(t.deadline)}` : ""}
          </span>
        </div>
      ))}
      {tasks.length > 8 ? (
        <p className="lm-impact-muted">+{tasks.length - 8} more</p>
      ) : null}
    </div>
  );
}

function BackupRecommendationsBlock({
  loading,
  error,
  onRetry,
  arrangements,
  summary,
  missing,
  coverageCount,
  impactLoaded,
  mode,
  formatDate,
  onProposeBackup,
  onClearBackup,
  savingBackupTaskId,
}) {
  if (loading) {
    return <p className="lm-impact-muted">Loading backup recommendations…</p>;
  }

  if (error) {
    return (
      <div className="lm-empty-state lm-empty-state--error">
        <p>{error}</p>
        {onRetry ? (
          <button type="button" className="btn-secondary btn-sm lm-action-btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (!impactLoaded && !summary) {
    return <p className="lm-impact-muted">Waiting for work impact before recommending backups…</p>;
  }

  const emptyCode =
    summary?.emptyState?.code ||
    (impactLoaded && coverageCount === 0 ? "NO_COVERAGE_NEEDED" : null);

  if (emptyCode === "NO_COVERAGE_NEEDED" || (arrangements.length === 0 && coverageCount === 0 && impactLoaded)) {
    return (
      <div className="lm-empty-state">
        <p>
          {summary?.emptyState?.message ||
            "No backup arrangement is needed for this leave period. The identified responsibilities can wait until the employee returns."}
        </p>
      </div>
    );
  }

  if (arrangements.length === 0 && coverageCount > 0) {
    // Impact says coverage needed but API returned no arrangements — treat as limited/incomplete
    const incomplete =
      summary?.incompleteEmployeeInfo ||
      (missing || []).some((m) =>
        ["DEPARTMENT_MISSING", "REPORTING_MANAGER_MISSING"].includes(m.code)
      );
    return (
      <div className="lm-empty-state">
        <p>
          {incomplete
            ? "Backup recommendations are limited because some employee skill, role or availability information is missing."
            : summary?.emptyState?.message ||
              "Tasks requiring coverage were identified, but no suitable backup could be recommended."}
        </p>
        {(missing || []).slice(0, 3).map((m) => (
          <p key={m.code || m.message} className="lm-info-chip">
            {m.message}
          </p>
        ))}
      </div>
    );
  }

  if (arrangements.length === 0) {
    return (
      <div className="lm-empty-state">
        <p>No backup recommendations are available for this leave window.</p>
      </div>
    );
  }

  return (
    <div className="lm-backup-stack">
      {summary?.incompleteEmployeeInfo || (missing || []).length > 0 ? (
        <p className="lm-info-chip">
          Some employee skill, role or availability information is incomplete — recommendations may
          be limited.
        </p>
      ) : null}
      {arrangements.map((arr) => (
        <div key={arr.responsibility.taskId} className="lm-backup-block">
          <div className="lm-backup-task-head">
            <div>
              <div className="lm-impact-task-title">{arr.responsibility.title}</div>
              <div className="lm-impact-task-meta">
                {arr.responsibility.priority}
                {arr.responsibility.deadline
                  ? ` · due ${formatDate(arr.responsibility.deadline)}`
                  : ""}
              </div>
            </div>
            {arr.proposedBackup?.employee?.fullName ? (
              <span className="lm-backup-proposed-pill">
                Proposed backup: {arr.proposedBackup.employee.fullName}
              </span>
            ) : null}
          </div>
          {arr.proposedBackup?.employee?.fullName ? (
            <p className="lm-impact-muted">
              Proposal status: planning only — task ownership unchanged; acknowledgement not
              started by this action.
            </p>
          ) : null}
          {arr.noSuitableCandidate ? (
            <p className="lm-info-chip">
              {arr.message ||
                "Tasks requiring coverage were identified, but no suitable backup could be recommended for this responsibility."}
            </p>
          ) : (
            <div className="lm-backup-list">
              {(arr.recommendations || []).slice(0, mode === "decision" ? 2 : 3).map((rec) => {
                const selected =
                  arr.proposedBackup?.employee?._id === rec.employee._id ||
                  String(arr.proposedBackup?.employee?._id) === String(rec.employee._id);
                return (
                  <div
                    key={rec.employee._id}
                    className={`lm-backup-row${selected ? " is-selected" : ""}`}
                  >
                    <div className="lm-backup-row-main">
                      <strong>{rec.employee.fullName}</strong>
                      <span className="lm-backup-suitability">
                        {rec.suitability?.label || "Incomplete information"}
                      </span>
                      <div className="lm-impact-task-meta">
                        {[rec.employee.jobTitle, rec.employee.department]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <ul className="lm-backup-why">
                        {(rec.why || []).slice(0, 3).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                    {mode === "details" && onProposeBackup && (
                      <div className="lm-backup-row-actions">
                        {selected ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm lm-action-btn"
                            disabled={savingBackupTaskId === arr.responsibility.taskId}
                            onClick={() => onClearBackup?.(arr.responsibility.taskId)}
                          >
                            Clear proposal
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary btn-sm lm-action-btn"
                            disabled={savingBackupTaskId === arr.responsibility.taskId}
                            onClick={() =>
                              onProposeBackup(arr.responsibility.taskId, rec.employee._id, {
                                suitability: rec.suitability,
                                why: rec.why,
                                score: rec.score,
                              })
                            }
                          >
                            {savingBackupTaskId === arr.responsibility.taskId
                              ? "Saving"
                              : "Propose backup"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

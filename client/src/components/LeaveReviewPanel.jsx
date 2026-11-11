import { useState } from "react";
import StatusBadge from "./StatusBadge";
import HandoverWorkspace from "./HandoverWorkspace";
import AuthedAvatar from "./AuthedAvatar";

function formatDays(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatDayLabel(value) {
  const n = formatDays(value);
  if (n == null) return "—";
  return `${n} day${n === 1 ? "" : "s"}`;
}

/**
 * HR leave review panel — identity, leave facts, balance, decision history,
 * then optional work-impact / backup coordination.
 */
export default function LeaveReviewPanel({
  selectedRequest,
  employeeBalance,
  availableLeaveTypes = [],
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
  const empEmail = emp.email || selectedRequest.employeeEmail || "";
  const empStatus = emp.status || null;
  const manager =
    emp.reportingManager ||
    (emp.job?.reportingManagerId && typeof emp.job.reportingManagerId === "object"
      ? emp.job.reportingManagerId
      : null);
  const from = selectedRequest.fromDate || selectedRequest.startDate;
  const to = selectedRequest.toDate || selectedRequest.endDate;
  const days = formatDays(selectedRequest.daysCount ?? selectedRequest.calculatedDays) ?? 1;
  const leaveTypeMeta = (availableLeaveTypes || []).find(
    (t) => t.code === selectedRequest.leaveTypeCode
  );
  const leaveTypeLabel = leaveTypeMeta?.name
    ? `${leaveTypeMeta.name}`
    : selectedRequest.leaveTypeCode || "—";
  const decision = selectedRequest.decision || null;
  const statusKey = String(selectedRequest.status || "").toUpperCase();
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

  const availableRaw = balanceForType ? formatDays(balanceForType.available) : null;
  const yearlyRaw = balanceForType ? formatDays(balanceForType.yearlyDays) : null;
  const usedRaw = balanceForType ? formatDays(balanceForType.used) : null;
  const pendingRaw = balanceForType ? formatDays(balanceForType.pending) : null;

  /** Balance before this request’s decision effect, when calculable. */
  let balanceBefore = null;
  let projectedAfter = null;
  if (availableRaw != null) {
    if (statusKey === "APPROVED") {
      balanceBefore = availableRaw + days;
      projectedAfter = availableRaw;
    } else if (statusKey === "PENDING") {
      balanceBefore = availableRaw;
      projectedAfter = availableRaw - days;
    } else {
      balanceBefore = availableRaw;
      projectedAfter = null;
    }
  }

  const eligibilityLabel =
    availableRaw == null
      ? "Balance unavailable"
      : availableRaw >= days
        ? "Within available balance"
        : "Exceeds available balance";

  const sameDay = from && to && String(from).slice(0, 10) === String(to).slice(0, 10);
  const dateRangeLabel = sameDay
    ? formatDate(from)
    : `${formatDate(from)} – ${formatDate(to)}`;

  const approverLabel = decision?.decidedBy
    ? [decision.decidedBy, decision.decidedByRole].filter(Boolean).join(" · ")
    : null;

  return (
    <div className={`lm-review lm-review--${statusKey.toLowerCase() || "unknown"}`}>
      {/* ── Identity + leave summary (primary) ─────────────────────────── */}
      <section className="lm-detail-hero" aria-labelledby="lm-detail-employee">
        <div className="lm-detail-hero-top">
          <div className="lm-detail-identity">
            <AuthedAvatar
              className="lm-detail-avatar"
              style={{ width: 52, height: 52, fontSize: 18 }}
              employee={emp}
              avatar={emp.avatar || selectedRequest.avatar}
              name={empName}
              initials={getInitials(empName)}
              alt={empName}
            />
            <div className="lm-detail-identity-copy">
              <div className="lm-detail-identity-head">
                <h3 id="lm-detail-employee" className="lm-detail-name">
                  {empName}
                </h3>
                <span className={`lm-status-chip is-${statusKey.toLowerCase() || "unknown"}`}>
                  <StatusBadge status={selectedRequest.status} />
                </span>
              </div>
              <p className="lm-detail-meta">
                {[empCode && `#${empCode}`, empTitle, empDept].filter(Boolean).join(" · ")}
              </p>
              <p className="lm-detail-meta-secondary">
                {[
                  empEmail || null,
                  empStatus ? `Status: ${empStatus}` : null,
                  manager?.fullName
                    ? `Manager: ${manager.fullName}${
                        manager.employeeCode ? ` (#${manager.employeeCode})` : ""
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>

        <div className="lm-detail-summary" aria-label="Leave request summary">
          <div className="lm-detail-fact">
            <span className="lm-detail-fact-label">Leave type</span>
            <strong className="lm-detail-fact-value">
              {leaveTypeLabel}
              {selectedRequest.leaveTypeCode ? (
                <span className="lm-detail-type-code">{selectedRequest.leaveTypeCode}</span>
              ) : null}
            </strong>
          </div>
          <div className="lm-detail-fact">
            <span className="lm-detail-fact-label">Duration</span>
            <strong className="lm-detail-fact-value">{formatDayLabel(days)}</strong>
          </div>
          <div className="lm-detail-fact lm-detail-fact--wide">
            <span className="lm-detail-fact-label">{sameDay ? "Leave date" : "Start – end"}</span>
            <strong className="lm-detail-fact-value">{dateRangeLabel}</strong>
          </div>
          <div className="lm-detail-fact">
            <span className="lm-detail-fact-label">Submitted</span>
            <strong className="lm-detail-fact-value">
              {selectedRequest.createdAt ? formatDate(selectedRequest.createdAt) : "—"}
            </strong>
          </div>
          <div className="lm-detail-fact lm-detail-fact--full">
            <span className="lm-detail-fact-label">Reason for leave</span>
            <p className="lm-detail-reason">
              {selectedRequest.reason?.trim()
                ? selectedRequest.reason.trim()
                : "No leave reason provided."}
            </p>
          </div>
        </div>
      </section>

      {/* ── Balance ────────────────────────────────────────────────────── */}
      <section className="lm-detail-section" aria-labelledby="lm-sec-balance">
        <div className="lm-detail-section-head">
          <h4 id="lm-sec-balance" className="lm-detail-section-title">
            Leave balance
          </h4>
          {!requestDetailsLoading && employeeBalance && balanceForType ? (
            <span
              className={`lm-elig-pill${
                availableRaw == null
                  ? ""
                  : availableRaw >= days
                    ? " is-ok"
                    : " is-warn"
              }`}
            >
              {eligibilityLabel}
            </span>
          ) : null}
        </div>

        {requestDetailsLoading && !employeeBalance ? (
          <p className="lm-impact-muted">Loading balances…</p>
        ) : !employeeBalance ? (
          <p className="lm-detail-empty">
            Balance details are unavailable for this employee. Missing balance is not shown as zero.
          </p>
        ) : !balanceForType ? (
          <p className="lm-detail-empty">
            No balance record for leave type{" "}
            <strong>{selectedRequest.leaveTypeCode || "—"}</strong>. This is not treated as a zero
            balance.
          </p>
        ) : (
          <div className="lm-balance-grid">
            <div className="lm-balance-cell">
              <span>Entitlement</span>
              <strong>{yearlyRaw == null ? "Unavailable" : formatDayLabel(yearlyRaw)}</strong>
            </div>
            <div className="lm-balance-cell">
              <span>Used (approved)</span>
              <strong>{usedRaw == null ? "Unavailable" : formatDayLabel(usedRaw)}</strong>
            </div>
            <div className="lm-balance-cell">
              <span>Pending requests</span>
              <strong>{pendingRaw == null ? "Unavailable" : formatDayLabel(pendingRaw)}</strong>
            </div>
            <div className="lm-balance-cell">
              <span>Available before this request</span>
              <strong>
                {balanceBefore == null ? "Unavailable" : formatDayLabel(balanceBefore)}
              </strong>
            </div>
            <div className="lm-balance-cell">
              <span>Requested</span>
              <strong>{formatDayLabel(days)}</strong>
            </div>
            <div className="lm-balance-cell">
              <span>
                {statusKey === "APPROVED"
                  ? "Balance after approval"
                  : statusKey === "PENDING"
                    ? "Projected after approval"
                    : "Projected after approval"}
              </span>
              <strong>
                {projectedAfter == null
                  ? statusKey === "PENDING" || statusKey === "APPROVED"
                    ? "Unavailable"
                    : "Not applicable"
                  : formatDayLabel(projectedAfter)}
              </strong>
            </div>
          </div>
        )}
      </section>

      {/* ── Approval workflow (single-stage, honest) ───────────────────── */}
      <section className="lm-detail-section" aria-labelledby="lm-sec-approval">
        <h4 id="lm-sec-approval" className="lm-detail-section-title">
          Approval workflow
        </h4>
        <ol className="lm-timeline">
          <li className="lm-timeline-item is-done">
            <span className="lm-timeline-dot" aria-hidden="true" />
            <div className="lm-timeline-body">
              <div className="lm-timeline-row">
                <strong>Submitted</strong>
                <span className="lm-timeline-time">
                  {selectedRequest.createdAt ? formatDate(selectedRequest.createdAt) : "—"}
                </span>
              </div>
              <p className="lm-timeline-copy">Leave request recorded for HR review.</p>
            </div>
          </li>
          <li
            className={`lm-timeline-item${
              statusKey === "PENDING" ? " is-current" : statusKey ? " is-done" : ""
            }${statusKey === "REJECTED" ? " is-rejected" : ""}${
              statusKey === "APPROVED" ? " is-approved" : ""
            }`}
          >
            <span className="lm-timeline-dot" aria-hidden="true" />
            <div className="lm-timeline-body">
              <div className="lm-timeline-row">
                <strong>
                  {statusKey === "PENDING"
                    ? "Awaiting decision"
                    : statusKey === "APPROVED"
                      ? "Approved"
                      : statusKey === "REJECTED"
                        ? "Rejected"
                        : "Decision"}
                </strong>
                <span className="lm-timeline-time">
                  {decision?.decidedAt ? formatDate(decision.decidedAt) : statusKey === "PENDING" ? "Pending" : "—"}
                </span>
              </div>
              {approverLabel ? (
                <p className="lm-timeline-copy">Decided by {approverLabel}</p>
              ) : statusKey === "PENDING" ? (
                <p className="lm-timeline-copy">No approver has recorded a decision yet.</p>
              ) : null}
              {decision?.remarks?.trim() ? (
                <p className="lm-timeline-remarks">
                  <span>{statusKey === "REJECTED" ? "Rejection reason" : "Comments"}</span>
                  {decision.remarks.trim()}
                </p>
              ) : statusKey !== "PENDING" ? (
                <p className="lm-timeline-copy">No comments recorded.</p>
              ) : null}
            </div>
          </li>
        </ol>
        <p className="lm-detail-footnote">
          This workspace uses a single HR decision stage. Multi-stage approval history is not stored
          on leave requests.
        </p>
      </section>

      {/* ── Attachments (honest empty — no leave-file API) ─────────────── */}
      <section className="lm-detail-section lm-detail-section--compact" aria-labelledby="lm-sec-docs">
        <h4 id="lm-sec-docs" className="lm-detail-section-title">
          Supporting documents
        </h4>
        <p className="lm-detail-empty">
          Leave requests do not store attachments. Handover item files appear under Backup &amp;
          handover when used.
        </p>
      </section>

      {/* ── Work Impact & Team Availability ────────────────────────────── */}
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

      {/* ── Backup & Handover Coordination ─────────────────────────────── */}
      <section className="lm-review-block lm-review-block--last" aria-labelledby="lm-sec-coord">
        <h3 id="lm-sec-coord" className="lm-review-block-title">
          Backup &amp; handover coordination
        </h3>
        <p className="lm-impact-muted">
          Recommendations are planning suggestions only — not task assignments. Handover is
          optional and never required for leave approval.
        </p>

        <h4 className="lm-review-subhead">Backup recommendations</h4>
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

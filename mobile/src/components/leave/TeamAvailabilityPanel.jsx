import { formatDisplayDate } from "../../utils/dateUtils";

function OverlapList({ title, rows }) {
  if (!rows?.length) {
    return (
      <div className="li-overlap-block">
        <h5>{title}</h5>
        <p className="li-muted">None in this leave window.</p>
      </div>
    );
  }
  return (
    <div className="li-overlap-block">
      <h5>
        {title} <em>({rows.length})</em>
      </h5>
      <ul className="li-overlap-list">
        {rows.slice(0, 8).map((row) => (
          <li key={String(row.leaveRequestId || `${row.employeeName}-${row.fromDate}`)}>
            <strong>{row.employeeName || "Colleague"}</strong>
            <span>
              {[
                row.employeeCode,
                row.leaveTypeCode,
                row.fromDate || row.toDate
                  ? `${formatDisplayDate(row.fromDate)} – ${formatDisplayDate(row.toDate)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
        {rows.length > 8 ? <li className="li-muted">+{rows.length - 8} more</li> : null}
      </ul>
    </div>
  );
}

/**
 * Team availability + overlapping leaves from impact.teamAvailability.
 * Advisory only — pending leave is not confirmed absence.
 */
export default function TeamAvailabilityPanel({ team, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="li-panel">
        <p className="li-muted">Loading team availability…</p>
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

  if (!team) {
    return (
      <div className="li-panel">
        <p className="li-chip">Team availability has not loaded yet.</p>
      </div>
    );
  }

  if (!team.department) {
    return (
      <div className="li-panel">
        <p className="li-chip">Department not set — team availability is limited.</p>
      </div>
    );
  }

  const approved = team.employeesOnApprovedLeave || [];
  const pending = team.pendingOverlappingLeaveRequests || [];

  return (
    <div className="li-panel">
      <p className="li-lede">
        {team.note ||
          "Pending leave is not treated as confirmed absence. Colleague leave reasons are not shown."}
      </p>

      <div className="li-team-grid">
        <div>
          <span>Department peers</span>
          <strong>{Math.max(0, (team.totalDepartmentEmployees || 1) - 1)}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{team.employeesAvailableDuringPeriod ?? "—"}</strong>
        </div>
        <div>
          <span>On approved leave</span>
          <strong>{approved.length}</strong>
        </div>
        <div>
          <span>Pending overlap</span>
          <strong>{pending.length}</strong>
        </div>
      </div>

      {Array.isArray(team.holidaysInPeriod) && team.holidaysInPeriod.length > 0 ? (
        <p className="li-muted">
          Holidays in window:{" "}
          {team.holidaysInPeriod
            .slice(0, 4)
            .map((h) => `${h.name || "Holiday"} (${formatDisplayDate(h.date)})`)
            .join("; ")}
          {team.holidaysInPeriod.length > 4 ? "…" : ""}
        </p>
      ) : null}

      <OverlapList title="Employees on approved leave" rows={approved} />
      <OverlapList title="Pending overlapping requests" rows={pending} />
    </div>
  );
}

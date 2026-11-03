import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import LeaveImpactPanel from "./LeaveImpactPanel";
import TeamAvailabilityPanel from "./TeamAvailabilityPanel";
import BackupRecommendationsPanel from "./BackupRecommendationsPanel";
import HandoverPanel from "./HandoverPanel";
import StatusBadge from "../StatusBadge";
import {
  useClearBackupMutation,
  useLeaveBackupQuery,
  useLeaveHandoverQuery,
  useLeaveImpactQuery,
  useLeaveRequestDetailQuery,
  useProposeBackupMutation,
} from "../../hooks/useHrLeaveQueries";
import { formatDisplayDate } from "../../utils/dateUtils";
import { useToast } from "../Toast";

function Accordion({ id, title, open, onToggle, children, badge }) {
  return (
    <section className={`li-acc${open ? " is-open" : ""}`}>
      <button type="button" className="li-acc-toggle" onClick={() => onToggle(id)} aria-expanded={open}>
        <span>
          {title}
          {badge != null && badge !== "" ? <em className="li-acc-badge">{badge}</em> : null}
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open ? <div className="li-acc-body">{children}</div> : null}
    </section>
  );
}

/**
 * On-demand request intelligence for HR leave detail.
 * Impact loads when the request opens; backup/handover load when their sections open.
 */
export default function LeaveRequestIntelligence({
  leaveRequestId,
  enabled = true,
  listItem = null,
}) {
  const toast = useToast();
  const [open, setOpen] = useState({
    details: true,
    impact: true,
    team: false,
    backup: false,
    handover: false,
  });
  const [savingTaskId, setSavingTaskId] = useState("");
  /** Once opened, keep fetching enabled so accordion collapse does not remount-fetch thrash. */
  const [backupArmed, setBackupArmed] = useState(false);
  const [handoverArmed, setHandoverArmed] = useState(false);

  const detailQuery = useLeaveRequestDetailQuery(leaveRequestId, { enabled });
  const impactQuery = useLeaveImpactQuery(leaveRequestId, { enabled });
  const backupQuery = useLeaveBackupQuery(leaveRequestId, {
    enabled: enabled && backupArmed,
  });
  const handoverQuery = useLeaveHandoverQuery(leaveRequestId, {
    enabled: enabled && handoverArmed,
  });
  const propose = useProposeBackupMutation(leaveRequestId);
  const clear = useClearBackupMutation(leaveRequestId);

  const impact = impactQuery.data;
  const leaveRequest = detailQuery.data?.leaveRequest || listItem;
  const leaveBalance = detailQuery.data?.leaveBalance;
  const coverageCount =
    impact?.responsibilities?.counts?.coverageDuringLeave ??
    impact?.responsibilities?.requiresCoverageDuringLeave?.length ??
    0;

  const toggle = (key) => {
    setOpen((prev) => {
      const next = !prev[key];
      if (key === "backup" && next) setBackupArmed(true);
      if (key === "handover" && next) setHandoverArmed(true);
      // Opening team availability relies on impact (already fetched).
      if (key === "team" && next && !impact && !impactQuery.isFetching) {
        impactQuery.refetch();
      }
      return { ...prev, [key]: next };
    });
  };

  const handlePropose = async (taskId, backupEmployeeId, explanationSnapshot) => {
    try {
      setSavingTaskId(taskId);
      await propose.mutateAsync({ taskId, backupEmployeeId, explanationSnapshot });
      toast.push("Backup proposal saved (planning only).");
      if (!handoverArmed) setHandoverArmed(true);
    } catch (err) {
      toast.push(err.response?.data?.message || "Could not save backup proposal.");
    } finally {
      setSavingTaskId("");
    }
  };

  const handleClear = async (taskId) => {
    try {
      setSavingTaskId(taskId);
      await clear.mutateAsync({ taskId });
      toast.push("Backup proposal cleared.");
    } catch (err) {
      toast.push(err.response?.data?.message || "Could not clear backup proposal.");
    } finally {
      setSavingTaskId("");
    }
  };

  if (!leaveRequestId || !enabled) return null;

  const emp = leaveRequest?.employee || leaveRequest?.employeeId || {};
  const empName =
    emp.fullName || leaveRequest?.employeeName || listItem?.employeeName || "Employee";
  const empTitle =
    emp.jobTitle || emp.job?.jobTitle || leaveRequest?.jobTitle || listItem?.jobTitle || "";
  const empDept = emp.department || emp.job?.department || "";
  const from = leaveRequest?.fromDate || leaveRequest?.startDate;
  const to = leaveRequest?.toDate || leaveRequest?.endDate;
  const days =
    leaveRequest?.daysCount ||
    leaveRequest?.calculatedDays ||
    leaveRequest?.totalDays ||
    leaveRequest?.days;
  const typeCode = leaveRequest?.leaveTypeCode || leaveRequest?.leaveType;
  const balanceForType = (leaveBalance?.detailed || []).find((b) => b.code === typeCode);

  return (
    <div className="li-request-intel">
      <header className="li-request-intel-head">
        <h3>Leave intelligence</h3>
        <p>
          Contextual analysis for this request only. Recommendations never approve, reject, or
          assign work automatically.
        </p>
      </header>

      <Accordion id="details" title="Leave request details" open={open.details} onToggle={toggle}>
        <div className="li-panel">
          {detailQuery.isLoading && !leaveRequest ? (
            <p className="li-muted">Loading request details…</p>
          ) : (
            <>
              <div className="li-detail-grid">
                <div>
                  <span>Employee</span>
                  <strong>{empName}</strong>
                </div>
                <div>
                  <span>Role</span>
                  <strong>{[empTitle, empDept].filter(Boolean).join(" · ") || "—"}</strong>
                </div>
                <div>
                  <span>Type</span>
                  <strong>{typeCode || "—"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>
                    <StatusBadge status={leaveRequest?.status} />
                  </strong>
                </div>
                <div>
                  <span>Dates</span>
                  <strong>
                    {formatDisplayDate(from)} – {formatDisplayDate(to)}
                  </strong>
                </div>
                <div>
                  <span>Working days</span>
                  <strong>{days != null ? days : "—"}</strong>
                </div>
              </div>
              {leaveRequest?.reason ? (
                <p className="li-reason">“{leaveRequest.reason}”</p>
              ) : (
                <p className="li-muted">No leave reason provided.</p>
              )}
              {leaveBalance ? (
                <div className="li-detail-grid">
                  <div>
                    <span>Available balance</span>
                    <strong>
                      {balanceForType?.available != null ? `${balanceForType.available} days` : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Eligibility</span>
                    <strong>
                      {balanceForType?.available != null && days != null
                        ? Number(balanceForType.available) >= Number(days)
                          ? "Within available balance"
                          : "Review balance vs request"
                        : "Balance unavailable"}
                    </strong>
                  </div>
                </div>
              ) : detailQuery.isError ? (
                <p className="li-chip">
                  {detailQuery.error?.response?.data?.message ||
                    "Could not load full leave balance for this request."}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Accordion>

      <Accordion id="impact" title="Leave impact analysis" open={open.impact} onToggle={toggle}>
        <LeaveImpactPanel
          impact={impact}
          loading={impactQuery.isLoading}
          error={
            impactQuery.error?.response?.data?.message || impactQuery.error?.message || ""
          }
          onRetry={() => impactQuery.refetch()}
        />
      </Accordion>

      <Accordion
        id="team"
        title="Team availability"
        open={open.team}
        onToggle={toggle}
        badge={
          impact?.teamAvailability
            ? String(
                (impact.teamAvailability.employeesOnApprovedLeave?.length || 0) +
                  (impact.teamAvailability.pendingOverlappingLeaveRequests?.length || 0)
              )
            : ""
        }
      >
        <TeamAvailabilityPanel
          team={impact?.teamAvailability}
          loading={impactQuery.isLoading}
          error={
            impactQuery.error?.response?.data?.message || impactQuery.error?.message || ""
          }
          onRetry={() => impactQuery.refetch()}
        />
      </Accordion>

      <Accordion id="backup" title="Backup recommendations" open={open.backup} onToggle={toggle}>
        {!backupArmed ? (
          <p className="li-muted">Open this section to load backup recommendations.</p>
        ) : (
          <BackupRecommendationsPanel
            data={backupQuery.data}
            loading={backupQuery.isLoading}
            error={
              backupQuery.error?.response?.data?.message ||
              backupQuery.error?.message ||
              ""
            }
            onRetry={() => backupQuery.refetch()}
            impactLoaded={Boolean(impact) || impactQuery.isFetched}
            coverageCount={coverageCount}
            onPropose={handlePropose}
            onClear={handleClear}
            savingTaskId={savingTaskId}
          />
        )}
      </Accordion>

      <Accordion id="handover" title="Handover management" open={open.handover} onToggle={toggle}>
        {!handoverArmed ? (
          <p className="li-muted">Open this section to load handover status.</p>
        ) : (
          <HandoverPanel
            leaveRequestId={leaveRequestId}
            handover={handoverQuery.data}
            loading={handoverQuery.isLoading}
            error={
              handoverQuery.error?.response?.data?.message ||
              handoverQuery.error?.message ||
              ""
            }
            onRetry={() => handoverQuery.refetch()}
            coverageTaskCount={
              backupQuery.data?.summary?.coverageTaskCount ??
              (impact ? coverageCount : null)
            }
            impactReady={Boolean(impact) && !impactQuery.isLoading}
            arrangements={backupQuery.data?.arrangements || []}
          />
        )}
      </Accordion>
    </div>
  );
}

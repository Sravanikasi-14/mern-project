import { useMemo, useState } from "react";
import {
  HANDOVER_DETAIL_MODES,
  resolveHandoverDetailPresentation,
} from "../../utils/handoverDetailPresentation";
import { useHandoverActions } from "../../hooks/useHrLeaveQueries";
import { Skeleton } from "../EmptyState";
import { useToast } from "../Toast";

const HANDOVER_STATUS_LABELS = {
  DRAFT: "Draft handover",
  SUBMITTED: "Waiting for manager coordination",
  AWAITING_BACKUP_ACKNOWLEDGEMENT: "Waiting for manager coordination",
  READY_FOR_MANAGER_REVIEW: "Waiting for manager coordination",
  NEEDS_REVISION: "Needs updates",
  APPROVED: "Coverage arranged",
  ACTIVE: "Currently covering",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const ITEM_STATUS_LABELS = {
  DRAFT: "Draft",
  AWAITING_ACK: "Waiting for coordination",
  ACKNOWLEDGED: "Ready for coordination",
  NEEDS_INFO: "Needs updates",
  DECLINED: "Needs a new coverage employee",
  APPROVED: "Coverage arranged",
  ACTIVE: "Currently covering",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function statusLabel(status, map) {
  if (!status) return "Unknown";
  return map[status] || String(status).replaceAll("_", " ").toLowerCase();
}

/**
 * Mobile handover management for a single leave request (HR leaveDetail mode).
 */
export default function HandoverPanel({
  leaveRequestId,
  handover,
  loading,
  error,
  onRetry,
  coverageTaskCount,
  impactReady,
  arrangements = [],
}) {
  const toast = useToast();
  const actions = useHandoverActions(leaveRequestId);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [coordNotes, setCoordNotes] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const presentation = useMemo(
    () =>
      resolveHandoverDetailPresentation({
        coverageTaskCount,
        impactReady,
        handover,
      }),
    [coverageTaskCount, impactReady, handover]
  );

  const run = async (key, fn) => {
    try {
      setBusyKey(key);
      await fn();
    } catch (err) {
      toast.push(err.response?.data?.message || err.message || "Handover action failed.");
    } finally {
      setBusyKey("");
    }
  };

  if (loading) {
    return (
      <div className="li-panel">
        <p className="li-muted">Loading handover…</p>
        <Skeleton />
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

  const items = (handover?.items || []).filter((it) => it.status !== "CANCELLED");
  const editable = handover && ["DRAFT", "NEEDS_REVISION"].includes(handover.status);
  const canChangeBackup =
    handover &&
    [
      "DRAFT",
      "NEEDS_REVISION",
      "AWAITING_BACKUP_ACKNOWLEDGEMENT",
      "READY_FOR_MANAGER_REVIEW",
    ].includes(handover.status);
  const canCoordinate =
    handover &&
    [
      "DRAFT",
      "SUBMITTED",
      "NEEDS_REVISION",
      "AWAITING_BACKUP_ACKNOWLEDGEMENT",
      "READY_FOR_MANAGER_REVIEW",
    ].includes(handover.status);
  const allBacked =
    items.length > 0 && items.every((it) => it.backupEmployeeId || it.backupEmployee?._id);

  const suggestionsFor = (taskId) => {
    const arr = (arrangements || []).find(
      (a) => String(a.responsibility?.taskId) === String(taskId)
    );
    return arr?.recommendations || [];
  };

  return (
    <div className="li-panel">
      <p className="li-lede">
        Optional work continuity. Incomplete coverage never blocks leave approval.
      </p>

      {presentation.mode !== HANDOVER_DETAIL_MODES.ACTIVE_HANDOVER ? (
        <div className="li-empty-block">
          {presentation.title ? <p>{presentation.title}</p> : null}
          {presentation.body ? <p className="li-muted">{presentation.body}</p> : null}
          {presentation.showStartButton ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={busyKey === "create" || actions.createDraft.isPending}
              onClick={() =>
                run("create", async () => {
                  await actions.createDraft.mutateAsync();
                  toast.push("Handover draft started.");
                })
              }
            >
              {busyKey === "create" ? "Starting…" : presentation.startButtonLabel || "Start handover draft"}
            </button>
          ) : null}
        </div>
      ) : null}

      {presentation.showLifecycle && handover ? (
        <div className="li-handover-card">
          <div className="li-backup-head">
            <div>
              <strong>{handover.originalEmployee?.fullName || "Employee"}</strong>
              <span>
                {items.length} responsibilit{items.length === 1 ? "y" : "ies"}
                {handover.managerEmployee?.fullName
                  ? ` · Coordinated by ${handover.managerEmployee.fullName}`
                  : ""}
              </span>
            </div>
            <em className="li-pill">{statusLabel(handover.status, HANDOVER_STATUS_LABELS)}</em>
          </div>

          {items.map((item) => {
            const selectedBackupId = item.backupEmployee?._id || item.backupEmployeeId || "";
            const suggestions = suggestionsFor(item.taskId);
            return (
              <div key={item._id} className="li-handover-item">
                <strong>{item.taskSnapshot?.title || "Responsibility"}</strong>
                <span className="li-muted">
                  Status: {statusLabel(item.status, ITEM_STATUS_LABELS)}
                </span>
                {selectedBackupId ? (
                  <p className="li-selected">
                    Coverage: <strong>{item.backupEmployee?.fullName || "Employee"}</strong>
                  </p>
                ) : (
                  <p className="li-chip">No coverage employee selected yet.</p>
                )}

                {canChangeBackup ? (
                  <label className="li-field">
                    <span>Select coverage employee</span>
                    <select
                      value={String(selectedBackupId || "")}
                      disabled={Boolean(busyKey)}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        const isDraft = ["DRAFT", "NEEDS_REVISION"].includes(handover.status);
                        run(`backup-${item._id}`, async () => {
                          if (isDraft) {
                            await actions.saveItem.mutateAsync({
                              handoverId: handover._id,
                              itemId: item._id,
                              instructions: noteDrafts[item._id] ?? item.instructions ?? "",
                              backupEmployeeId: val,
                            });
                          } else {
                            await actions.reassignBackup.mutateAsync({
                              handoverId: handover._id,
                              itemId: item._id,
                              backupEmployeeId: val,
                            });
                          }
                          toast.push("Coverage employee updated.");
                        });
                      }}
                    >
                      <option value="">Choose employee…</option>
                      {suggestions.map((rec) => (
                        <option key={rec.employee._id} value={String(rec.employee._id)}>
                          {rec.employee.fullName}
                          {rec.suitability?.label ? ` (${rec.suitability.label})` : ""}
                        </option>
                      ))}
                      {selectedBackupId &&
                      !suggestions.some((r) => String(r.employee._id) === String(selectedBackupId)) &&
                      item.backupEmployee ? (
                        <option value={String(selectedBackupId)}>
                          {item.backupEmployee.fullName}
                        </option>
                      ) : null}
                    </select>
                  </label>
                ) : null}

                {editable ? (
                  <label className="li-field">
                    <span>Instructions</span>
                    <textarea
                      rows={2}
                      value={noteDrafts[item._id] ?? item.instructions ?? ""}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({ ...prev, [item._id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busyKey === `save-${item._id}`}
                      onClick={() =>
                        run(`save-${item._id}`, async () => {
                          await actions.saveItem.mutateAsync({
                            handoverId: handover._id,
                            itemId: item._id,
                            instructions: noteDrafts[item._id] ?? item.instructions ?? "",
                            backupEmployeeId:
                              item.backupEmployeeId || item.backupEmployee?._id || null,
                          });
                          toast.push("Notes saved.");
                        })
                      }
                    >
                      {busyKey === `save-${item._id}` ? "Saving…" : "Save notes"}
                    </button>
                  </label>
                ) : item.instructions ? (
                  <p className="li-muted">Notes: {item.instructions}</p>
                ) : null}
              </div>
            );
          })}

          <div className="li-handover-actions">
            {editable && allBacked ? (
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busyKey === "submit"}
                onClick={() =>
                  run("submit", async () => {
                    await actions.submit.mutateAsync(handover._id);
                    toast.push("Coordination requested.");
                  })
                }
              >
                {busyKey === "submit" ? "Submitting…" : "Request manager coordination"}
              </button>
            ) : null}

            {canCoordinate && allBacked ? (
              <>
                <label className="li-field">
                  <span>Coordination notes</span>
                  <textarea
                    rows={2}
                    value={coordNotes}
                    onChange={(e) => setCoordNotes(e.target.value)}
                    placeholder="Optional notes for coverage"
                  />
                </label>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={busyKey === "coordinate"}
                  onClick={() =>
                    run("coordinate", async () => {
                      await actions.coordinate.mutateAsync({
                        handoverId: handover._id,
                        notes: coordNotes,
                      });
                      toast.push("Coverage coordinated.");
                    })
                  }
                >
                  {busyKey === "coordinate" ? "Coordinating…" : "Coordinate coverage"}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busyKey === "revise"}
                  onClick={() =>
                    run("revise", async () => {
                      await actions.revise.mutateAsync({
                        handoverId: handover._id,
                        reason: coordNotes || "Please update coverage details.",
                      });
                      toast.push("Updates requested.");
                    })
                  }
                >
                  {busyKey === "revise" ? "Sending…" : "Request updates"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import {
  HANDOVER_DETAIL_MODES,
  resolveHandoverDetailPresentation,
} from "../utils/handoverDetailPresentation";

/** Employee-facing status labels — no internal lifecycle jargon. */
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

function formatShortDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * Compact handover workspace for employees and HR leave details.
 * Manager/HR coordinates coverage — no employee-to-employee acknowledgement.
 */
export default function HandoverWorkspace({
  mode = "employee",
  leaveRequestId = null,
  canManage = true,
  coverageTaskCount = null,
  impactReady = false,
  arrangements = [],
  refreshToken = 0,
}) {
  const [data, setData] = useState(null);
  const [handover, setHandover] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [noteDrafts, setNoteDrafts] = useState({});
  const [responseDrafts, setResponseDrafts] = useState({});

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/handovers/mine");
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load responsibilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadForLeave = useCallback(async () => {
    if (!leaveRequestId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/handovers/leave/${leaveRequestId}`);
      setHandover(res.data.handover || null);
    } catch (err) {
      if (err.response?.status === 404) setHandover(null);
      else setError(err.response?.data?.message || "Could not load handover.");
    } finally {
      setLoading(false);
    }
  }, [leaveRequestId]);

  useEffect(() => {
    if (mode === "employee") loadMine();
    else loadForLeave();
  }, [mode, loadMine, loadForLeave, refreshToken]);

  const createHandover = async () => {
    if (!leaveRequestId) return;
    try {
      setBusy("create");
      setError("");
      const res = await api.post(`/handovers/leave/${leaveRequestId}`);
      setHandover(res.data.handover);
    } catch (err) {
      setError(err.response?.data?.message || "Could not start coverage draft.");
    } finally {
      setBusy("");
    }
  };

  const saveItemNotes = async (h, item) => {
    try {
      setBusy(`save-${item._id}`);
      const res = await api.put(`/handovers/${h._id}`, {
        items: [
          {
            itemId: item._id,
            instructions: noteDrafts[item._id] ?? item.instructions ?? "",
            backupEmployeeId: item.backupEmployeeId || item.backupEmployee?._id || null,
          },
        ],
      });
      setHandover(res.data.handover);
      if (mode === "employee") await loadMine();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save notes.");
    } finally {
      setBusy("");
    }
  };

  const selectItemBackup = async (h, item, backupEmployeeId) => {
    try {
      setBusy(`backup-${item._id}`);
      setError("");
      if (["DRAFT", "NEEDS_REVISION"].includes(h.status)) {
        const res = await api.put(`/handovers/${h._id}`, {
          items: [
            {
              itemId: item._id,
              instructions: noteDrafts[item._id] ?? item.instructions ?? "",
              backupEmployeeId: backupEmployeeId || null,
            },
          ],
        });
        setHandover(res.data.handover);
      } else {
        const res = await api.post(`/handovers/${h._id}/items/${item._id}/reassign`, {
          backupEmployeeId,
        });
        setHandover(res.data.handover);
      }
      if (mode === "employee") await loadMine();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update coverage employee.");
    } finally {
      setBusy("");
    }
  };

  const submit = async (h) => {
    try {
      setBusy(`submit-${h._id}`);
      const res = await api.post(`/handovers/${h._id}/submit`);
      setHandover(res.data.handover);
      if (mode === "employee") await loadMine();
    } catch (err) {
      setError(err.response?.data?.message || "Could not request coordination.");
    } finally {
      setBusy("");
    }
  };

  const coordinate = async (h) => {
    try {
      setBusy(`coordinate-${h._id}`);
      const notes = responseDrafts[`mgr-${h._id}`] || "";
      const res = await api.post(`/handovers/${h._id}/coordinate`, { notes });
      setHandover(res.data.handover);
      if (mode === "employee") await loadMine();
    } catch (err) {
      setError(err.response?.data?.message || "Could not coordinate coverage.");
    } finally {
      setBusy("");
    }
  };

  const decide = async (h, decision) => {
    try {
      setBusy(`decide-${h._id}`);
      const reason = responseDrafts[`mgr-${h._id}`] || "";
      const res = await api.post(`/handovers/${h._id}/decide`, { decision, reason });
      setHandover(res.data.handover);
      if (mode === "employee") await loadMine();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update coverage.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <p className="lm-impact-muted">Loading responsibilities…</p>;

  if (mode === "leaveDetail") {
    const presentation = resolveHandoverDetailPresentation({
      coverageTaskCount,
      impactReady,
      handover,
    });

    const canCoordinate =
      canManage &&
      handover &&
      [
        "DRAFT",
        "SUBMITTED",
        "NEEDS_REVISION",
        "AWAITING_BACKUP_ACKNOWLEDGEMENT",
        "READY_FOR_MANAGER_REVIEW",
      ].includes(handover.status);

    return (
      <div className="lm-handover-panel">
        <h4 className="lm-review-subhead">Temporary coverage</h4>
        {presentation.mode !== HANDOVER_DETAIL_MODES.NO_HANDOVER_REQUIRED && (
          <p className="lm-impact-muted">
            Optional work continuity. Incomplete coverage never blocks leave approval.
          </p>
        )}
        {error && (
          <div className="error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {presentation.mode !== HANDOVER_DETAIL_MODES.ACTIVE_HANDOVER && (
          <div className="lm-empty-state">
            {presentation.title ? <p>{presentation.title}</p> : null}
            {presentation.body ? (
              <p className="lm-impact-muted" style={{ marginBottom: presentation.showStartButton ? 8 : 0 }}>
                {presentation.body}
              </p>
            ) : null}
            {canManage && presentation.showStartButton && (
              <button
                type="button"
                className="btn-secondary btn-sm lm-action-btn"
                disabled={busy === "create"}
                onClick={createHandover}
              >
                {busy === "create"
                  ? "Starting…"
                  : presentation.startButtonLabel || "Start coverage draft"}
              </button>
            )}
          </div>
        )}

        {presentation.showLifecycle && handover && (
          <HandoverCard
            handover={handover}
            noteDrafts={noteDrafts}
            setNoteDrafts={setNoteDrafts}
            responseDrafts={responseDrafts}
            setResponseDrafts={setResponseDrafts}
            busy={busy}
            onSaveItem={saveItemNotes}
            onSelectBackup={selectItemBackup}
            onSubmit={submit}
            onCoordinate={coordinate}
            onDecide={decide}
            canManage={canManage}
            asCoordinator={Boolean(canCoordinate)}
            arrangements={arrangements}
            showCoordinatorHelp
          />
        )}
      </div>
    );
  }

  const outgoing = data?.outgoing || [];
  const incoming = data?.incoming || [];
  const managing = data?.managing || [];

  return (
    <section className="lm-review-section" aria-label="Work handovers">
      <h4 className="lm-impact-heading">Work handovers</h4>
      <p className="lm-impact-lede">
        Track responsibilities you have handed over and those coordinated for you to cover.
        Coverage does not change leave approval.
      </p>
      {error && (
        <div className="error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      {outgoing.length === 0 && incoming.length === 0 && managing.length === 0 && (
        <p className="lm-info-chip">
          No coverage arrangements yet. Start one from a leave request when continuity planning is
          needed.
        </p>
      )}

      {outgoing.length > 0 && (
        <div className="lm-handover-group">
          <h5 className="lm-review-subhead">Responsibilities I&apos;ve handed over</h5>
          {outgoing.map((h) => (
            <HandoverCard
              key={h._id}
              handover={h}
              noteDrafts={noteDrafts}
              setNoteDrafts={setNoteDrafts}
              responseDrafts={responseDrafts}
              setResponseDrafts={setResponseDrafts}
              busy={busy}
              onSaveItem={saveItemNotes}
              onSubmit={submit}
              onCoordinate={coordinate}
              onDecide={decide}
              canManage
            />
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="lm-handover-group">
          <h5 className="lm-review-subhead">Responsibilities assigned to me</h5>
          {incoming.map((h) => (
            <HandoverCard
              key={`in-${h._id}`}
              handover={h}
              noteDrafts={noteDrafts}
              setNoteDrafts={setNoteDrafts}
              responseDrafts={responseDrafts}
              setResponseDrafts={setResponseDrafts}
              busy={busy}
              onSaveItem={saveItemNotes}
              onSubmit={submit}
              onCoordinate={coordinate}
              onDecide={decide}
              canManage={false}
              asCoverer
            />
          ))}
        </div>
      )}

      {managing.length > 0 && (
        <div className="lm-handover-group">
          <h5 className="lm-review-subhead">Coverage to coordinate</h5>
          {managing.map((h) => (
            <HandoverCard
              key={`mgr-${h._id}`}
              handover={h}
              noteDrafts={noteDrafts}
              setNoteDrafts={setNoteDrafts}
              responseDrafts={responseDrafts}
              setResponseDrafts={setResponseDrafts}
              busy={busy}
              onSaveItem={saveItemNotes}
              onSelectBackup={selectItemBackup}
              onSubmit={submit}
              onCoordinate={coordinate}
              onDecide={decide}
              canManage
              asCoordinator
              arrangements={arrangements}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HandoverCard({
  handover,
  noteDrafts,
  setNoteDrafts,
  responseDrafts,
  setResponseDrafts,
  busy,
  onSaveItem,
  onSelectBackup,
  onSubmit,
  onCoordinate,
  onDecide,
  canManage,
  asCoverer = false,
  asCoordinator = false,
  arrangements = [],
  showCoordinatorHelp = false,
}) {
  const items = (handover.items || []).filter((it) => it.status !== "CANCELLED");
  const editable = canManage && ["DRAFT", "NEEDS_REVISION"].includes(handover.status);
  const canChangeBackup =
    canManage &&
    [
      "DRAFT",
      "NEEDS_REVISION",
      "AWAITING_BACKUP_ACKNOWLEDGEMENT",
      "READY_FOR_MANAGER_REVIEW",
    ].includes(handover.status);
  const canRequestCoordination =
    editable &&
    items.length > 0 &&
    items.every((it) => it.backupEmployeeId || it.backupEmployee?._id);
  const canCoordinateNow =
    asCoordinator &&
    [
      "DRAFT",
      "SUBMITTED",
      "NEEDS_REVISION",
      "AWAITING_BACKUP_ACKNOWLEDGEMENT",
      "READY_FOR_MANAGER_REVIEW",
    ].includes(handover.status) &&
    items.length > 0 &&
    items.every((it) => it.backupEmployeeId || it.backupEmployee?._id);

  const stageLabel = statusLabel(handover.status, HANDOVER_STATUS_LABELS);
  const managerName = handover.managerEmployee?.fullName || null;
  const ownerName = handover.originalEmployee?.fullName || "Colleague";

  const suggestionsFor = (taskId) => {
    const arr = (arrangements || []).find(
      (a) => String(a.responsibility?.taskId) === String(taskId)
    );
    return arr?.recommendations || [];
  };

  return (
    <div className="lm-backup-block lm-handover-card">
      <div className="lm-backup-task-head">
        <div>
          <div className="lm-impact-task-title">{ownerName}</div>
          <div className="lm-impact-task-meta">
            {items.length} responsibilit{items.length === 1 ? "y" : "ies"}
            {managerName ? ` · Coordinated by ${managerName}` : ""}
          </div>
          <p className="lm-handover-stage">{stageLabel}</p>
          {showCoordinatorHelp && (
            <p className="lm-impact-muted">
              Select a coverage employee, add notes if needed, then coordinate temporary coverage in
              one step. Recommendations never assign automatically.
            </p>
          )}
          {(handover.status === "COMPLETED" || handover.status === "CANCELLED") && (
            <p className="lm-impact-muted">
              {handover.completedAt
                ? `Completed ${formatShortDate(handover.completedAt)}`
                : null}
              {handover.cancelledAt
                ? `Cancelled ${formatShortDate(handover.cancelledAt)}`
                : null}
              {handover.cancelReason ? ` — ${handover.cancelReason}` : ""}
            </p>
          )}
        </div>
        <span className="lm-backup-proposed-pill">{stageLabel}</span>
      </div>

      {items.map((item) => {
        const selectedBackupId = item.backupEmployee?._id || item.backupEmployeeId || "";
        const suggestions = suggestionsFor(item.taskId);
        const coverageFrom = formatShortDate(item.delegation?.fromDate || item.coverageFrom);
        const coverageTo = formatShortDate(item.delegation?.toDate || item.coverageTo);
        const taskId = item.taskId;

        return (
          <div key={item._id} className="lm-backup-row lm-handover-item">
            <div className="lm-backup-row-main">
              <strong>{item.taskSnapshot?.title || "Responsibility"}</strong>
              <div className="lm-impact-task-meta">Originally handled by: {ownerName}</div>
              <div className="lm-impact-task-meta">
                Status: {statusLabel(item.status, ITEM_STATUS_LABELS)}
              </div>

              {selectedBackupId ? (
                <p className="lm-handover-selected">
                  Coverage employee:{" "}
                  <strong>{item.backupEmployee?.fullName || "Employee"}</strong>
                </p>
              ) : (
                <p className="lm-info-chip">
                  No coverage employee selected yet. Choose a suggested candidate below.
                </p>
              )}

              {canChangeBackup && onSelectBackup && (
                <label className="lm-decision-remarks" style={{ marginTop: 8 }}>
                  <span>Select coverage employee</span>
                  <select
                    className="filter-select"
                    value={String(selectedBackupId || "")}
                    disabled={Boolean(busy)}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      onSelectBackup(handover, item, val);
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
                      !suggestions.some(
                        (r) => String(r.employee._id) === String(selectedBackupId)
                      ) &&
                      item.backupEmployee && (
                        <option value={String(selectedBackupId)}>
                          {item.backupEmployee.fullName} (current)
                        </option>
                      )}
                  </select>
                </label>
              )}

              {item.delegation?.status && (
                <div className="lm-impact-task-meta">
                  {item.delegation.status === "ACTIVE" || item.delegation.status === "SCHEDULED"
                    ? "Temporary Coverage"
                    : `Coverage: ${item.delegation.status}`}
                  {coverageFrom && coverageTo ? ` · ${coverageFrom} – ${coverageTo}` : ""}
                </div>
              )}

              {editable ? (
                <label className="lm-decision-remarks" style={{ marginTop: 8 }}>
                  <span>Handover notes</span>
                  <textarea
                    rows={2}
                    value={noteDrafts[item._id] ?? item.instructions ?? ""}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({ ...prev, [item._id]: e.target.value }))
                    }
                  />
                </label>
              ) : (
                item.instructions && <p className="lm-impact-body">{item.instructions}</p>
              )}
            </div>
            <div
              className="lm-backup-row-actions"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {editable && (
                <button
                  type="button"
                  className="btn-secondary btn-sm lm-action-btn"
                  disabled={busy === `save-${item._id}` || busy === `backup-${item._id}`}
                  onClick={() => onSaveItem(handover, item)}
                >
                  Save notes
                </button>
              )}
              {asCoverer &&
                taskId &&
                (item.delegation?.status === "ACTIVE" ||
                  item.delegation?.status === "SCHEDULED") && (
                  <Link
                    to={`/app/tasks?scope=covering&task=${taskId}`}
                    className="btn-primary btn-sm lm-action-btn"
                  >
                    View responsibility
                  </Link>
                )}
            </div>
          </div>
        );
      })}

      {canManage && ["DRAFT", "NEEDS_REVISION"].includes(handover.status) && canRequestCoordination && (
        <button
          type="button"
          className="btn-primary btn-sm lm-action-btn"
          style={{ marginTop: 8 }}
          disabled={Boolean(busy)}
          onClick={() => onSubmit(handover)}
        >
          Request manager coordination
        </button>
      )}

      {canCoordinateNow && (
        <div style={{ marginTop: 10 }}>
          <label className="lm-decision-remarks">
            <span>Coordination notes (optional)</span>
            <textarea
              rows={2}
              value={responseDrafts[`mgr-${handover._id}`] || ""}
              onChange={(e) =>
                setResponseDrafts((prev) => ({
                  ...prev,
                  [`mgr-${handover._id}`]: e.target.value,
                }))
              }
            />
          </label>
          <div className="lm-row-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn-primary btn-sm lm-action-btn"
              disabled={Boolean(busy)}
              onClick={() => onCoordinate(handover)}
            >
              Coordinate coverage
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm lm-action-btn"
              disabled={Boolean(busy)}
              onClick={() => onDecide(handover, "REVISE")}
            >
              Request updates
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

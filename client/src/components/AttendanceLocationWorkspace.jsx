import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import SoftRefresh from "./SoftRefresh";
import AuthedAvatar from "./AuthedAvatar";
import { initialsFromName } from "../utils/employeeAvatar";
import "./AttendanceLocationWorkspace.css";

const REQUEST_TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "CANCELLED", label: "Cancelled" },
];

const EXCEPTION_TABS = [
  { key: "OPEN", label: "Open" },
  { key: "REVIEWED", label: "Reviewed" },
  { key: "REGULARIZED", label: "Regularized" },
  { key: "DISMISSED", label: "Dismissed" },
];

const TYPE_LABEL = {
  OUTSIDE_GEOFENCE: "Outside geofence",
  LOW_ACCURACY: "Low GPS accuracy",
  GPS_UNAVAILABLE: "GPS unavailable",
  RETURNED_INSIDE: "Returned inside",
  PUNCH_OUTSIDE: "Punch outside zone",
};

function formatWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPeriod(period) {
  const start = period?.startTime || period?.start || "";
  const end = period?.endTime || period?.end || "";
  if (!start && !end) return "All day (company timezone)";
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function formatCoords(location) {
  const lat = location?.latitude;
  const lng = location?.longitude;
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return null;
  }
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function formatDistance(row) {
  if (row.distanceMeters == null || !Number.isFinite(Number(row.distanceMeters))) {
    return { primary: "Distance unavailable", detail: "Could not be calculated reliably from stored coordinates." };
  }
  const meters = Math.round(Number(row.distanceMeters));
  const radius = row.permittedLocation?.radiusMeters;
  const primary =
    radius != null && Number.isFinite(Number(radius))
      ? `${meters}m from zone · ${Math.round(Number(radius))}m allowed`
      : `${meters}m from permitted zone`;
  return {
    primary,
    detail: row.distanceReliable === false
      ? "Treat as approximate — permitted zone or reading may be incomplete."
      : null,
  };
}

function eligibilityFromRow(row) {
  const eligibility = row?.punchEligibility;
  if (eligibility?.label) {
    return {
      label: eligibility.label,
      detail: eligibility.detail || "",
      tone: eligibility.tone || (eligibility.remotePunchAllowed ? "ok" : "blocked"),
      remotePunchAllowed: Boolean(eligibility.remotePunchAllowed),
      code: eligibility.code || "",
    };
  }
  return {
    label: "Remote attendance not authorized",
    detail: "Eligibility could not be loaded from the server.",
    tone: "blocked",
    remotePunchAllowed: false,
    code: "",
  };
}

/**
 * HR workspace for hybrid remote-work approvals and location exceptions.
 * Mounted from Admin Attendance under ?workspace=remote|exceptions.
 * Punch eligibility is rendered from backend punchEligibility — not inferred locally.
 */
export default function AttendanceLocationWorkspace({
  mode = "remote",
  focusRemoteWorkRequestId = "",
  focusSessionId = "",
  onFocusConsumed = null,
}) {
  const isRemote = mode === "remote";
  const focusRemoteId = String(focusRemoteWorkRequestId || "").trim();
  const focusSessId = String(focusSessionId || "").trim();
  const needsDeepLinkLookup = Boolean(
    (isRemote && focusRemoteId) || (!isRemote && focusSessId)
  );
  const [status, setStatus] = useState(
    needsDeepLinkLookup ? "ALL" : isRemote ? "PENDING" : "OPEN"
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [remarksById, setRemarksById] = useState({});
  const [companyTimezone, setCompanyTimezone] = useState("");
  const [focusedRowId, setFocusedRowId] = useState("");

  const load = useCallback(async () => {
    try {
      setFetching(true);
      setError("");
      const path = isRemote
        ? `/admin/attendance/remote-requests?status=${encodeURIComponent(status)}`
        : `/admin/attendance/location-exceptions?status=${encodeURIComponent(status)}`;
      const res = await api.get(path);
      setRows(isRemote ? res.data?.requests || [] : res.data?.exceptions || []);
      setCompanyTimezone(res.data?.companyTimezone || "");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load records.");
      setRows([]);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [isRemote, status]);

  useEffect(() => {
    if (needsDeepLinkLookup) setStatus("ALL");
    else setStatus(isRemote ? "PENDING" : "OPEN");
  }, [isRemote, needsDeepLinkLookup]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Deep-link focus: match remote request id or exception sessionId, then settle status tab.
  useEffect(() => {
    if (!needsDeepLinkLookup || loading) return;
    const hit = rows.find((row) => {
      if (isRemote) {
        return String(row._id || row.id) === focusRemoteId;
      }
      return (
        String(row.sessionId || "") === focusSessId ||
        String(row._id || row.id) === focusSessId
      );
    });
    if (hit) {
      const id = String(hit._id || hit.id);
      setFocusedRowId(id);
      if (hit.status && String(hit.status).toUpperCase() !== String(status).toUpperCase()) {
        setStatus(String(hit.status).toUpperCase());
      }
      requestAnimationFrame(() => {
        const el = document.getElementById(`alw-card-${id}`);
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    if (typeof onFocusConsumed === "function") onFocusConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDeepLinkLookup, loading, rows, focusRemoteId, focusSessId, isRemote]);

  const decideRemote = async (id, decision) => {
    try {
      setBusyId(id);
      setError("");
      await api.post(`/admin/attendance/remote-requests/${id}/decide`, {
        decision,
        remarks: remarksById[id] || "",
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Decision failed.");
    } finally {
      setBusyId("");
    }
  };

  const reviewException = async (id, nextStatus) => {
    try {
      setBusyId(id);
      setError("");
      await api.post(`/admin/attendance/location-exceptions/${id}/review`, {
        status: nextStatus,
        remarks: remarksById[id] || "",
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Review failed.");
    } finally {
      setBusyId("");
    }
  };

  const tabs = isRemote ? REQUEST_TABS : EXCEPTION_TABS;

  return (
    <div className={`attendance-location-workspace ${isRemote ? "is-remote" : "is-exceptions"}`}>
      <div className="alw-explainer" role="note">
        {isRemote ? (
          <>
            <strong>Remote Approvals</strong>
            <p>
              Hybrid employees request permission to punch in remotely for a specific work date and
              optional time window. Only an <em>approved, unused</em> request authorizes a remote
              session on that date. Office / WFH rules are unchanged by Location Exceptions.
            </p>
          </>
        ) : (
          <>
            <strong>Location Exceptions</strong>
            <p>
              Geofence or GPS accuracy events from punch or live monitoring. Reviewing, regularizing,
              or dismissing an exception does <em>not</em> grant remote punch-in rights — use Remote
              Approvals for that. Punch eligibility below comes from work mode and remote approvals.
            </p>
          </>
        )}
        {companyTimezone ? (
          <p className="alw-tz">Company timezone: {companyTimezone}</p>
        ) : null}
      </div>

      <div className="alw-toolbar">
        <div className="alw-tabs" role="tablist" aria-label={isRemote ? "Remote request status" : "Exception status"}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={status === tab.key}
              className={status === tab.key ? "btn-primary" : "btn-secondary"}
              onClick={() => setStatus(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="alw-toolbar-actions">
          <SoftRefresh active={fetching && !loading} />
          <button type="button" className="btn-secondary" onClick={load} disabled={fetching}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error alw-error">{error}</div> : null}

      {loading ? (
        <div className="alw-state">Loading {isRemote ? "remote approvals" : "location exceptions"}…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state alw-empty">
          <p>
            {isRemote
              ? "No remote-work requests in this status."
              : "No location exceptions in this status."}
          </p>
          <p className="caption">
            {isRemote
              ? "Pending hybrid requests appear here when employees ask to work remotely."
              : "Outside-radius and accuracy events appear here when geofence policy records them."}
          </p>
        </div>
      ) : (
        <ul className="alw-cards">
          {rows.map((row) => {
            const id = String(row._id || row.id);
            const name = row.employee?.fullName || row.employeeName || row.fullName || "Employee";
            const code = row.employee?.employeeCode || row.employeeCode || "";
            const email = row.employee?.email || "";
            const workMode = row.workMode || row.employee?.workMode || "";
            const avatar = row.employee?.avatar || row.avatar || "";
            const eligibility = eligibilityFromRow(row);
            const coords = formatCoords(row.location);
            const distance = !isRemote ? formatDistance(row) : null;

            return (
              <li
                key={id}
                id={`alw-card-${id}`}
                className={`alw-card${focusedRowId === id ? " is-focused" : ""}`}
              >
                <div className="alw-card-top">
                  <div className="alw-identity">
                    <div className="alw-identity-row">
                      <AuthedAvatar
                        className="alw-avatar"
                        employee={row.employee || { avatar }}
                        avatar={avatar}
                        name={name}
                        initials={initialsFromName(name, "E")}
                        alt={name}
                      />
                      <div>
                        <div className="alw-name">{name}</div>
                        <div className="alw-meta-line">
                          {[code, email, workMode ? `Mode: ${workMode}` : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={`alw-elig is-${eligibility.tone}`} title={eligibility.code || undefined}>
                    <span className="alw-elig-label">{eligibility.label}</span>
                    {eligibility.detail ? <span className="alw-elig-detail">{eligibility.detail}</span> : null}
                    {eligibility.remotePunchAllowed ? (
                      <span className="alw-elig-flag is-yes">Remote punch: allowed</span>
                    ) : (
                      <span className="alw-elig-flag is-no">Remote punch: not allowed</span>
                    )}
                  </div>
                </div>

                <div className="alw-grid">
                  {isRemote ? (
                    <>
                      <div>
                        <div className="alw-label">Why listed</div>
                        <div>{row.whyListed || "Remote-work request"}</div>
                      </div>
                      <div>
                        <div className="alw-label">Status</div>
                        <div>
                          <span className={`alw-status is-${String(row.status || status).toLowerCase()}`}>
                            {row.status || status}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="alw-label">Work date / duration</div>
                        <div>{row.workDate || "—"}</div>
                        <div className="caption">{formatPeriod(row.sessionPeriod)}</div>
                      </div>
                      <div>
                        <div className="alw-label">Reason</div>
                        <div>{row.reason || "—"}</div>
                      </div>
                      <div>
                        <div className="alw-label">Approved remote location</div>
                        <div>{row.location?.label || "Remote"}</div>
                        <div className="caption">{row.location?.address || coords || "—"}</div>
                        {row.location?.radiusMeters != null ? (
                          <div className="caption">Radius {row.location.radiusMeters}m</div>
                        ) : null}
                      </div>
                      <div>
                        <div className="alw-label">Submitted</div>
                        <div>{formatWhen(row.createdAt || row.submittedAt)}</div>
                      </div>
                      {(row.decidedAt || row.decidedByName || row.decisionRemarks) && (
                        <div>
                          <div className="alw-label">Decision</div>
                          <div>
                            {row.decidedByName ? `By ${row.decidedByName}` : "Decided"}
                            {row.decidedAt ? ` · ${formatWhen(row.decidedAt)}` : ""}
                          </div>
                          {row.decisionRemarks ? <div className="caption">{row.decisionRemarks}</div> : null}
                          {row.consumedAt ? (
                            <div className="caption">Used for a remote session {formatWhen(row.consumedAt)}</div>
                          ) : null}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="alw-label">Why listed</div>
                        <div>{row.whyListed || TYPE_LABEL[row.type] || row.type || "Location exception"}</div>
                        <div className="caption">{row.message || ""}</div>
                      </div>
                      <div>
                        <div className="alw-label">Status</div>
                        <div>
                          <span className={`alw-status is-${String(row.status || status).toLowerCase()}`}>
                            {row.status || status}
                          </span>
                          <span className="caption"> · {row.sessionType || "Session"}</span>
                        </div>
                        <div className="caption">{TYPE_LABEL[row.type] || row.type}</div>
                      </div>
                      <div>
                        <div className="alw-label">When</div>
                        <div>{row.workDate || "—"}</div>
                        <div className="caption">{formatWhen(row.occurredAt || row.createdAt)}</div>
                        {row.returnedAt ? (
                          <div className="caption">Returned {formatWhen(row.returnedAt)}</div>
                        ) : null}
                      </div>
                      <div>
                        <div className="alw-label">Employee location</div>
                        <div>{coords || "Not recorded"}</div>
                        <div className="caption">{row.location?.address || ""}</div>
                        {row.location?.accuracy != null ? (
                          <div className="caption">Accuracy ±{Math.round(Number(row.location.accuracy))}m</div>
                        ) : null}
                      </div>
                      <div>
                        <div className="alw-label">Permitted zone</div>
                        <div>{row.permittedLocation?.label || "Configured zone"}</div>
                        <div className="caption">
                          {formatCoords(row.permittedLocation) || "Coordinates unavailable"}
                          {row.permittedLocation?.radiusMeters != null
                            ? ` · ${row.permittedLocation.radiusMeters}m radius`
                            : ""}
                        </div>
                      </div>
                      <div>
                        <div className="alw-label">Distance</div>
                        <div>{distance?.primary}</div>
                        {distance?.detail ? <div className="caption">{distance.detail}</div> : null}
                      </div>
                      {(row.reviewedAt || row.reviewedByName || row.reviewRemarks) && (
                        <div>
                          <div className="alw-label">Review</div>
                          <div>
                            {row.reviewedByName ? `By ${row.reviewedByName}` : "Reviewed"}
                            {row.reviewedAt ? ` · ${formatWhen(row.reviewedAt)}` : ""}
                          </div>
                          {row.reviewRemarks ? <div className="caption">{row.reviewRemarks}</div> : null}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="alw-actions">
                  {(isRemote && status === "PENDING") || (!isRemote && status === "OPEN") ? (
                    <>
                      <label className="alw-remarks">
                        <span className="alw-label">HR notes</span>
                        <textarea
                          className="policies-input-control"
                          rows={2}
                          placeholder="Optional comment"
                          value={remarksById[id] || ""}
                          onChange={(e) =>
                            setRemarksById((prev) => ({ ...prev, [id]: e.target.value }))
                          }
                        />
                      </label>
                      <div className="alw-action-buttons">
                        {isRemote ? (
                          <>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={busyId === id}
                              onClick={() => decideRemote(id, "APPROVED")}
                            >
                              Approve remote day
                            </button>
                            <button
                              type="button"
                              className="btn-secondary alw-danger"
                              disabled={busyId === id}
                              onClick={() => decideRemote(id, "REJECTED")}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={busyId === id}
                              onClick={() => reviewException(id, "REVIEWED")}
                            >
                              Mark reviewed
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busyId === id}
                              onClick={() => reviewException(id, "REGULARIZED")}
                            >
                              Mark regularized
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busyId === id}
                              onClick={() => reviewException(id, "DISMISSED")}
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                      {!isRemote ? (
                        <p className="caption alw-action-note">
                          These actions close the exception record only. They do not authorize remote punch-in/out.
                        </p>
                      ) : (
                        <p className="caption alw-action-note">
                          Approval authorizes remote punch only on the request date/window, once, at the approved location.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="caption">
                      {isRemote
                        ? row.decisionRemarks || (row.consumedAt ? "Approval already consumed." : "No further action.")
                        : row.reviewRemarks || "No further open action."}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

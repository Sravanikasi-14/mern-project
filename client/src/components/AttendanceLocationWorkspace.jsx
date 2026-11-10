import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import SoftRefresh from "./SoftRefresh";

const REQUEST_TABS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

const EXCEPTION_TABS = [
  { key: "OPEN", label: "Open" },
  { key: "REVIEWED", label: "Reviewed" },
  { key: "DISMISSED", label: "Dismissed" },
];

function formatWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * HR workspace for hybrid remote-work approvals and location exceptions.
 * Mounted from Admin Attendance under ?workspace=remote|exceptions.
 */
export default function AttendanceLocationWorkspace({ mode = "remote" }) {
  const isRemote = mode === "remote";
  const [status, setStatus] = useState(isRemote ? "PENDING" : "OPEN");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [remarksById, setRemarksById] = useState({});

  const load = useCallback(async () => {
    try {
      setFetching(true);
      setError("");
      const path = isRemote
        ? `/admin/attendance/remote-requests?status=${encodeURIComponent(status)}`
        : `/admin/attendance/location-exceptions?status=${encodeURIComponent(status)}`;
      const res = await api.get(path);
      setRows(isRemote ? res.data?.requests || [] : res.data?.exceptions || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load records.");
      setRows([]);
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, [isRemote, status]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

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
    <div className="attendance-location-workspace">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={status === tab.key ? "btn-primary" : "btn-secondary"}
              onClick={() => setStatus(tab.key)}
              style={{ padding: "6px 12px", fontSize: 13 }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SoftRefresh active={fetching && !loading} />
          <button type="button" className="btn-secondary" onClick={load} disabled={fetching}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div> : null}

      {loading ? (
        <div className="caption">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: 28, textAlign: "center" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {isRemote ? "No remote-work requests in this status." : "No location exceptions in this status."}
          </p>
        </div>
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                {isRemote ? (
                  <>
                    <th>Work date</th>
                    <th>Location</th>
                    <th>Reason</th>
                    <th>Submitted</th>
                  </>
                ) : (
                  <>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Distance</th>
                    <th>Occurred</th>
                  </>
                )}
                <th>HR notes / action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row._id || row.id);
                const name = row.employee?.fullName || row.employeeName || row.fullName || "Employee";
                const code = row.employee?.employeeCode || row.employeeCode || "";
                return (
                  <tr key={id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{name}</div>
                      {code ? <div className="caption">{code}</div> : null}
                    </td>
                    {isRemote ? (
                      <>
                        <td>{row.workDate || "—"}</td>
                        <td>
                          <div>{row.location?.label || "Remote"}</div>
                          <div className="caption">
                            {row.location?.latitude != null
                              ? `${Number(row.location.latitude).toFixed(5)}, ${Number(row.location.longitude).toFixed(5)}`
                              : row.location?.address || "—"}
                          </div>
                        </td>
                        <td style={{ maxWidth: 220 }}>{row.reason || "—"}</td>
                        <td>{formatWhen(row.createdAt || row.submittedAt)}</td>
                      </>
                    ) : (
                      <>
                        <td>{row.workDate || "—"}</td>
                        <td>
                          <div>{row.type || "—"}</div>
                          <div className="caption">{row.sessionType || ""} · {row.message || ""}</div>
                        </td>
                        <td>
                          {row.distanceMeters != null ? `${row.distanceMeters}m` : "—"}
                          {row.permittedLocation?.radiusMeters != null
                            ? ` / ${row.permittedLocation.radiusMeters}m`
                            : ""}
                        </td>
                        <td>{formatWhen(row.occurredAt || row.createdAt)}</td>
                      </>
                    )}
                    <td>
                      {(isRemote && status === "PENDING") || (!isRemote && status === "OPEN") ? (
                        <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                          <textarea
                            className="policies-input-control"
                            rows={2}
                            placeholder="Optional comment"
                            value={remarksById[id] || ""}
                            onChange={(e) =>
                              setRemarksById((prev) => ({ ...prev, [id]: e.target.value }))
                            }
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {isRemote ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={busyId === id}
                                  onClick={() => decideRemote(id, "APPROVED")}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={busyId === id}
                                  onClick={() => decideRemote(id, "REJECTED")}
                                  style={{ color: "#b91c1c" }}
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
                                  onClick={() => reviewException(id, "DISMISSED")}
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="caption">{row.decisionRemarks || row.reviewRemarks || row.remarks || "—"}</div>
                          <div className="caption">{formatWhen(row.decidedAt || row.reviewedAt)}</div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

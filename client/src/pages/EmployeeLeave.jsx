import { useEffect, useState, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import {
  IconClose,
  IconAlertCircle,
  IconAlertTriangle,
  IconInfo,
  IconClock,
} from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";

export default function EmployeeLeave() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const [dashboardData, setDashboardData] = useState(null);

  // Apply Leave Modal
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "CASUAL",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [leaveModalError, setLeaveModalError] = useState("");

  const calculateLeaveEligibility = () => {
    const leaveConfig = dashboardData?.leave?.config;
    const tz = leaveConfig?.timezone || "Asia/Kolkata";
    const officeStartTime = leaveConfig?.officeStartTime || "09:30";

    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date());
      const getP = (t) => parts.find((p) => p.type === t)?.value;
      const todayStr = `${getP("year")}-${getP("month")}-${getP("day")}`;
      let hour = parseInt(getP("hour"), 10);
      if (hour === 24) hour = 0;
      const minute = parseInt(getP("minute"), 10);
      const currentMinutes = hour * 60 + minute;

      const match = typeof officeStartTime === "string" ? officeStartTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null;
      const officeMinutes = match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 9 * 60 + 30;
      const cutoffMinutes = officeMinutes - 60;
      const normCutoff = ((cutoffMinutes % 1440) + 1440) % 1440;
      const cutoffH = Math.floor(normCutoff / 60);
      const cutoffM = normCutoff % 60;
      const cutoffTimeStr = `${String(cutoffH).padStart(2, "0")}:${String(cutoffM).padStart(2, "0")}`;

      const [y, m, d] = todayStr.split("-").map(Number);
      const tmrw = new Date(Date.UTC(y, m - 1, d));
      tmrw.setUTCDate(tmrw.getUTCDate() + 1);
      const tomorrowStr = tmrw.toISOString().split("T")[0];

      const isTodayEligible = currentMinutes < cutoffMinutes;
      const earliestEligibleDate = isTodayEligible ? todayStr : tomorrowStr;

      return {
        timezone: tz,
        officeStartTime,
        cutoffTime: cutoffTimeStr,
        todayStr,
        tomorrowStr,
        isTodayEligible,
        earliestEligibleDate,
        hasConfigError: Boolean(leaveConfig?.error),
        configError: leaveConfig?.error || null,
      };
    } catch {
      const today = new Date().toISOString().split("T")[0];
      return {
        timezone: tz,
        officeStartTime,
        cutoffTime: "08:30",
        todayStr: today,
        tomorrowStr: today,
        isTodayEligible: false,
        earliestEligibleDate: today,
        hasConfigError: false,
        configError: null,
      };
    }
  };

  const leaveEligibility = useMemo(
    () => calculateLeaveEligibility(),
    [dashboardData?.leave?.config]
  );

  const getLeaveOverlapConflict = (startDate, endDate, scheduledRanges) => {
    if (!startDate || !endDate || !Array.isArray(scheduledRanges) || scheduledRanges.length === 0) {
      return null;
    }
    for (const item of scheduledRanges) {
      if (item.status !== "PENDING" && item.status !== "APPROVED") continue;
      const itemStart = item.startDate || item.fromDate;
      const itemEnd = item.endDate || item.toDate;
      if (!itemStart || !itemEnd) continue;

      if (startDate <= itemEnd && endDate >= itemStart) {
        const conflictStart = startDate > itemStart ? startDate : itemStart;
        const conflictEnd = endDate < itemEnd ? endDate : itemEnd;
        return {
          ...item,
          conflictStart,
          conflictEnd,
          formattedConflict:
            conflictStart === conflictEnd ? conflictStart : `${conflictStart} to ${conflictEnd}`,
        };
      }
    }
    return null;
  };

  const handleOpenLeaveModal = () => {
    const elig = calculateLeaveEligibility();
    setLeaveModalError("");
    if (elig.hasConfigError) {
      setLeaveModalError(`Company attendance configuration error: ${elig.configError}`);
    }
    setLeaveForm((prev) => {
      const start = prev.startDate && prev.startDate >= elig.earliestEligibleDate ? prev.startDate : elig.earliestEligibleDate;
      const end = prev.endDate && prev.endDate >= start ? prev.endDate : start;
      const availableTypes = dashboardData?.leave?.detailed || [];
      const hasCurrentType = availableTypes.some((t) => t.code === prev.leaveType);
      const defaultType = hasCurrentType ? prev.leaveType : (availableTypes[0]?.code || "CASUAL");
      return { ...prev, leaveType: defaultType, startDate: start, endDate: end };
    });
    setShowLeaveModal(true);
  };

  const fetchLeaveData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const res = await api.get("/employees/me/dashboard");
      setDashboardData(res.data);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.message || "Failed to load leave records.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaveData();

    // Listen for leave update SSE events
    const baseURL = api.defaults.baseURL || "/api";
    const eventsUrl = `${baseURL.replace(/\/$/, "")}/leave-requests/events`;

    let eventSource = null;
    try {
      eventSource = new EventSource(eventsUrl, { withCredentials: true });
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (
            payload.type === "LEAVE_DECIDED" ||
            payload.type === "LEAVE_SUBMITTED" ||
            payload.type === "LEAVE_TYPE_CHANGED"
          ) {
            fetchLeaveData(true);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // EventSource fallback
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const handleApplyLeave = async (e) => {
    e.preventDefault();
    setLeaveModalError("");

    if (!leaveForm.startDate || !leaveForm.endDate) {
      setLeaveModalError("Both start date and end date are required.");
      return;
    }

    const elig = calculateLeaveEligibility();

    if (elig.hasConfigError) {
      setLeaveModalError(`Company attendance configuration error: ${elig.configError}. Please contact HR.`);
      return;
    }

    if (leaveForm.startDate < elig.todayStr || leaveForm.endDate < elig.todayStr) {
      setLeaveModalError("Leave cannot be applied for past dates.");
      return;
    }

    if (!elig.isTodayEligible && (leaveForm.startDate === elig.todayStr || leaveForm.endDate === elig.todayStr)) {
      setLeaveModalError(
        `Same-day leave requests must be submitted at least 1 hour before office start time (${elig.officeStartTime}). The cutoff time for today was ${elig.cutoffTime} (${elig.timezone}). Earliest selectable date is tomorrow (${elig.tomorrowStr}).`
      );
      return;
    }

    const conflict = getLeaveOverlapConflict(
      leaveForm.startDate,
      leaveForm.endDate,
      dashboardData?.leave?.scheduledRanges || []
    );
    if (conflict) {
      setLeaveModalError(
        `Cannot apply: The selected dates overlap with an existing ${conflict.status} ${conflict.leaveType} leave request (${conflict.formattedConflict}).`
      );
      return;
    }

    try {
      setSubmittingLeave(true);
      const res = await api.post("/employees/me/leave-requests", leaveForm);
      setActionSuccess(res.data?.message || "Leave request submitted successfully!");
      setShowLeaveModal(false);
      setLeaveForm({ leaveType: "CASUAL", startDate: "", endDate: "", reason: "" });
      await fetchLeaveData(true);
    } catch (err) {
      setLeaveModalError(err.response?.data?.message || "Failed to submit leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const leave = dashboardData?.leave;
  const holidays = dashboardData?.holidays || [];
  const detailedBalances = Array.isArray(leave?.detailed) ? leave.detailed : [];
  const recentRequests = Array.isArray(leave?.requests) ? leave.requests : [];

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="Leave" />

      {/* Action alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "#71717a", fontSize: 15 }}>Loading leave records...</p>
        </div>
      ) : error ? (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => fetchLeaveData()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* TOP BAR / APPLY BUTTON */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Leave Balances
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "#71717a" }}>
                Pending requests do not deduct balances until formally approved by HR.
              </p>
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={handleOpenLeaveModal}
              style={{ padding: "9px 18px", fontSize: 13.5, fontWeight: 600 }}
            >
              Apply for Leave
            </button>
          </div>

          {/* LEAVE BALANCE CARDS GRID */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 28,
            }}
          >
            {detailedBalances.length === 0 ? (
              // Fallback simple cards
              <>
                <div style={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Casual Leave</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#09090b", marginTop: 6 }}>{leave?.balance?.casual ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: "#71717a" }}>days remaining</span></div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Sick Leave</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#09090b", marginTop: 6 }}>{leave?.balance?.sick ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: "#71717a" }}>days remaining</span></div>
                </div>
                <div style={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Earned Leave</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: "#09090b", marginTop: 6 }}>{leave?.balance?.earned ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: "#71717a" }}>days remaining</span></div>
                </div>
              </>
            ) : (
              detailedBalances.map((type) => (
                <div
                  key={type.code}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e4e4e7",
                    borderRadius: 12,
                    padding: "18px 20px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>
                      {type.name}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#f4f4f5", color: "#52525b", fontWeight: 600 }}>
                      {type.code}
                    </span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: "#09090b", marginTop: 8 }}>
                    {type.available ?? 0}
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#71717a", marginLeft: 6 }}>days remaining</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#71717a", marginTop: 6 }}>
                    Allocated: {type.totalAllowed ?? "—"} · Used: {type.used ?? 0}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* UPCOMING HOLIDAYS */}
          {holidays.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
                marginBottom: 28,
              }}
            >
              <h4 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                Upcoming Official Holidays
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {holidays.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "12px 14px",
                      background: "#f9fafb",
                      border: "1px solid #f3f4f6",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 11.5, color: "#2563eb", fontWeight: 700, textTransform: "uppercase" }}>{h.day} · {h.date}</div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "#09090b", marginTop: 2 }}>{h.name}</div>
                    <div style={{ fontSize: 11.5, color: "#71717a", marginTop: 2 }}>{h.type}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RECENT LEAVE REQUESTS TABLE */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "24px 28px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                  My Time-Off Requests History
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                  Status and approvals for your submitted leave applications.
                </p>
              </div>
            </div>

            <div className="table-wrapper-relative" style={{ overflowX: "auto" }}>
              {loading && recentRequests && recentRequests.length > 0 && <div className="table-progress-bar" />}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                    <th style={{ padding: "10px 12px" }}>Leave Period</th>
                    <th style={{ padding: "10px 12px" }}>Days</th>
                    <th style={{ padding: "10px 12px" }}>Leave Type</th>
                    <th style={{ padding: "10px 12px" }}>Status</th>
                    <th style={{ padding: "10px 12px" }}>Reason</th>
                    <th style={{ padding: "10px 12px" }}>Applied On</th>
                  </tr>
                </thead>
                <tbody className={loading && recentRequests && recentRequests.length > 0 ? "table-refreshing-dim" : ""}>
                  {loading && (!recentRequests || recentRequests.length === 0) ? (
                    <TableSkeletonRows colCount={6} rowCount={4} widths={["140px", "60px", "80px", "70px", "140px", "80px"]} />
                  ) : !recentRequests || recentRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: "36px 16px", textAlign: "center", color: "#71717a", fontSize: 13.5 }}>
                        <div style={{ marginBottom: 6, fontWeight: 600, color: "#18181b" }}>No leave requests submitted</div>
                        You have not submitted any time-off applications yet.
                      </td>
                    </tr>
                  ) : (
                    recentRequests.map((req) => (
                      <tr key={req._id || req.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#09090b" }}>
                          {req.startDate} to {req.endDate}
                        </td>
                        <td style={{ padding: "12px", fontWeight: 700 }}>{req.days} {req.days === 1 ? "day" : "days"}</td>
                        <td style={{ padding: "12px" }}>{req.leaveType}</td>
                        <td style={{ padding: "12px" }}>
                          <StatusBadge status={req.status} />
                        </td>
                        <td style={{ padding: "12px", color: "#52525b", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {req.reason || "—"}
                        </td>
                        <td style={{ padding: "12px", color: "#71717a" }}>
                          {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* APPLY FOR LEAVE MODAL */}
      {showLeaveModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingLeave && setShowLeaveModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Apply for Time Off
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowLeaveModal(false)}
                disabled={submittingLeave}
              >
                <IconClose size={14} />
              </button>
            </div>

            {leaveModalError && <div className="error" style={{ marginBottom: 14 }}>{leaveModalError}</div>}

            <form onSubmit={handleApplyLeave} style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                  Leave Type <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                >
                  {(detailedBalances.length > 0 ? detailedBalances : [
                    { code: "CASUAL", name: "Casual Leave", available: leave?.balance?.casual ?? 0 },
                    { code: "SICK", name: "Sick Leave", available: leave?.balance?.sick ?? 0 },
                    { code: "EARNED", name: "Earned Leave", available: leave?.balance?.earned ?? 0 },
                  ]).map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name} ({item.available ?? 0} available)
                    </option>
                  ))}
                </select>
              </div>

              {(() => {
                const activeScheduledRanges = dashboardData?.leave?.scheduledRanges || [];
                const dateConflict = getLeaveOverlapConflict(
                  leaveForm.startDate,
                  leaveForm.endDate,
                  activeScheduledRanges
                );

                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                          Start Date <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <input
                          type="date"
                          required
                          min={leaveEligibility.earliestEligibleDate}
                          value={leaveForm.startDate}
                          onChange={(e) => {
                            const newStart = e.target.value;
                            setLeaveForm((prev) => ({
                              ...prev,
                              startDate: newStart,
                              endDate: prev.endDate && prev.endDate < newStart ? newStart : prev.endDate,
                            }));
                          }}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: dateConflict ? "1.5px solid #ef4444" : "1px solid #d4d4d8",
                            fontSize: 13.5,
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                          End Date <span style={{ color: "#ef4444" }}>*</span>
                        </label>
                        <input
                          type="date"
                          required
                          min={leaveForm.startDate || leaveEligibility.earliestEligibleDate}
                          value={leaveForm.endDate}
                          onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: dateConflict ? "1.5px solid #ef4444" : "1px solid #d4d4d8",
                            fontSize: 13.5,
                          }}
                        />
                      </div>
                    </div>

                    {dateConflict && (
                      <div
                        style={{
                          fontSize: 12.5,
                          lineHeight: 1.45,
                          padding: "10px 14px",
                          borderRadius: 8,
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          color: "#991b1b",
                        }}
                      >
                        <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <IconAlertCircle size={16} />
                          <span>Overlapping Leave Date Conflict</span>
                        </div>
                        <div>
                          Selected dates overlap with an existing {dateConflict.status} ({dateConflict.leaveType} leave from {dateConflict.startDate} to {dateConflict.endDate}).
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.4,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: leaveEligibility.isTodayEligible ? "#f0fdf4" : "#fffbeb",
                        border: `1px solid ${leaveEligibility.isTodayEligible ? "#bbf7d0" : "#fde68a"}`,
                        color: leaveEligibility.isTodayEligible ? "#166534" : "#92400e",
                      }}
                    >
                      {leaveEligibility.hasConfigError ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <IconAlertTriangle size={14} />
                          <span>Configuration Error: {leaveEligibility.configError}. Please contact HR.</span>
                        </span>
                      ) : leaveEligibility.isTodayEligible ? (
                        <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 6 }}>
                          <IconInfo size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                          <span>
                            <strong>Same-day leave available:</strong> Today ({leaveEligibility.todayStr}) is eligible until <strong>{leaveEligibility.cutoffTime}</strong> ({leaveEligibility.timezone}).
                          </span>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 6 }}>
                          <IconClock size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                          <span>
                            <strong>Same-day cutoff passed:</strong> Cutoff was {leaveEligibility.cutoffTime} ({leaveEligibility.timezone}). Earliest selectable date is tomorrow (<strong>{leaveEligibility.tomorrowStr}</strong>).
                          </span>
                        </span>
                      )}
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                        Reason for Leave <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <textarea
                        rows="3"
                        required
                        placeholder="Why are you requesting time off?"
                        value={leaveForm.reason}
                        onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid #d4d4d8",
                          fontSize: 13.5,
                          fontFamily: "inherit",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowLeaveModal(false)}
                        disabled={submittingLeave}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={submittingLeave || Boolean(dateConflict)}
                      >
                        {submittingLeave ? "Submitting..." : "Apply for Leave"}
                      </button>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

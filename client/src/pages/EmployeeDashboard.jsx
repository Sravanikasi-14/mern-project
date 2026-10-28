import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconClock,
  IconCheck,
  IconAlertCircle,
  IconCalendar,
  IconArrowRight,
  IconDollar,
} from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import "./EmployeeDashboard.css";

function formatFullINR(amount, symbol = "₹") {
  if (amount == null || isNaN(amount)) return `${symbol}0`;
  const val = Math.round(Number(amount));
  return `${symbol}${val.toLocaleString("en-IN")}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function EmployeeDashboard() {
  const { user, company } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboardData, setDashboardData] = useState(null);
  const [punching, setPunching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  // Quick Leave Modal State
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveModalError, setLeaveModalError] = useState("");
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "CASUAL",
    startDate: "",
    endDate: "",
    reason: "",
  });

  const fetchDashboard = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const response = await api.get("/employees/me/dashboard");
      setDashboardData(response.data);
    } catch (err) {
      if (!silent) {
        if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
          setError("Unable to connect to the server. Please check your connection and try again.");
        } else {
          setError(err.response?.data?.message || "Failed to load employee dashboard data.");
        }
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();

    // Cross-portal real-time synchronization via Server-Sent Events
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
            fetchDashboard(true);
          }
        } catch {
          // ignore non-json
        }
      };
    } catch {
      // EventSource fallback
    }

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        fetchDashboard(true);
      }
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      if (eventSource) eventSource.close();
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, []);

  // Calculate same-day leave cutoff eligibility
  const calculateLeaveEligibility = () => {
    const tz = dashboardData?.companyTimezone || "Asia/Kolkata";
    const officeStartTime = dashboardData?.officeStartTime || "09:30";

    const parts = officeStartTime.split(":");
    let officeHour = parseInt(parts[0], 10);
    let officeMinute = parseInt(parts[1], 10);

    if (isNaN(officeHour) || isNaN(officeMinute)) {
      return {
        hasConfigError: true,
        configError: `Invalid office start time format: ${officeStartTime}`,
        earliestEligibleDate: new Date().toISOString().split("T")[0],
      };
    }

    let cutoffHour = officeHour - 1;
    let cutoffMinute = officeMinute;

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const now = new Date();
    const partsMap = {};
    formatter.formatToParts(now).forEach((p) => {
      partsMap[p.type] = p.value;
    });

    const companyYear = parseInt(partsMap.year, 10);
    const companyMonth = parseInt(partsMap.month, 10);
    const companyDay = parseInt(partsMap.day, 10);
    const companyHour = parseInt(partsMap.hour, 10);
    const companyMinute = parseInt(partsMap.minute, 10);

    const todayStr = `${companyYear}-${String(companyMonth).padStart(2, "0")}-${String(companyDay).padStart(2, "0")}`;

    const tomorrow = new Date(Date.UTC(companyYear, companyMonth - 1, companyDay + 1));
    const tomorrowStr = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;

    const isTodayEligible =
      companyHour < cutoffHour || (companyHour === cutoffHour && companyMinute <= cutoffMinute);

    const cutoffTimeStr = `${String(cutoffHour).padStart(2, "0")}:${String(cutoffMinute).padStart(2, "0")}`;

    return {
      hasConfigError: false,
      isTodayEligible,
      todayStr,
      tomorrowStr,
      earliestEligibleDate: isTodayEligible ? todayStr : tomorrowStr,
      cutoffTime: cutoffTimeStr,
      officeStartTime,
      timezone: tz,
    };
  };

  const leaveEligibility = calculateLeaveEligibility();

  // Overlap conflict detection
  const getLeaveOverlapConflict = (startDate, endDate, scheduledRanges) => {
    if (!startDate || !endDate || !Array.isArray(scheduledRanges)) return null;
    for (const item of scheduledRanges) {
      const itemStart = item.startDate ? item.startDate.split("T")[0] : null;
      const itemEnd = item.endDate ? item.endDate.split("T")[0] : null;
      if (!itemStart || !itemEnd) continue;

      if (startDate <= itemEnd && endDate >= itemStart) {
        const conflictStart = startDate > itemStart ? startDate : itemStart;
        const conflictEnd = endDate < itemEnd ? endDate : itemEnd;
        return {
          ...item,
          conflictStart,
          conflictEnd,
          formattedConflict: conflictStart === conflictEnd ? conflictStart : `${conflictStart} to ${conflictEnd}`,
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

    if (leaveForm.startDate > leaveForm.endDate) {
      setLeaveModalError("Start date cannot be after end date.");
      return;
    }

    const activeRanges = dashboardData?.leave?.scheduledRanges || [];
    const conflict = getLeaveOverlapConflict(leaveForm.startDate, leaveForm.endDate, activeRanges);
    if (conflict) {
      setLeaveModalError(
        `Date conflict: You already have an existing ${conflict.status} ${conflict.leaveType} leave request (${conflict.startDate} to ${conflict.endDate}).`
      );
      return;
    }

    try {
      setSubmittingLeave(true);
      const res = await api.post("/employees/me/leave-requests", leaveForm);
      setActionSuccess(res.data?.message || "Leave request submitted successfully!");
      setShowLeaveModal(false);
      setLeaveForm({ leaveType: "CASUAL", startDate: "", endDate: "", reason: "" });
      await fetchDashboard(true);
    } catch (err) {
      setLeaveModalError(err.response?.data?.message || "Failed to submit leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  // Quick punch handlers with geolocation
  const handlePunch = async (actionType) => {
    try {
      setPunching(true);
      setActionSuccess("");
      setActionError("");

      let payload = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              enableHighAccuracy: true,
            });
          });
          payload = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
        } catch {
          // Continue without coords
        }
      }

      const res = await api.post(`/employees/me/attendance/${actionType}`, payload);
      setActionSuccess(res.data?.message || `Successfully punched ${actionType === "check-in" ? "in" : "out"}!`);
      await fetchDashboard(true);
    } catch (err) {
      setActionError(err.response?.data?.message || `Failed to punch ${actionType === "check-in" ? "in" : "out"}.`);
    } finally {
      setPunching(false);
    }
  };

  const employee = dashboardData?.employee;
  const attendance = dashboardData?.attendance;
  const leave = dashboardData?.leave;
  const holidays = dashboardData?.holidays || [];
  const payslips = dashboardData?.payslips || [];
  const assets = dashboardData?.assets || [];

  const todayStatus = attendance?.today?.status || "NOT_CHECKED_IN";
  const checkInTimeFormatted = attendance?.today?.checkInTime
    ? new Date(attendance.today.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const checkOutTimeFormatted = attendance?.today?.checkOutTime
    ? new Date(attendance.today.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const latestPayslip = payslips[0] || null;

  const attendanceRate = attendance?.summary?.attendanceRate ?? 100;
  const daysPresent = attendance?.summary?.daysPresent ?? 0;
  const totalWorkingDays = attendance?.summary?.totalWorkingDays ?? 22;

  const employeeName = employee?.preferredName || employee?.fullName || user?.name || "Colleague";

  return (
    <div className="emp-board-container">
      {/* Alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* ====================================================================
          1. Board Head: Greeting, Identity Badges, Quick Actions
          ==================================================================== */}
      {/* ====================================================================
          1. Compact Welcome & Daily Status Area
          ==================================================================== */}
      <div className="emp-head">
        <div className="emp-head__title-group">
          <h1 className="emp-head__title">{getGreeting()}, {employeeName}</h1>
          <div className="emp-head__meta">
            <span className="emp-badge-pill emp-badge-pill--green">
              {employee?.department || "General"}
            </span>
            <span className="emp-badge-pill">
              {employee?.jobTitle || "Team Member"}
            </span>
            {employee?.employeeCode && (
              <span className="emp-badge-pill">
                ID: {employee.employeeCode}
              </span>
            )}
            <span
              className="emp-badge-pill"
              style={{
                background:
                  todayStatus === "CHECKED_IN"
                    ? "var(--g-100)"
                    : todayStatus === "CHECKED_OUT"
                    ? "var(--amber-bg)"
                    : "var(--panel)",
                color:
                  todayStatus === "CHECKED_IN"
                    ? "var(--g-800)"
                    : todayStatus === "CHECKED_OUT"
                    ? "var(--amber)"
                    : "var(--muted)",
                fontWeight: 600,
              }}
            >
              {todayStatus === "CHECKED_IN"
                ? "Shift active"
                : todayStatus === "CHECKED_OUT"
                ? "Shift completed"
                : todayStatus === "ON_LEAVE"
                ? "On leave"
                : "Not clocked in"}
            </span>
          </div>
        </div>

        <div className="emp-head__actions">
          {/* Apply for Leave Action */}
          <button
            type="button"
            className="btn--emp-primary"
            onClick={handleOpenLeaveModal}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
            <span>Apply for Leave</span>
          </button>

          {/* Profile Shortcut */}
          <Link to="/app/profile" className="btn--emp-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>My Profile</span>
          </Link>

          {/* Sync Button */}
          <button
            type="button"
            className="btn--ghost-sync"
            onClick={() => fetchDashboard()}
            title="Refresh dashboard metrics"
            disabled={loading}
            aria-label="Refresh dashboard"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={loading ? "spin-icon" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Loading Skeleton / State */}
      {loading && !dashboardData && (
        <div className="page-loading">
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p style={{ margin: 0 }}>Loading dashboard…</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center", borderRadius: 16 }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" className="btn--emp-primary" onClick={() => fetchDashboard()}>
            Retry Loading Dashboard
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="emp-bento-grid">
          {/* ====================================================================
              SECTION 1: COMBINED ATTENDANCE & LEAVE OPERATIONS (SPAN 12)
              Combines daily punch-in/out, GPS status & time-off balances
              ==================================================================== */}
          <section className="emp-card emp-combined-ops-card" style={{ gridColumn: "span 12" }}>
            <div className="emp-combined-ops-grid">
              {/* Left / Primary: Attendance & Live Shift Actions */}
              <div className="emp-ops-attendance-col">
                <div className="emp-card__head" style={{ marginBottom: 14 }}>
                  <div>
                    <h2 className="emp-card__title">Attendance</h2>
                  </div>
                  <Link to="/app/attendance" className="emp-card__link">
                    <span>View</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <div className="emp-att-hub">
                  <div className="emp-att-status-box">
                    <div className="emp-att-state-left">
                      <span
                        className={`emp-status-badge ${
                          todayStatus === "CHECKED_IN"
                            ? "status-in"
                            : todayStatus === "CHECKED_OUT"
                            ? "status-out"
                            : todayStatus === "ON_LEAVE"
                            ? "status-leave"
                            : "status-not-in"
                        }`}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background:
                              todayStatus === "CHECKED_IN"
                                ? "var(--g-700)"
                                : todayStatus === "CHECKED_OUT"
                                ? "#b45309"
                                : todayStatus === "ON_LEAVE"
                                ? "#0284c7"
                                : "#6b7280",
                          }}
                        />
                        {todayStatus === "CHECKED_IN"
                          ? "Checked in"
                          : todayStatus === "CHECKED_OUT"
                          ? "Shift completed"
                          : todayStatus === "ON_LEAVE"
                          ? "On leave"
                          : "Not checked in"}
                      </span>

                      <div className="emp-att-time-info">
                        {todayStatus === "CHECKED_IN" && (
                          <span>Punched in at <strong>{checkInTimeFormatted}</strong></span>
                        )}
                        {todayStatus === "CHECKED_OUT" && (
                          <span>In: <strong>{checkInTimeFormatted}</strong> · Out: <strong>{checkOutTimeFormatted}</strong></span>
                        )}
                        {todayStatus === "NOT_CHECKED_IN" && (
                          <span>Punch in to start your shift</span>
                        )}
                        {todayStatus === "ON_LEAVE" && (
                          <span>Approved leave today</span>
                        )}
                      </div>
                    </div>

                    {/* Punch Actions */}
                    <div className="emp-punch-actions">
                      <button
                        type="button"
                        className="btn--punch-in"
                        disabled={punching || todayStatus === "CHECKED_IN" || todayStatus === "ON_LEAVE"}
                        onClick={() => handlePunch("check-in")}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>{punching ? "Processing..." : "Punch In"}</span>
                      </button>

                      <button
                        type="button"
                        className="btn--punch-out"
                        disabled={punching || todayStatus !== "CHECKED_IN"}
                        onClick={() => handlePunch("check-out")}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Punch Out</span>
                      </button>
                    </div>
                  </div>

                  <div className="emp-att-footer-row">
                    <span className="emp-att-geo-badge">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>Location verified</span>
                    </span>

                    <span>
                      Office starts {dashboardData?.officeStartTime || "09:30 AM"} · <b>{daysPresent} of {totalWorkingDays}</b> working days present ({attendanceRate}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Right / Secondary: Leave Balances & Fast Request */}
              <div className="emp-ops-leave-col">
                <div className="emp-card__head" style={{ marginBottom: 14 }}>
                  <div>
                    <h2 className="emp-card__title">Leave Balances</h2>
                  </div>
                  <Link to="/app/leave" className="emp-card__link">
                    <span>View</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <div className="emp-leave-tiles">
                  <div className="emp-leave-tile">
                    <span className="emp-leave-tile__type">Casual</span>
                    <span className="emp-leave-tile__count">{leave?.balance?.casual ?? 0}</span>
                    <span className="emp-leave-tile__unit">Days</span>
                  </div>
                  <div className="emp-leave-tile">
                    <span className="emp-leave-tile__type">Sick</span>
                    <span className="emp-leave-tile__count">{leave?.balance?.sick ?? 0}</span>
                    <span className="emp-leave-tile__unit">Days</span>
                  </div>
                  <div className="emp-leave-tile">
                    <span className="emp-leave-tile__type">Earned</span>
                    <span className="emp-leave-tile__count">{leave?.balance?.earned ?? 0}</span>
                    <span className="emp-leave-tile__unit">Days</span>
                  </div>
                </div>

                {leave?.summary?.pending > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <span className="emp-leave-pending-badge">
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#b45309" }} />
                      {leave.summary.pending} pending
                    </span>
                  </div>
                )}

                <div className="emp-leave-cutoff-note" style={{ marginTop: 10 }}>
                  <span>
                    Same-day cutoff: <b>{leaveEligibility.cutoffTime}</b> ({leaveEligibility.timezone}). Earliest: <b>{leaveEligibility.earliestEligibleDate}</b>.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ====================================================================
              SECTION 2: PAY & EMPLOYEE BENEFITS (SPAN 6)
              Combines latest payslip statement and assigned company equipment
              ==================================================================== */}
          <section className="emp-card" style={{ gridColumn: "span 6" }}>
            <div className="emp-card__head">
              <div>
                <h2 className="emp-card__title">Pay & Benefits</h2>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Link to="/app/payslips" className="emp-card__link">
                  <span>Payslips</span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link to="/app/assets" className="emp-card__link">
                  <span>Assets</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className="emp-dual-subsections">
              {/* Sub-panel 1: Payslip */}
              <div className="emp-subpanel">
                <span className="emp-subpanel-title">Latest Payslip</span>
                {latestPayslip ? (
                  <div className="emp-payslip-mini-card">
                    <div className="emp-payslip-mini-left">
                      <span className="emp-payslip-mini-amount">{formatFullINR(latestPayslip.netPay)}</span>
                      <span className="emp-payslip-mini-period">{latestPayslip.month} {latestPayslip.year} Statement</span>
                    </div>
                    <span className={`emp-payslip-status ${latestPayslip.status === "PAID" ? "status-paid" : "status-pending"}`}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: latestPayslip.status === "PAID" ? "var(--g-800)" : "#b45309",
                        }}
                      />
                      {latestPayslip.status || "Paid"}
                    </span>
                  </div>
                ) : (
                  <p className="emp-empty-subtext">No payslip yet.</p>
                )}
              </div>

              {/* Sub-panel 2: Equipment */}
              <div className="emp-subpanel">
                <span className="emp-subpanel-title">Assigned Hardware ({assets.length})</span>
                {assets.length > 0 ? (
                  <div className="emp-asset-mini-list">
                    {assets.slice(0, 2).map((a, idx) => (
                      <div key={a.id || idx} className="emp-asset-mini-item">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                        <span className="emp-asset-mini-name">{a.name}</span>
                        <span className="emp-asset-mini-tag">{a.assetTag || a.serial || "Assigned"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="emp-empty-subtext">None assigned.</p>
                )}
              </div>
            </div>
          </section>

          {/* ====================================================================
              SECTION 3: MY WORK & EMPLOYMENT INFORMATION (SPAN 6)
              Combines project/team allocation and actionable deliverables
              ==================================================================== */}
          <section className="emp-card" style={{ gridColumn: "span 6" }}>
            <div className="emp-card__head">
              <div>
                <h2 className="emp-card__title">My Work</h2>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Link to="/app/tasks" className="emp-card__link">
                  <span>Tasks</span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link to="/app/impact-points" className="emp-card__link">
                  <span>Impact</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className="emp-dual-subsections">
              {/* Sub-panel 1: Project Allocation */}
              <div className="emp-subpanel">
                <span className="emp-subpanel-title">Project</span>
                <div className="emp-project-mini-box">
                  <span className="emp-project-title">{employee?.project?.projectName || "Enterprise Operations"}</span>
                  <span className="emp-project-meta">
                    Type: {employee?.project?.projectType || "Core Function"} · {employee?.workLocation || "Office"}
                  </span>
                </div>
              </div>

              {/* Sub-panel 2: Actionable Tasks */}
              <div className="emp-subpanel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span className="emp-subpanel-title">Tasks</span>
                  <Link to="/app/tasks" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--g-700)", textDecoration: "none" }}>
                    Queue →
                  </Link>
                </div>
                <div className="emp-task-action-box">
                  <div className="emp-task-info">
                    <span className="emp-task-headline">Active Tasks</span>
                  </div>
                  <Link to="/app/tasks" className="emp-task-cta">
                    Review
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* ====================================================================
              SECTION 4: UPCOMING SCHEDULE & SELF-SERVICE (SPAN 12)
              Combines upcoming holidays and self-service quick links
              ==================================================================== */}
          <section className="emp-card emp-schedule-strip-card" style={{ gridColumn: "span 12" }}>
            <div className="emp-schedule-strip-grid">
              {/* Left: Holidays list */}
              <div className="emp-schedule-holidays-col">
                <div className="emp-card__head" style={{ marginBottom: 8 }}>
                  <h3 className="emp-card__title" style={{ fontSize: "14px" }}>Upcoming Holidays</h3>
                </div>
                {holidays.length > 0 ? (
                  <div className="emp-holiday-chips">
                    {holidays.slice(0, 3).map((h, idx) => (
                      <div key={idx} className="emp-holiday-chip">
                        <span className="emp-holiday-date">{formatDisplayDate(h.date)}</span>
                        <span style={{ fontWeight: 600 }}>{h.name}</span>
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>· {h.day || "Holiday"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="emp-empty-subtext">None this quarter.</p>
                )}
              </div>

              {/* Right: Quick Self-Service Links */}
              <div className="emp-schedule-links-col">
                <span className="emp-schedule-links-title">Quick Links</span>
                <div className="emp-quick-links-group">
                  <Link to="/app/profile" className="emp-quick-link-pill">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
                    <span>Profile</span>
                  </Link>
                  <Link to="/app/settings" className="emp-quick-link-pill">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    <span>Settings</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ====================================================================
          QUICK APPLY FOR LEAVE MODAL (Redesigned with Forest-Green Tokens)
          ==================================================================== */}
      {showLeaveModal && (
        <div
          className="emp-modal-backdrop"
          onClick={() => !submittingLeave && setShowLeaveModal(false)}
        >
          <div
            className="emp-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-leave-title"
          >
            <div className="emp-modal-head">
              <h3 id="apply-leave-title" className="emp-modal-title">
                Apply for Leave
              </h3>
              <button
                type="button"
                className="emp-modal-close-btn"
                onClick={() => setShowLeaveModal(false)}
                disabled={submittingLeave}
                aria-label="Close modal"
              >
                <IconClose size={18} />
              </button>
            </div>

            {leaveModalError && (
              <div className="error" style={{ borderRadius: 10, fontSize: 13, padding: "10px 14px" }}>
                {leaveModalError}
              </div>
            )}

            <form onSubmit={handleApplyLeave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="emp-form-group">
                <label className="emp-form-label">
                  Leave Type
                </label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  className="emp-form-select"
                >
                  {(Array.isArray(leave?.detailed) && leave.detailed.length > 0
                    ? leave.detailed
                    : [
                        { code: "CASUAL", name: "Casual Leave", available: leave?.balance?.casual ?? 0 },
                        { code: "SICK", name: "Sick Leave", available: leave?.balance?.sick ?? 0 },
                        { code: "EARNED", name: "Earned Leave", available: leave?.balance?.earned ?? 0 },
                      ]
                  ).map((item) => (
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
                      <div className="emp-form-group">
                        <label className="emp-form-label">
                          Start Date
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
                          className="emp-form-input"
                          style={{
                            borderColor: dateConflict ? "#ef4444" : undefined,
                          }}
                        />
                      </div>
                      <div className="emp-form-group">
                        <label className="emp-form-label">
                          End Date
                        </label>
                        <input
                          type="date"
                          required
                          min={leaveForm.startDate || leaveEligibility.earliestEligibleDate}
                          value={leaveForm.endDate}
                          onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                          className="emp-form-input"
                          style={{
                            borderColor: dateConflict ? "#ef4444" : undefined,
                          }}
                        />
                      </div>
                    </div>

                    {dateConflict && (
                      <div
                        style={{
                          fontSize: 12.5,
                          padding: "10px 14px",
                          borderRadius: 10,
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
                          Conflicts with existing <strong>{dateConflict.status}</strong> request ({dateConflict.formattedConflict}).
                        </div>
                      </div>
                    )}

                    <div className="emp-form-group">
                      <label className="emp-form-label">
                        Reason for Leave
                      </label>
                      <textarea
                        rows="3"
                        required
                        placeholder="Provide details about your planned leave..."
                        value={leaveForm.reason}
                        onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                        className="emp-form-textarea"
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn--emp-secondary"
                        onClick={() => setShowLeaveModal(false)}
                        disabled={submittingLeave}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn--emp-primary"
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

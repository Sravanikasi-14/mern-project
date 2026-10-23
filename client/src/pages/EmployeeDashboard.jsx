import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconClock,
  IconCheck,
  IconAlertCircle,
  IconAlertTriangle,
  IconInfo,
  IconArrowRight,
  IconCalendar,
  IconFileText,
  IconDollar,
} from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

function StatusBadge({ status, label }) {
  const styles = {
    CHECKED_IN: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
    CHECKED_OUT: { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
    NOT_CHECKED_IN: { bg: "#f4f4f5", text: "#71717a", border: "#e4e4e7" },
  };
  const current = styles[status] || styles.NOT_CHECKED_IN;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: current.bg,
        color: current.text,
        border: `1px solid ${current.border}`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: current.text,
        }}
      />
      {label || status}
    </span>
  );
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboardData, setDashboardData] = useState(null);
  const [punching, setPunching] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  // Leave Modal State for Quick Application
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

  // Quick punch handlers
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

  const latestPayslip = payslips[0];

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="Dashboard" />

      {/* Alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "#71717a", fontSize: 15 }}>Loading dashboard...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => fetchDashboard()}>
            Retry Loading Dashboard
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Welcome Banner */}
          <div
            style={{
              background: "#18181b",
              color: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              marginBottom: 28,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "#a1a1aa", marginBottom: 4 }}>
                Employee Portal
              </div>
              <h2 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 700, color: "#ffffff" }}>
                Welcome back, {employee?.preferredName || employee?.fullName || user?.name || "Colleague"}
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: "#d4d4d8" }}>
                {employee?.jobTitle || "Team Member"} • {employee?.department || "General"} • Code:{" "}
                <span style={{ fontWeight: 600, color: "#ffffff" }}>{employee?.employeeCode || "N/A"}</span>
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Link
                to="/app/profile"
                className="btn-secondary"
                style={{
                  textDecoration: "none",
                  padding: "9px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={handleOpenLeaveModal}
                style={{
                  background: "#ffffff",
                  color: "#09090b",
                  border: "1px solid #ffffff",
                  padding: "9px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Apply for Leave
              </button>
            </div>
          </div>

          {/* 4 Feature Overview Cards Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
              marginBottom: 28,
            }}
          >
            {/* Card 1: Attendance Today */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase" }}>
                    Attendance Today
                  </span>
                  <StatusBadge
                    status={todayStatus}
                    label={todayStatus === "CHECKED_IN" ? "Checked In" : todayStatus === "CHECKED_OUT" ? "Checked Out" : "Not Checked In"}
                  />
                </div>

                <div style={{ fontSize: 13, color: "#52525b", marginBottom: 16 }}>
                  {todayStatus === "CHECKED_IN" && (
                    <div>Punched in at <strong>{checkInTimeFormatted}</strong></div>
                  )}
                  {todayStatus === "CHECKED_OUT" && (
                    <div>In: <strong>{checkInTimeFormatted}</strong> • Out: <strong>{checkOutTimeFormatted}</strong></div>
                  )}
                  {todayStatus === "NOT_CHECKED_IN" && (
                    <div>You have not punched in for work today.</div>
                  )}
                </div>

                {/* Quick Punch Buttons */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={punching || todayStatus === "CHECKED_IN"}
                    onClick={() => handlePunch("check-in")}
                    style={{ flex: 1, padding: "8px 12px", fontSize: 12.5 }}
                  >
                    {punching ? "Processing..." : "Punch In"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={punching || todayStatus !== "CHECKED_IN"}
                    onClick={() => handlePunch("check-out")}
                    style={{ flex: 1, padding: "8px 12px", fontSize: 12.5 }}
                  >
                    Punch Out
                  </button>
                </div>
              </div>

              <Link
                to="/app/attendance"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#18181b",
                  textDecoration: "none",
                  borderTop: "1px solid #f4f4f5",
                  paddingTop: 12,
                }}
              >
                <span>Open Full Attendance</span>
                <IconArrowRight size={14} />
              </Link>
            </div>

            {/* Card 2: Leave Balances */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase" }}>
                    Leave Balances
                  </span>
                  {leave?.summary?.pending > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: 10 }}>
                      {leave.summary.pending} Pending
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, textAlign: "center", marginBottom: 16 }}>
                  <div style={{ background: "#f8fafc", padding: "10px 8px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Casual</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {leave?.balance?.casual ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "#f8fafc", padding: "10px 8px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Sick</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {leave?.balance?.sick ?? 0}
                    </div>
                  </div>
                  <div style={{ background: "#f8fafc", padding: "10px 8px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Earned</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                      {leave?.balance?.earned ?? 0}
                    </div>
                  </div>
                </div>
              </div>

              <Link
                to="/app/leave"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#18181b",
                  textDecoration: "none",
                  borderTop: "1px solid #f4f4f5",
                  paddingTop: 12,
                }}
              >
                <span>Manage Leave Requests</span>
                <IconArrowRight size={14} />
              </Link>
            </div>

            {/* Card 3: Latest Payslip */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase" }}>
                    Latest Payslip
                  </span>
                  {latestPayslip && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#166534", background: "#f0fdf4", padding: "2px 8px", borderRadius: 10 }}>
                      {latestPayslip.status}
                    </span>
                  )}
                </div>

                {latestPayslip ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#166534" }}>
                      ₹{Number(latestPayslip.netPay || 0).toLocaleString("en-IN")}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 4 }}>
                      Statement for {latestPayslip.month} {latestPayslip.year}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#71717a", marginBottom: 16 }}>
                    No finalized payslip records on file yet.
                  </div>
                )}
              </div>

              <Link
                to="/app/payslips"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#18181b",
                  textDecoration: "none",
                  borderTop: "1px solid #f4f4f5",
                  paddingTop: 12,
                }}
              >
                <span>View All Payslips</span>
                <IconArrowRight size={14} />
              </Link>
            </div>

            {/* Card 4: Assigned Assets */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase" }}>
                    Company Assets
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#0369a1", background: "#f0f9ff", padding: "2px 8px", borderRadius: 10 }}>
                    {assets.length} Allocated
                  </span>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#09090b" }}>
                    {assets.length} Device{assets.length === 1 ? "" : "s"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 4 }}>
                    {assets.length > 0 ? assets.map((a) => a.name).join(", ") : "No hardware allocated"}
                  </div>
                </div>
              </div>

              <Link
                to="/app/assets"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#18181b",
                  textDecoration: "none",
                  borderTop: "1px solid #f4f4f5",
                  paddingTop: 12,
                }}
              >
                <span>View Asset Details</span>
                <IconArrowRight size={14} />
              </Link>
            </div>
          </div>

          {/* Upcoming Holidays & Quick Profile Banner */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
            {/* Upcoming Holidays */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#09090b" }}>
                  Upcoming Holidays
                </h4>
                <IconCalendar size={16} style={{ color: "#71717a" }} />
              </div>

              {holidays.length === 0 ? (
                <div style={{ fontSize: 13, color: "#71717a", padding: "12px 0" }}>
                  No upcoming company holidays scheduled this quarter.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {holidays.slice(0, 3).map((h, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "#f9fafb",
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#09090b" }}>{h.name}</span>
                      <span style={{ color: "#71717a", fontSize: 12 }}>{h.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Profile & Self Service */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#09090b" }}>
                  Self-Service & Profile Details
                </h4>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "#71717a" }}>
                  Need to review your official employment contract, emergency contacts, or banking details?
                </p>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <Link
                  to="/app/profile"
                  className="btn-secondary"
                  style={{ textDecoration: "none", fontSize: 12.5, padding: "8px 14px" }}
                >
                  View Profile
                </Link>
                <Link
                  to="/app/settings"
                  className="btn-secondary"
                  style={{ textDecoration: "none", fontSize: 12.5, padding: "8px 14px" }}
                >
                  Account Settings
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {/* QUICK APPLY FOR LEAVE MODAL */}
      {showLeaveModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.55)",
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Apply for Leave
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowLeaveModal(false)}
                disabled={submittingLeave}
                aria-label="Close modal"
              >
                <IconClose size={14} />
              </button>
            </div>

            {leaveModalError && <div className="error">{leaveModalError}</div>}

            <form onSubmit={handleApplyLeave} style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                  Leave Type
                </label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #d4d4d8",
                    fontSize: 14,
                  }}
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
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
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
                          style={{
                            width: "100%",
                            padding: "9px 12px",
                            borderRadius: 8,
                            border: dateConflict ? "1.5px solid #ef4444" : "1px solid #d4d4d8",
                            fontSize: 14,
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                          End Date
                        </label>
                        <input
                          type="date"
                          required
                          min={leaveForm.startDate || leaveEligibility.earliestEligibleDate}
                          value={leaveForm.endDate}
                          onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                          style={{
                            width: "100%",
                            padding: "9px 12px",
                            borderRadius: 8,
                            border: dateConflict ? "1.5px solid #ef4444" : "1px solid #d4d4d8",
                            fontSize: 14,
                          }}
                        />
                      </div>
                    </div>

                    {dateConflict && (
                      <div
                        style={{
                          fontSize: 12.5,
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
                          Conflicts with existing <strong>{dateConflict.status}</strong> request ({dateConflict.formattedConflict}).
                        </div>
                      </div>
                    )}

                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                        Reason
                      </label>
                      <textarea
                        rows="3"
                        required
                        placeholder="Why are you taking leave?"
                        value={leaveForm.reason}
                        onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "9px 12px",
                          borderRadius: 8,
                          border: "1px solid #d4d4d8",
                          fontSize: 14,
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

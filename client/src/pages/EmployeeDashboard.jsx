import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function EmployeeDashboard({ activeSection = "overview" }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const [dashboardData, setDashboardData] = useState(null);
  const [checkingAttendance, setCheckingAttendance] = useState(false);

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

  const leaveEligibility = calculateLeaveEligibility();

  const getLeaveOverlapConflict = (startDate, endDate, scheduledRanges) => {
    if (!startDate || !endDate || !Array.isArray(scheduledRanges) || scheduledRanges.length === 0) {
      return null;
    }
    for (const item of scheduledRanges) {
      if (item.status !== "PENDING" && item.status !== "APPROVED") continue;
      const itemStart = item.startDate || item.fromDate;
      const itemEnd = item.endDate || item.toDate;
      if (!itemStart || !itemEnd) continue;

      // Overlap: requested.start <= item.end AND requested.end >= item.start
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
      return { ...prev, startDate: start, endDate: end };
    });
    setShowLeaveModal(true);
  };

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
      eventSource.onerror = () => {
        // Reconnects automatically
      };
    } catch {
      // EventSource fallback
    }

    // Visibility-aware background polling & tab focus refresh
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        fetchDashboard(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchDashboard(true);
      }
    }, 10000);

    return () => {
      if (eventSource) eventSource.close();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      clearInterval(intervalId);
    };
  }, []);

  // Check-In handler
  const handleCheckIn = async () => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      const response = await api.post("/employees/me/attendance/check-in");
      setActionSuccess(response.data?.message || "Checked in successfully!");
      await fetchDashboard();
    } catch (err) {
      setActionError(err.response?.data?.message || "Unable to check in. Please try again.");
    } finally {
      setCheckingAttendance(false);
    }
  };

  // Check-Out handler
  const handleCheckOut = async () => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      const response = await api.post("/employees/me/attendance/check-out");
      setActionSuccess(response.data?.message || "Checked out successfully!");
      await fetchDashboard();
    } catch (err) {
      setActionError(err.response?.data?.message || "Unable to check out. Please try again.");
    } finally {
      setCheckingAttendance(false);
    }
  };

  // Apply Leave handler with live cutoff validation and instant state updates
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

    // Rule 1: Past date check
    if (leaveForm.startDate < elig.todayStr || leaveForm.endDate < elig.todayStr) {
      setLeaveModalError("Leave cannot be applied for past dates.");
      return;
    }

    // Rule 3 & 4: Cutoff check for same-day requests
    if (!elig.isTodayEligible && (leaveForm.startDate === elig.todayStr || leaveForm.endDate === elig.todayStr)) {
      setLeaveModalError(
        `Same-day leave requests must be submitted at least 1 hour before office start time (${elig.officeStartTime}). The cutoff time for today was ${elig.cutoffTime} (${elig.timezone}). Earliest selectable date is tomorrow (${elig.tomorrowStr}).`
      );
      return;
    }

    if (leaveForm.startDate < elig.earliestEligibleDate) {
      setLeaveModalError(
        `Selected date is no longer eligible. Earliest selectable date is ${elig.earliestEligibleDate}.`
      );
      return;
    }

    if (leaveForm.startDate > leaveForm.endDate) {
      setLeaveModalError("Start date cannot be after end date.");
      return;
    }

    // Rule: Prevent overlapping or duplicate leave applications
    const activeRanges = dashboardData?.leave?.scheduledRanges || [];
    const conflict = getLeaveOverlapConflict(leaveForm.startDate, leaveForm.endDate, activeRanges);
    if (conflict) {
      setLeaveModalError(
        `Date conflict: You already have an existing ${conflict.status} ${conflict.leaveType} leave request (${conflict.startDate} to ${conflict.endDate}). Conflicting date(s): ${conflict.formattedConflict}. An employee cannot apply for dates already covered by an existing pending or approved leave.`
      );
      return;
    }

    try {
      setSubmittingLeave(true);
      const res = await api.post("/employees/me/leave-requests", leaveForm);
      setActionSuccess(res.data?.message || "Leave request submitted successfully!");
      setShowLeaveModal(false);

      // Instant UI update: prepend pending request and increment pending count
      const createdReq = res.data?.leaveRequest;
      if (createdReq) {
        setDashboardData((prev) => {
          if (!prev) return prev;
          const currentRequests = prev.leave?.recentRequests || [];
          return {
            ...prev,
            leave: {
              ...prev.leave,
              summary: {
                ...prev.leave?.summary,
                total: (prev.leave?.summary?.total || 0) + 1,
                pending: (prev.leave?.summary?.pending || 0) + 1,
              },
              recentRequests: [createdReq, ...currentRequests],
            },
          };
        });
      }

      setLeaveForm({ leaveType: "CASUAL", startDate: "", endDate: "", reason: "" });
      await fetchDashboard(true);
    } catch (err) {
      setLeaveModalError(err.response?.data?.message || "Failed to submit leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  // Payslip download handler
  const handleDownloadPayslip = async (payslipId) => {
    try {
      setActionError("");
      const response = await api.get(`/employees/me/payslips/${payslipId}/download`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payslip_${payslipId}.txt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setActionSuccess(`Payslip ${payslipId} downloaded successfully.`);
    } catch (err) {
      setActionError("Unable to download payslip. Please try again later.");
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

  const currentTab = activeSection;

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      {/* App Header */}
      <AppHeader
        title="Employee Portal"
        subtitle="Self-Service Portal • Workflows, Attendance, Leave & Documents"
      />

      {/* Action alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")}>
            ✕
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")}>
            ✕
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "#71717a", fontSize: 15 }}>Loading your employee dashboard...</p>
        </div>
      )}

      {/* Global Error State */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={fetchDashboard}>
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
              <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#a1a1aa", marginBottom: 4 }}>
                Employee Self-Service
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                My Profile
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
                }}
              >
                + Apply for Leave
              </button>
            </div>
          </div>

          {/* Section Navigation Tabs */}
          <div
            style={{
              display: "flex",
              gap: 8,
              borderBottom: "1px solid #e4e4e7",
              marginBottom: 24,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {[
              { id: "overview", label: "Dashboard Overview", path: "/app" },
              { id: "attendance", label: "My Attendance", path: "/app/attendance" },
              { id: "leave", label: "My Leave", path: "/app/leave" },
              { id: "payslips", label: "My Payslips", path: "/app/payslips" },
              { id: "assets", label: "My Assets", path: "/app/assets" },
            ].map((tab) => {
              const active = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigate(tab.path)}
                  style={{
                    background: active ? "#18181b" : "transparent",
                    color: active ? "#ffffff" : "#71717a",
                    border: active ? "1px solid #18181b" : "1px solid transparent",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 13.5,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ATTENDANCE & PUNCH STATUS QUICK CARD */}
          {(currentTab === "overview" || currentTab === "attendance") && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "22px 24px",
                marginBottom: 24,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                    Today's Attendance & Time Tracker
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                    Date: {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  </p>
                </div>

                {/* Status Badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      padding: "5px 12px",
                      borderRadius: 20,
                      fontSize: 12.5,
                      fontWeight: 600,
                      background:
                        todayStatus === "CHECKED_IN"
                          ? "#f0fdf4"
                          : todayStatus === "CHECKED_OUT"
                          ? "#f4f4f5"
                          : "#fef3c7",
                      color:
                        todayStatus === "CHECKED_IN"
                          ? "#15803d"
                          : todayStatus === "CHECKED_OUT"
                          ? "#3f3f46"
                          : "#b45309",
                      border: "1px solid #e4e4e7",
                    }}
                  >
                    ● {todayStatus === "CHECKED_IN" ? "Checked In (Active)" : todayStatus === "CHECKED_OUT" ? "Checked Out for Day" : "Not Checked In Yet"}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 16,
                  padding: "16px 20px",
                  background: "#f9fafb",
                  borderRadius: 10,
                  marginBottom: 18,
                  border: "1px solid #f3f4f6",
                }}
              >
                <div>
                  <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Check-In Time</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                    {checkInTimeFormatted || "--:--"}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Check-Out Time</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                    {checkOutTimeFormatted || "--:--"}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Hours Today</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                    {attendance?.today?.workingHours || "--"}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Monthly Attendance</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                    {attendance?.summary?.daysPresent || 0} / {attendance?.summary?.totalWorkingDays || 22} Days ({attendance?.summary?.attendanceRate || 0}%)
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {todayStatus === "NOT_CHECKED_IN" && (
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={checkingAttendance}
                    style={{ background: "#18181b", color: "#ffffff", padding: "10px 20px" }}
                  >
                    {checkingAttendance ? "Recording..." : "Punch In / Check In"}
                  </button>
                )}

                {todayStatus === "CHECKED_IN" && (
                  <button
                    type="button"
                    onClick={handleCheckOut}
                    disabled={checkingAttendance}
                    style={{ background: "#09090b", color: "#ffffff", padding: "10px 20px" }}
                  >
                    {checkingAttendance ? "Recording..." : "Punch Out / Check Out"}
                  </button>
                )}

                {todayStatus === "CHECKED_OUT" && (
                  <div style={{ fontSize: 13, color: "#71717a", display: "flex", alignItems: "center", gap: 6 }}>
                    ✓ Attendance completed for today. Have a great evening!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LEAVE BALANCE CARDS */}
          {(currentTab === "overview" || currentTab === "leave") && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                    Leave Balances & Allowances
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                    Annual entitlement allocated according to company leave policies.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={handleOpenLeaveModal}
                >
                  + Apply for Leave
                </button>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">Casual Leave</span>
                  <div className="stat-value">{leave?.balance?.casual ?? 0} <span style={{ fontSize: 14, fontWeight: 400, color: "#71717a" }}>days available</span></div>
                  <span style={{ fontSize: 12, color: "#71717a" }}>For short planned leaves & personal matters</span>
                </div>

                <div className="stat-card">
                  <span className="stat-label">Sick Leave</span>
                  <div className="stat-value">{leave?.balance?.sick ?? 0} <span style={{ fontSize: 14, fontWeight: 400, color: "#71717a" }}>days available</span></div>
                  <span style={{ fontSize: 12, color: "#71717a" }}>For health, wellness, and medical recuperation</span>
                </div>

                <div className="stat-card">
                  <span className="stat-label">Earned / Privilege Leave</span>
                  <div className="stat-value">{leave?.balance?.earned ?? 0} <span style={{ fontSize: 14, fontWeight: 400, color: "#71717a" }}>days available</span></div>
                  <span style={{ fontSize: 12, color: "#71717a" }}>Accrued vacation time</span>
                </div>

                <div className="stat-card highlight">
                  <span className="stat-label">Requests Status</span>
                  <div className="stat-value" style={{ fontSize: 19, display: "flex", gap: 10, marginTop: 4 }}>
                    <span style={{ color: "#b45309" }}>{leave?.summary?.pending ?? 0} Pending</span>
                    <span style={{ color: "#15803d" }}>{leave?.summary?.approved ?? 0} Approved</span>
                  </div>
                  <span style={{ fontSize: 12, color: "#71717a" }}>Total submitted: {leave?.summary?.total ?? 0}</span>
                </div>
              </div>
            </div>
          )}

          {/* TWO COLUMN GRID: LEAVE REQUESTS & UPCOMING HOLIDAYS */}
          {(currentTab === "overview" || currentTab === "leave") && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24, marginBottom: 28 }}>
              {/* My Leave Requests Table */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e4e4e7",
                  borderRadius: 14,
                  padding: "20px 22px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#09090b" }}>
                    My Recent Leave Requests
                  </h4>
                  <span style={{ fontSize: 12, color: "#71717a" }}>
                    {leave?.recentRequests?.length || 0} recent
                  </span>
                </div>

                {(!leave?.recentRequests || leave.recentRequests.length === 0) ? (
                  <div style={{ padding: "28px 16px", textAlign: "center", color: "#71717a", fontSize: 13 }}>
                    No leave requests on record. Use the "Apply for Leave" button to submit one.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                          <th style={{ padding: "8px 6px" }}>Type</th>
                          <th style={{ padding: "8px 6px" }}>Period</th>
                          <th style={{ padding: "8px 6px" }}>Days</th>
                          <th style={{ padding: "8px 6px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leave.recentRequests.map((req, idx) => (
                          <tr key={req.id || idx} style={{ borderBottom: "1px solid #f4f4f5" }}>
                            <td style={{ padding: "10px 6px", fontWeight: 600 }}>{req.leaveType}</td>
                            <td style={{ padding: "10px 6px", color: "#52525b" }}>
                              {req.startDate} to {req.endDate}
                            </td>
                            <td style={{ padding: "10px 6px" }}>{req.days}d</td>
                            <td style={{ padding: "10px 6px" }}>
                              <span
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: 12,
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  background:
                                    req.status === "APPROVED"
                                      ? "#f0fdf4"
                                      : req.status === "REJECTED"
                                      ? "#fef2f2"
                                      : "#fef3c7",
                                  color:
                                    req.status === "APPROVED"
                                      ? "#15803d"
                                      : req.status === "REJECTED"
                                      ? "#b91c1c"
                                      : "#b45309",
                                }}
                              >
                                {req.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Upcoming Company Holidays */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e4e4e7",
                  borderRadius: 14,
                  padding: "20px 22px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#09090b" }}>
                    Upcoming Company Holidays
                  </h4>
                  <span style={{ fontSize: 12, color: "#71717a" }}>Official HR Policy Calendar</span>
                </div>

                {holidays.length === 0 ? (
                  <div style={{ padding: "28px 16px", textAlign: "center", color: "#71717a", fontSize: 13 }}>
                    No upcoming holidays scheduled for the rest of this quarter.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {holidays.map((h, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 14px",
                          borderRadius: 8,
                          background: "#f9fafb",
                          border: "1px solid #f3f4f6",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: "#09090b" }}>{h.name}</div>
                          <div style={{ fontSize: 12, color: "#71717a" }}>{h.type} • {h.day}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#18181b" }}>
                          {h.date}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RECENT ATTENDANCE HISTORY TABLE */}
          {(currentTab === "overview" || currentTab === "attendance") && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
                marginBottom: 28,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h4 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                    Recent Personal Attendance Records
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                    Your recorded punch-in and punch-out history.
                  </p>
                </div>
              </div>

              {(!attendance?.recentRecords || attendance.recentRecords.length === 0) ? (
                <div style={{ padding: "36px 16px", textAlign: "center", color: "#71717a", fontSize: 13 }}>
                  No attendance history logged yet. Today's punches will appear here once recorded.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                        <th style={{ padding: "10px 12px" }}>Date</th>
                        <th style={{ padding: "10px 12px" }}>Check In</th>
                        <th style={{ padding: "10px 12px" }}>Check Out</th>
                        <th style={{ padding: "10px 12px" }}>Duration</th>
                        <th style={{ padding: "10px 12px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.recentRecords.map((rec, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f4f4f5" }}>
                          <td style={{ padding: "12px", fontWeight: 600, color: "#09090b" }}>{rec.date}</td>
                          <td style={{ padding: "12px", color: "#52525b" }}>
                            {rec.checkIn ? new Date(rec.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                          </td>
                          <td style={{ padding: "12px", color: "#52525b" }}>
                            {rec.checkOut ? new Date(rec.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
                          </td>
                          <td style={{ padding: "12px", fontWeight: 500 }}>{rec.workingHours || "--"}</td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                padding: "4px 9px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                background: "#f0fdf4",
                                color: "#15803d",
                              }}
                            >
                              {rec.status || "PRESENT"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* PERSONAL PAYSLIPS SECTION */}
          {(currentTab === "overview" || currentTab === "payslips") && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
                marginBottom: 28,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h4 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                    My Authorized Payslips
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                    Only salary statements generated by payroll for your verified employee code are shown here.
                  </p>
                </div>
              </div>

              {payslips.length === 0 ? (
                <div style={{ padding: "36px 16px", textAlign: "center", color: "#71717a", fontSize: 13.5 }}>
                  <div style={{ marginBottom: 6, fontWeight: 600, color: "#18181b" }}>No payslips generated yet</div>
                  Your official payslips will be available for download here following monthly payroll disbursement.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                        <th style={{ padding: "10px 12px" }}>Statement Period</th>
                        <th style={{ padding: "10px 12px" }}>Gross Earnings</th>
                        <th style={{ padding: "10px 12px" }}>Deductions</th>
                        <th style={{ padding: "10px 12px" }}>Net Pay</th>
                        <th style={{ padding: "10px 12px" }}>Status</th>
                        <th style={{ padding: "10px 12px", textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((ps) => (
                        <tr key={ps.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                          <td style={{ padding: "12px", fontWeight: 600, color: "#09090b" }}>
                            {ps.month} {ps.year}
                            <div style={{ fontSize: 11.5, color: "#71717a", fontWeight: 400 }}>{ps.period}</div>
                          </td>
                          <td style={{ padding: "12px" }}>₹{ps.grossSalary?.toLocaleString("en-IN")}</td>
                          <td style={{ padding: "12px", color: "#b91c1c" }}>-₹{ps.deductions?.toLocaleString("en-IN")}</td>
                          <td style={{ padding: "12px", fontWeight: 700, color: "#09090b" }}>
                            ₹{ps.netPay?.toLocaleString("en-IN")}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                padding: "4px 8px",
                                borderRadius: 12,
                                fontSize: 11.5,
                                fontWeight: 600,
                                background: "#f0fdf4",
                                color: "#15803d",
                              }}
                            >
                              {ps.status}
                            </span>
                          </td>
                          <td style={{ padding: "12px", textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn-sm btn-secondary"
                              onClick={() => handleDownloadPayslip(ps.id)}
                            >
                              Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ASSIGNED COMPANY ASSETS SECTION */}
          {(currentTab === "overview" || currentTab === "assets") && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "20px 24px",
                marginBottom: 28,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <h4 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                    Assigned Company Assets
                  </h4>
                  <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                    Hardware and resources officially allocated to you by IT & Operations.
                  </p>
                </div>
              </div>

              {assets.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center", color: "#71717a", fontSize: 13 }}>
                  No physical assets are currently recorded under your inventory account.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                  {assets.map((asset, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "14px 16px",
                        background: "#f9fafb",
                        border: "1px solid #e4e4e7",
                        borderRadius: 10,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#09090b" }}>{asset.name}</div>
                      <div style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>
                        Serial / Asset ID: <span style={{ fontFamily: "monospace", color: "#09090b" }}>{asset.serial || "N/A"}</span>
                      </div>
                      {asset.assignedDate && (
                        <div style={{ fontSize: 12, color: "#71717a", marginTop: 2 }}>
                          Assigned on: {asset.assignedDate}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PROFILE SHORTCUT BANNER */}
          <div
            style={{
              background: "#f4f4f5",
              border: "1px solid #e4e4e7",
              borderRadius: 12,
              padding: "18px 22px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#09090b" }}>
                Need to update your emergency contact, banking details, or upload documents?
              </div>
              <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 2 }}>
                Self-service changes are audited and immediately stored to your employee profile.
              </div>
            </div>
            <Link
              to="/app/settings"
              className="btn-secondary"
              style={{
                textDecoration: "none",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Go to Account Settings →
            </Link>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Apply for Leave
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowLeaveModal(false)}
                disabled={submittingLeave}
              >
                ✕
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
                  <option value="CASUAL">Casual Leave ({leave?.balance?.casual ?? 0} available)</option>
                  <option value="SICK">Sick Leave ({leave?.balance?.sick ?? 0} available)</option>
                  <option value="EARNED">Earned Leave ({leave?.balance?.earned ?? 0} available)</option>
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
                          id="input-leave-start-date"
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
                          id="input-leave-end-date"
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

                    {/* CONFLICT ALERT BANNER */}
                    {dateConflict && (
                      <div
                        id="leave-conflict-banner"
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
                          <span>🚫 Overlapping Leave Date Conflict</span>
                        </div>
                        <div>
                          The selected dates overlap with an existing <strong>{dateConflict.status}</strong>{" "}
                          ({dateConflict.leaveType} leave from {dateConflict.startDate} to {dateConflict.endDate}).
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "#7f1d1d" }}>
                          Conflicting date(s): <strong>{dateConflict.formattedConflict}</strong>. Dates covered by a PENDING or APPROVED request cannot be re-applied for.
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
                        <span>⚠️ Configuration Error: {leaveEligibility.configError}. Please contact HR.</span>
                      ) : leaveEligibility.isTodayEligible ? (
                        <span>
                          ℹ️ <strong>Same-day leave available:</strong> Today ({leaveEligibility.todayStr}) is eligible until <strong>{leaveEligibility.cutoffTime}</strong> ({leaveEligibility.timezone}), exactly 1 hour before office starts ({leaveEligibility.officeStartTime}).
                        </span>
                      ) : (
                        <span>
                          ⏱️ <strong>Same-day cutoff passed:</strong> Cutoff was {leaveEligibility.cutoffTime} ({leaveEligibility.timezone}). Earliest selectable date is tomorrow (<strong>{leaveEligibility.tomorrowStr}</strong>).
                        </span>
                      )}
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                        Reason for Leave
                      </label>
                      <textarea
                        rows="3"
                        required
                        placeholder="Please state the purpose of your leave request..."
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
                        id="btn-submit-leave-app"
                        disabled={submittingLeave || Boolean(dateConflict)}
                        style={
                          dateConflict
                            ? { opacity: 0.6, cursor: "not-allowed", background: "#9ca3af", borderColor: "#9ca3af" }
                            : {}
                        }
                      >
                        {submittingLeave
                          ? "Submitting..."
                          : dateConflict
                          ? "Dates Unavailable (Conflict)"
                          : "Submit Leave Application"}
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

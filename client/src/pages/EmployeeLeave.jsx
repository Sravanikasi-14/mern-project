import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import StatusBadge from "../components/StatusBadge";
import SoftRefresh from "../components/SoftRefresh";
import {
  IconClose,
  IconCalendar,
} from "../components/EmployeeIcon";
import { TableSkeletonRows } from "../components/TableSkeleton";
import Pagination from "../components/Pagination";
import api from "../services/api";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/AuthContext";
import { useDashboardQuery } from "../hooks/useEmployeeQueries";
import { invalidateLeave } from "../lib/queryKeys";
import MonthCalendar from "../components/MonthCalendar";
import {
  formatDisplayDate,
  getCompanyBusinessDate,
  parseCivilDate,
  resolveCompanyTimezone,
} from "../utils/dateUtils";
import "./LeaveManagement.css";
import MobileExpandable from "../components/mobile/MobileExpandable";

const STATUS_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

export default function EmployeeLeave() {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const timeZone = resolveCompanyTimezone(company);
  const todayParts = parseCivilDate(getCompanyBusinessDate(new Date(), timeZone));
  const [calMonth, setCalMonth] = useState(() => ({
    year: todayParts.year,
    month: todayParts.month,
  }));
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const dashboardQuery = useDashboardQuery();
  const dashboardData = dashboardQuery.data ?? null;
  const loading = dashboardQuery.isLoading && !dashboardData;
  const error = dashboardQuery.error?.response?.data?.message ||
    (dashboardQuery.error && !dashboardData ? "Failed to load leave records." : "");

  const [reqStatusFilter, setReqStatusFilter] = useState("ALL");
  const [appPage, setAppPage] = useState(1);
  const [appPageSize, setAppPageSize] = useState(5);

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
      const today = getCompanyBusinessDate(new Date(), tz);
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

  useEffect(() => {
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
            queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] });
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [queryClient]);

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

    if (!leaveForm.reason.trim()) {
      setLeaveModalError("Please provide a brief reason for your leave request.");
      return;
    }

    setSubmittingLeave(true);
    try {
      const res = await api.post("/employees/me/leave-requests", {
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason.trim(),
      });

      setActionSuccess(res.data?.message || "Leave application submitted successfully!");
      setShowLeaveModal(false);
      setLeaveForm({ leaveType: "CASUAL", startDate: "", endDate: "", reason: "" });
      await invalidateLeave(queryClient);
      setTimeout(() => setActionSuccess(""), 4500);
    } catch (err) {
      setLeaveModalError(err.response?.data?.message || "Failed to submit leave request.");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const formatDate = (dateString) => formatDisplayDate(dateString, timeZone);

  const employeeName = dashboardData?.employee?.fullName || "Employee";
  const firstName = employeeName.split(" ")[0];
  const leave = dashboardData?.leave;
  const detailedBalances = leave?.detailed || [];
  const recentRequests = leave?.recentRequests || [];
  const scheduledUpcoming = (leave?.scheduledRanges || []).filter((r) => r.status === "APPROVED" || r.status === "PENDING");
  const holidays = dashboardData?.holidays || dashboardData?.companyHolidays || [];

  // Summary counts
  const totalAvailable = detailedBalances.reduce((sum, b) => sum + (b.available || 0), 0) || (leave?.summary?.remaining ?? 20);
  const totalUsed = detailedBalances.reduce((sum, b) => sum + (b.used || 0), 0) || (leave?.summary?.used ?? 3);
  const pendingCount = recentRequests.filter((r) => r.status === "PENDING").length;
  const rejectedCount = recentRequests.filter((r) => r.status === "REJECTED").length;

  // Filtered requests
  const filteredRequests = useMemo(() => {
    if (reqStatusFilter === "ALL") return recentRequests;
    return recentRequests.filter((r) => r.status === reqStatusFilter);
  }, [recentRequests, reqStatusFilter]);

  useEffect(() => {
    setAppPage(1);
  }, [reqStatusFilter]);

  const totalAppRequests = filteredRequests.length;
  const totalAppPages = Math.ceil((totalAppRequests || 1) / appPageSize);
  const paginatedRequests = useMemo(() => {
    const start = (appPage - 1) * appPageSize;
    return filteredRequests.slice(start, start + appPageSize);
  }, [filteredRequests, appPage, appPageSize]);

  return (
    <div className="lm-container">
      <AppHeader
        title={<><span className="m-title-full">Leave</span><span className="m-title-short">Time off</span></>}
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <SoftRefresh active={dashboardQuery.isFetching && !!dashboardData} />
            <button
              type="button"
              className="btn-primary"
              onClick={handleOpenLeaveModal}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, fontSize: 13 }}
            >
              <span>+</span>
              <span className="m-title-full">Apply Leave</span>
              <span className="m-title-short">Apply for leave</span>
            </button>
          </div>
        }
      />

      {/* Alerts */}
      {actionSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{actionSuccess}</div>}
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Compact Inline Personal Leave Statistics Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 8,
          padding: "8px 16px",
          marginBottom: 14,
          fontSize: 13,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Available Balance: <strong style={{ color: "var(--g-800, #155a37)" }}>{totalAvailable} days</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Used: <strong style={{ color: "var(--ink)" }}>{totalUsed} days</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Pending: <strong style={{ color: pendingCount > 0 ? "#b06d0a" : "var(--ink)" }}>{pendingCount}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Rejected: <strong style={{ color: rejectedCount > 0 ? "#b91c1c" : "var(--ink)" }}>{rejectedCount}</strong>
        </span>
      </div>

      <MobileExpandable title="Calendar">
      <section className="lm-calendar-section" aria-label="My leave schedule">
        <MonthCalendar
          year={calMonth.year}
          month={calMonth.month}
          timeZone={timeZone}
          events={(scheduledUpcoming || []).map((item) => ({
            id: item.id,
            startDate: item.startDate,
            endDate: item.endDate,
            fromDate: item.startDate,
            toDate: item.endDate,
            leaveTypeCode: item.leaveType,
            status: item.status,
            label: item.status === "PENDING" ? "Pending" : "Approved",
          }))}
          heading="My Leave Schedule"
          onMonthChange={setCalMonth}
          emptyMessage="No leave scheduled this month."
        />
        <div className="lm-side-card">
          <div className="lm-side-title-row">
            <h3 className="lm-side-title">Upcoming Absences</h3>
          </div>
          <div className="lm-team-leave-list">
            {scheduledUpcoming.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0" }}>
                You have no upcoming leave requests.
              </p>
            ) : (
              scheduledUpcoming.slice(0, 6).map((item) => (
                <div key={item.id} className="lm-team-leave-row">
                  <div className="lm-team-leave-left">
                    <div>
                      <div className="lm-team-leave-name">{item.leaveType || "Leave"}</div>
                      <div className="lm-team-leave-dates">
                        {formatDate(item.startDate)} – {formatDate(item.endDate)}
                      </div>
                    </div>
                  </div>
                  <span className={`lm-req-type-pill ${(item.leaveType || "casual").toLowerCase()}`}>
                    {item.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      </MobileExpandable>

      {/* -----------------------------------------------------------------------
          MAIN SPLIT GRID (Reference 2 Layout)
          ----------------------------------------------------------------------- */}
      <div className="el-main-grid">
        {/* LEFT COLUMN: Leave Balance Overview & My Requests */}
        <div>
          {/* Card A: Leave Balance Overview (Reference 2 Table) */}
          <div className="el-card">
            <div className="el-card-head">
              <div>
                <h3 className="el-card-title">Leave Balances</h3>
              </div>
              <span className="text-nav-badge" style={{ fontSize: 12, padding: "4px 10px" }}>
                2026 Cycle
              </span>
            </div>

            {loading && detailedBalances.length === 0 ? (
              <div style={{ padding: "30px 0", textAlign: "center" }}>
                <div className="profile-spinner" style={{ margin: "0 auto 10px" }} />
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading balances...</p>
              </div>
            ) : detailedBalances.length === 0 ? (
              /* Fallback rows if detailed is empty */
              <table className="el-balance-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Allocation</th>
                    <th>Used</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="el-type-row">
                        <div className="el-type-icon">CL</div>
                        <span>Casual Leave</span>
                      </div>
                    </td>
                    <td>12 days</td>
                    <td>{12 - (leave?.balance?.casual ?? 12)} days</td>
                    <td><strong>{leave?.balance?.casual ?? 0} days</strong></td>
                  </tr>
                  <tr>
                    <td>
                      <div className="el-type-row">
                        <div className="el-type-icon">SL</div>
                        <span>Sick Leave</span>
                      </div>
                    </td>
                    <td>8 days</td>
                    <td>{8 - (leave?.balance?.sick ?? 8)} days</td>
                    <td><strong>{leave?.balance?.sick ?? 0} days</strong></td>
                  </tr>
                  <tr>
                    <td>
                      <div className="el-type-row">
                        <div className="el-type-icon">EL</div>
                        <span>Earned Leave</span>
                      </div>
                    </td>
                    <td>15 days</td>
                    <td>{15 - (leave?.balance?.earned ?? 15)} days</td>
                    <td><strong>{leave?.balance?.earned ?? 0} days</strong></td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="el-balance-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Allocation</th>
                    <th>Used</th>
                    <th>Applied</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedBalances.map((type) => (
                    <tr key={type.code}>
                      <td>
                        <div className="el-type-row">
                          <div className="el-type-icon">
                            {type.code?.slice(0, 2) || "LV"}
                          </div>
                          <span>{type.name || type.code}</span>
                        </div>
                      </td>
                      <td>{type.totalAllowed != null ? `${type.totalAllowed} days` : "—"}</td>
                      <td>{type.used || 0} days</td>
                      <td>{type.applied || 0} days</td>
                      <td>
                        <strong style={{ color: "var(--g-800)" }}>
                          {type.available ?? 0} days
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Card B: My Leave Requests (Reference 2 Recent Applications) */}
          <div className="el-card">
            <div className="el-card-head" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 className="el-card-title">Leave Requests</h3>
              </div>

              {/* Text-based Filter Links (Requirement 4) */}
              <div className="text-filter-group">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`text-filter-link ${reqStatusFilter === f.value ? "active" : ""}`}
                    onClick={() => setReqStatusFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="el-balance-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Days</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "36px 0", color: "var(--muted)" }}>
                        No {reqStatusFilter !== "ALL" ? reqStatusFilter.toLowerCase() : ""} leave requests found.
                      </td>
                    </tr>
                  ) : (
                    paginatedRequests.map((req) => (
                      <tr key={req._id || req.id}>
                        <td>
                          <strong>{formatDate(req.startDate)}</strong>
                          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            to {formatDate(req.endDate)}
                          </div>
                        </td>
                        <td><strong>{req.calculatedDays || req.durationDays || 1}d</strong></td>
                        <td>
                          <span className={`lm-req-type-pill ${(req.leaveTypeCode || "CASUAL").toLowerCase()}`}>
                            {req.leaveTypeCode || "CASUAL"}
                          </span>
                        </td>
                        <td><StatusBadge status={req.status} /></td>
                        <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={req.reason}>
                          {req.reason || "—"}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>{formatDate(req.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalAppRequests > 0 && (
              <Pagination
                currentPage={appPage}
                totalPages={totalAppPages}
                totalItems={totalAppRequests}
                pageSize={appPageSize}
                pageSizeOptions={[5, 10, 20]}
                onPageChange={(p) => setAppPage(p)}
                onPageSizeChange={(s) => {
                  setAppPageSize(s);
                  setAppPage(1);
                }}
                itemLabel="applications"
                compact={true}
              />
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Upcoming Leaves & Official Holidays */}
        <div>
          {/* Card C: Upcoming Leaves (Reference 2 Scheduled Time Off) */}
          <div className="el-card">
            <div className="el-card-head">
              <div>
                <h3 className="el-card-title">Upcoming Leaves</h3>
              </div>
              <span className="text-nav-badge">
                {scheduledUpcoming.length}
              </span>
            </div>

            <div className="el-upcoming-list">
              {scheduledUpcoming.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0" }}>
                  No upcoming leaves scheduled.
                </p>
              ) : (
                scheduledUpcoming.map((item, idx) => {
                  const s = item.startDate || item.fromDate;
                  const e = item.endDate || item.toDate;
                  const isAppr = item.status === "APPROVED";
                  return (
                    <div key={idx} className="el-upcoming-card">
                      <div className="el-upcoming-card-top">
                        <span className="el-upcoming-type">
                          <IconCalendar size={14} />
                          <span>{item.leaveType || item.leaveTypeCode || "Leave"}</span>
                        </span>
                        <StatusBadge status={item.status} />
                      </div>

                      <div className="el-upcoming-dates">
                        {formatDate(s)} {s !== e && `— ${formatDate(e)}`}
                      </div>

                      <div className="el-upcoming-duration">
                        {item.days || item.calculatedDays || 1} Day(s) {isAppr ? "· Scheduled" : "· Pending"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Card D: Upcoming Official Holidays */}
          {holidays.length > 0 && (
            <div className="el-card">
              <div className="el-card-head">
                <div>
                  <h3 className="el-card-title">Company Holidays</h3>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {holidays.slice(0, 4).map((h, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--hair)",
                      background: "var(--panel)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{h.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{h.day} · {h.date}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--g-800)", background: "var(--g-100)", padding: "2px 6px", borderRadius: 4 }}>
                      {h.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* -----------------------------------------------------------------------
          APPLY FOR LEAVE MODAL
          ----------------------------------------------------------------------- */}
      {showLeaveModal && (
        <div className="modal-overlay" onClick={() => setShowLeaveModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Apply for Leave</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowLeaveModal(false)}
                aria-label="Close"
              >
                <IconClose size={14} />
              </button>
            </div>

            {leaveModalError && <div className="error" style={{ marginBottom: 16 }}>{leaveModalError}</div>}

            <form onSubmit={handleApplyLeave} className="auth-form" noValidate>
              <div style={{ marginBottom: 14 }}>
                <label>
                  Leave Type *
                  <select
                    value={leaveForm.leaveType}
                    onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                    className="filter-select"
                    style={{ width: "100%", marginTop: 4 }}
                  >
                    {detailedBalances.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name || t.code} ({t.available ?? 0} days remaining)
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <label>
                  Start Date *
                  <input
                    type="date"
                    required
                    value={leaveForm.startDate}
                    min={leaveEligibility.earliestEligibleDate}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setLeaveForm((prev) => ({
                        ...prev,
                        startDate: newStart,
                        endDate: prev.endDate && prev.endDate >= newStart ? prev.endDate : newStart,
                      }));
                    }}
                    style={{ marginTop: 4 }}
                  />
                </label>
                <label>
                  End Date *
                  <input
                    type="date"
                    required
                    value={leaveForm.endDate}
                    min={leaveForm.startDate || leaveEligibility.earliestEligibleDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label>
                  Reason for Leave *
                  <textarea
                    rows={3}
                    required
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                    placeholder="Briefly state reason for your absence..."
                    style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px solid var(--hair)", boxSizing: "border-box", marginTop: 4 }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowLeaveModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingLeave}
                  className="btn-primary"
                >
                  {submittingLeave ? "Submitting..." : "Submit Application"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

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
import DateRangePicker from "../components/DateRangePicker";
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
  const scheduledUpcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (leave?.scheduledRanges || [])
      .filter((r) => r.status === "APPROVED" || r.status === "PENDING")
      .filter((r) => {
        const end = new Date(r.endDate || r.toDate || r.startDate || r.fromDate);
        if (Number.isNaN(end.getTime())) return true;
        end.setHours(0, 0, 0, 0);
        return end >= today;
      })
      .sort((a, b) => {
        const aStart = new Date(a.startDate || a.fromDate || 0).getTime();
        const bStart = new Date(b.startDate || b.fromDate || 0).getTime();
        return aStart - bStart;
      });
  }, [leave?.scheduledRanges]);
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
    <div className="lm-container el-page">
      <AppHeader
        title={<><span className="m-title-full">Leave</span><span className="m-title-short">Time off</span></>}
        actions={<SoftRefresh active={dashboardQuery.isFetching && !!dashboardData} />}
      />

      {/* Alerts */}
      {actionSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{actionSuccess}</div>}
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      <section className="el-summary-bar" aria-label="Leave summary">
        <div className="el-summary-metrics">
          <div className="el-summary-metric is-available">
            <span className="el-summary-lbl">Available</span>
            <strong>{totalAvailable}<span> days</span></strong>
          </div>
          <div className="el-summary-metric">
            <span className="el-summary-lbl">Used</span>
            <strong>{totalUsed}<span> days</span></strong>
          </div>
          <div className={`el-summary-metric${pendingCount > 0 ? " is-pending" : ""}`}>
            <span className="el-summary-lbl">Pending</span>
            <strong>{pendingCount}</strong>
          </div>
          <div className={`el-summary-metric${rejectedCount > 0 ? " is-rejected" : ""}`}>
            <span className="el-summary-lbl">Rejected</span>
            <strong>{rejectedCount}</strong>
          </div>
        </div>
        <button type="button" className="btn-primary el-summary-apply" onClick={handleOpenLeaveModal}>
          + Apply Leave
        </button>
      </section>

      <MobileExpandable title="Calendar">
        <div className="el-calendar-primary">
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
          </section>
        </div>
      </MobileExpandable>

      {/*
        Two independently flowing flex columns (not CSS multi-column — browsers
        were packing Upcoming under Balances and leaving a blank under Holidays).
        Left: Balances. Right: Upcoming Absences then Company Holidays.
      */}
      <div className="el-support-cols">
        <div className="el-support-col">
          <div className="el-card el-card--balances">
            <div className="el-card-head">
              <div>
                <h3 className="el-card-title">Leave Balances</h3>
                <p className="el-card-sub">Compare remaining entitlement by type</p>
              </div>
              <span className="text-nav-badge" style={{ fontSize: 12, padding: "4px 10px" }}>
                2026 Cycle
              </span>
            </div>

            {loading && detailedBalances.length === 0 ? (
              <p className="el-upcoming-empty">Loading balances…</p>
            ) : (
              <div className="el-balance-compare">
                {(detailedBalances.length > 0
                  ? detailedBalances
                  : [
                      {
                        code: "CASUAL",
                        name: "Casual Leave",
                        totalAllowed: 12,
                        used: 12 - (leave?.balance?.casual ?? 12),
                        applied: 0,
                        available: leave?.balance?.casual ?? 0,
                      },
                      {
                        code: "SICK",
                        name: "Sick Leave",
                        totalAllowed: 8,
                        used: 8 - (leave?.balance?.sick ?? 8),
                        applied: 0,
                        available: leave?.balance?.sick ?? 0,
                      },
                      {
                        code: "EARNED",
                        name: "Earned Leave",
                        totalAllowed: 15,
                        used: 15 - (leave?.balance?.earned ?? 15),
                        applied: 0,
                        available: leave?.balance?.earned ?? 0,
                      },
                    ]
                ).map((type) => {
                  const total = Number(type.totalAllowed) || 0;
                  const remaining = Number(type.available) || 0;
                  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
                  return (
                    <div key={type.code} className="el-balance-item">
                      <div className="el-balance-item-top">
                        <div className="el-type-row">
                          <div className="el-type-icon">{type.code?.slice(0, 2) || "LV"}</div>
                          <span>{type.name || type.code}</span>
                        </div>
                        <strong className="el-balance-remaining">{remaining} left</strong>
                      </div>
                      <div
                        className="el-balance-track"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${type.name || type.code} remaining`}
                      >
                        <span className="el-balance-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="el-balance-meta">
                        <span>Allocated {total || "—"}</span>
                        <span>Used {type.used || 0}</span>
                        {type.applied != null ? <span>Applied {type.applied || 0}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="el-support-col">
          <div className="el-card">
            <div className="el-card-head">
              <div>
                <h3 className="el-card-title">Upcoming Absences</h3>
                <p className="el-card-sub">Approved and pending time off</p>
              </div>
              <span className="text-nav-badge">{scheduledUpcoming.length}</span>
            </div>

            <div className="el-upcoming-list">
              {scheduledUpcoming.length === 0 ? (
                <p className="el-upcoming-empty">No upcoming leave scheduled.</p>
              ) : (
                scheduledUpcoming.map((item, idx) => {
                  const s = item.startDate || item.fromDate;
                  const e = item.endDate || item.toDate;
                  const isAppr = item.status === "APPROVED";
                  const dayCount =
                    item.daysCount ??
                    item.days ??
                    item.calculatedDays ??
                    (s && e
                      ? Math.max(
                          1,
                          Math.round(
                            (new Date(e).setHours(0, 0, 0, 0) - new Date(s).setHours(0, 0, 0, 0)) /
                              86400000
                          ) + 1
                        )
                      : null);
                  return (
                    <div key={item.id || idx} className="el-upcoming-row">
                      <div className="el-upcoming-row-main">
                        <span className="el-upcoming-type">
                          <IconCalendar size={14} />
                          <span>{item.leaveType || item.leaveTypeCode || "Leave"}</span>
                        </span>
                        <span className="el-upcoming-dates">
                          {formatDate(s)}
                          {s && e && String(s).slice(0, 10) !== String(e).slice(0, 10)
                            ? ` – ${formatDate(e)}`
                            : ""}
                        </span>
                      </div>
                      <div className="el-upcoming-row-meta">
                        <span className="el-upcoming-duration">
                          {dayCount != null ? `${dayCount} day${dayCount === 1 ? "" : "s"}` : "—"}
                          {isAppr ? " · Scheduled" : " · Pending"}
                        </span>
                        <StatusBadge status={item.status} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="el-card el-card--holidays">
            <div className="el-card-head">
              <div>
                <h3 className="el-card-title">Company Holidays</h3>
                <p className="el-card-sub">Official non-working days</p>
              </div>
            </div>
            {holidays.length === 0 ? (
              <p className="el-upcoming-empty">No upcoming company holidays listed.</p>
            ) : (
              <div className="el-holidays-list">
                {holidays.slice(0, 5).map((h, i) => (
                  <div key={i} className="el-holiday-row">
                    <div>
                      <div className="el-holiday-name">{h.name}</div>
                      <div className="el-holiday-meta">
                        {h.day} · {h.date}
                      </div>
                    </div>
                    <span className="el-holiday-type">{h.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="el-requests-section" aria-label="Leave requests">
        <div className="el-card">
          <div className="el-card-head" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <h3 className="el-card-title">Leave Requests</h3>
              <p className="el-card-sub">Full history of applications</p>
            </div>
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
                    <td colSpan={6} style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)" }}>
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
                      <td className="el-req-reason" title={req.reason}>
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
      </section>

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

              <div style={{ marginBottom: 14 }}>
                <DateRangePicker
                  label="Leave dates *"
                  placeholder="Select leave date range"
                  startDate={leaveForm.startDate}
                  endDate={leaveForm.endDate}
                  minDate={leaveEligibility.earliestEligibleDate}
                  onChange={({ startDate, endDate }) => {
                    setLeaveForm((prev) => ({
                      ...prev,
                      startDate: startDate || "",
                      endDate: endDate || startDate || "",
                    }));
                  }}
                />
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

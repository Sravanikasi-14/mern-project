import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import StatusBadge from "../components/StatusBadge";
import SoftRefresh from "../components/SoftRefresh";
import Pagination from "../components/Pagination";
import { IconRefresh } from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/AuthContext";
import MonthCalendar from "../components/MonthCalendar";
import DateRangePicker from "../components/DateRangePicker";
import ColumnChooser from "../components/ColumnChooser";
import {
  useLeaveRequestsQuery,
  useActiveLeavePoliciesQuery,
} from "../hooks/useAdminQueries";
import { useColumnPreferences } from "../hooks/useColumnPreferences";
import { invalidateLeave } from "../lib/queryKeys";
import {
  civilDaysInMonth,
  formatCivilDate,
  formatDisplayDate,
  getCompanyBusinessDate,
  monthTitle,
  parseCivilDate,
  resolveCompanyTimezone,
} from "../utils/dateUtils";
import "./LeaveManagement.css";
import MobileFilterBar from "../components/mobile/MobileFilterBar";
import AppModal from "../components/AppModal";
import LeaveReviewPanel from "../components/LeaveReviewPanel";

const LEAVE_TABLE_COLUMNS = [
  { id: "employee", label: "Employee", essential: true },
  { id: "leaveType", label: "Leave Type", essential: true },
  { id: "dates", label: "Dates", essential: true },
  { id: "days", label: "Days", defaultVisible: true },
  { id: "status", label: "Status", essential: true },
  { id: "reason", label: "Reason", defaultVisible: true },
  { id: "appliedOn", label: "Applied On", defaultVisible: false },
  { id: "actions", label: "Actions", essential: true },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function AdminLeaveManagement() {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const timeZone = resolveCompanyTimezone(company);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = (searchParams.get("status") || "ALL").toUpperCase();
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const todayParts = parseCivilDate(getCompanyBusinessDate(new Date(), timeZone));
  const [calMonth, setCalMonth] = useState(() => ({
    year: todayParts.year,
    month: todayParts.month,
  }));
  const [scheduleRequests, setScheduleRequests] = useState([]);

  const initialLeaveTab = (searchParams.get("tab") || (initialStatus === "PENDING" ? "leave" : "overview")).toLowerCase();
  const [leaveSection, setLeaveSection] = useState(() => {
    if (initialLeaveTab === "requests" || initialLeaveTab === "records" || initialLeaveTab === "leave") {
      return "leave";
    }
    return "overview";
  });

  // Filters & Pagination state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    ["ALL", "PENDING", "APPROVED", "REJECTED"].includes(initialStatus) ? initialStatus : "ALL"
  );
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const leaveCols = useColumnPreferences("hr-leave-workspace", LEAVE_TABLE_COLUMNS);

  // Details & Decision Modal State
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestDetailsLoading, setRequestDetailsLoading] = useState(false);
  const [employeeBalance, setEmployeeBalance] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // "APPROVE" | "REJECT" | null
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  // Change Leave Type State (HR action on APPROVED requests)
  const [availableLeaveTypes, setAvailableLeaveTypes] = useState([]);
  const [showChangeTypeForm, setShowChangeTypeForm] = useState(false);
  const [selectedNewType, setSelectedNewType] = useState("");
  const [changeTypeReason, setChangeTypeReason] = useState("");
  const [confirmChangeType, setConfirmChangeType] = useState(false);
  const [submittingChangeType, setSubmittingChangeType] = useState(false);
  const [changeTypeError, setChangeTypeError] = useState("");
  const [changeTypeSuccess, setChangeTypeSuccess] = useState("");

  // Leave Impact & Work Continuity (informational — never blocks approval)
  const [leaveImpact, setLeaveImpact] = useState(null);
  const [leaveImpactLoading, setLeaveImpactLoading] = useState(false);
  const [leaveImpactError, setLeaveImpactError] = useState("");

  // Phase 2: Suggested Backup Arrangements (proposed only)
  const [backupRecs, setBackupRecs] = useState(null);
  const [handoverRefreshToken, setHandoverRefreshToken] = useState(0);
  const [backupRecsLoading, setBackupRecsLoading] = useState(false);
  const [backupRecsError, setBackupRecsError] = useState("");
  const [savingBackupTaskId, setSavingBackupTaskId] = useState(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const policiesQuery = useActiveLeavePoliciesQuery();
  const leaveQuery = useLeaveRequestsQuery({
    page,
    limit,
    status: statusFilter,
    leaveType: typeFilter,
    search: debouncedSearch,
    fromDate: fromDateFilter,
    toDate: toDateFilter,
  });

  const requests = leaveQuery.data?.leaveRequests || [];
  const pagination = leaveQuery.data?.pagination || {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  };
  const summary = leaveQuery.data?.summary || {
    pending: 0,
    approved: 0,
    rejected: 0,
    onLeaveToday: 0,
  };
  const loading = leaveQuery.isLoading && requests.length === 0;

  const filterLeaveTypes = useMemo(() => {
    const types = policiesQuery.data || [];
    if (types.length === 0) {
      return [
        { value: "ALL", label: "All Types" },
        { value: "CASUAL", label: "Casual" },
        { value: "SICK", label: "Sick" },
        { value: "EARNED", label: "Earned" },
      ];
    }
    return [
      { value: "ALL", label: "All Types" },
      ...types.map((t) => ({ value: t.code, label: t.name || t.code })),
    ];
  }, [policiesQuery.data]);

  useEffect(() => {
    const types = policiesQuery.data || [];
    if (types.length > 0 && availableLeaveTypes.length === 0) {
      setAvailableLeaveTypes(types);
    }
  }, [policiesQuery.data, availableLeaveTypes.length]);

  useEffect(() => {
    if (leaveQuery.error) {
      const err = leaveQuery.error;
      if (!err.response || err.code === "ERR_NETWORK" || err.response?.status >= 500) {
        setError("Unable to connect to the server. Please check your connection and try again.");
      } else {
        setError(err.response?.data?.message || "Failed to load leave requests.");
      }
    } else if (leaveQuery.isSuccess) {
      setError("");
    }
  }, [leaveQuery.error, leaveQuery.isSuccess]);

  // Live Cross-Portal Synchronization via SSE
  useEffect(() => {
    const baseURL = api.defaults.baseURL || "/api";
    const eventsUrl = `${baseURL.replace(/\/$/, "")}/leave-requests/events`;

    let eventSource = null;
    try {
      eventSource = new EventSource(eventsUrl, { withCredentials: true });
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (
            payload.type === "LEAVE_SUBMITTED" ||
            payload.type === "LEAVE_DECIDED" ||
            payload.type === "LEAVE_TYPE_CHANGED"
          ) {
            invalidateLeave(queryClient);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [queryClient]);

  const resetReviewContext = () => {
    setEmployeeBalance(null);
    setLeaveImpact(null);
    setLeaveImpactError("");
    setBackupRecs(null);
    setBackupRecsError("");
    setShowChangeTypeForm(false);
    setSelectedNewType("");
    setChangeTypeReason("");
    setConfirmChangeType(false);
    setChangeTypeError("");
    setChangeTypeSuccess("");
  };

  const loadLeaveReviewContext = async (reqItem) => {
    try {
      setRequestDetailsLoading(true);
      setLeaveImpactLoading(true);
      setBackupRecsLoading(true);
      setLeaveImpactError("");
      setBackupRecsError("");
      const [detailRes, impactRes, backupRes] = await Promise.allSettled([
        api.get(`/leave-requests/${reqItem._id}`),
        api.get(`/leave-requests/${reqItem._id}/impact`),
        api.get(`/leave-requests/${reqItem._id}/backup-recommendations`),
      ]);

      if (detailRes.status === "fulfilled" && detailRes.value.data?.success) {
        setSelectedRequest(detailRes.value.data.leaveRequest);
        setEmployeeBalance(detailRes.value.data.leaveBalance);
        if (Array.isArray(detailRes.value.data.availableLeaveTypes)) {
          setAvailableLeaveTypes(detailRes.value.data.availableLeaveTypes);
        }
      }

      if (impactRes.status === "fulfilled" && impactRes.value.data?.success) {
        setLeaveImpact(impactRes.value.data.impact);
      } else if (impactRes.status === "rejected") {
        setLeaveImpact(null);
        setLeaveImpactError(
          impactRes.reason?.response?.data?.message || "Work continuity overview could not be loaded."
        );
      } else {
        setLeaveImpact(null);
        setLeaveImpactError("Work continuity overview could not be loaded.");
      }

      if (backupRes.status === "fulfilled" && backupRes.value.data?.success) {
        setBackupRecs(backupRes.value.data);
      } else if (backupRes.status === "rejected") {
        setBackupRecs(null);
        setBackupRecsError(
          backupRes.reason?.response?.data?.message || "Backup recommendations could not be loaded."
        );
      } else {
        setBackupRecs(null);
        setBackupRecsError("Backup recommendations could not be loaded.");
      }
    } catch (err) {
      console.warn("Could not fetch full leave review context, using local data", err);
      setLeaveImpactError((prev) => prev || "Work continuity overview could not be loaded.");
      setBackupRecsError((prev) => prev || "Backup recommendations could not be loaded.");
    } finally {
      setRequestDetailsLoading(false);
      setLeaveImpactLoading(false);
      setBackupRecsLoading(false);
    }
  };

  const retryBackupRecommendations = async () => {
    if (!selectedRequest?._id) return;
    try {
      setBackupRecsLoading(true);
      setBackupRecsError("");
      const refresh = await api.get(`/leave-requests/${selectedRequest._id}/backup-recommendations`);
      if (refresh.data?.success) setBackupRecs(refresh.data);
      else {
        setBackupRecs(null);
        setBackupRecsError("Backup recommendations could not be loaded.");
      }
    } catch (err) {
      setBackupRecs(null);
      setBackupRecsError(
        err.response?.data?.message || "Backup recommendations could not be loaded."
      );
    } finally {
      setBackupRecsLoading(false);
    }
  };

  const closeDecisionModal = () => {
    setConfirmAction(null);
    setSelectedRequest(null);
    setDecisionRemarks("");
    setDecisionError("");
    resetReviewContext();
  };

  // Approve / Reject → unified decision modal (loads continuity + backup context)
  const handleQuickDecisionPrompt = (reqItem, action) => {
    setSelectedRequest(reqItem);
    setConfirmAction(action);
    setDecisionRemarks("");
    setDecisionError("");
    resetReviewContext();
    loadLeaveReviewContext(reqItem);
  };

  const handleOpenDetails = async (reqItem) => {
    setSelectedRequest(reqItem);
    setConfirmAction(null);
    setDecisionRemarks("");
    setDecisionError("");
    resetReviewContext();
    await loadLeaveReviewContext(reqItem);
  };

  const handleSelectProposedBackup = async (taskId, backupEmployeeId, explanationSnapshot) => {
    if (!selectedRequest?._id) return;
    try {
      setSavingBackupTaskId(taskId);
      setBackupRecsError("");
      await api.put(`/leave-requests/${selectedRequest._id}/backup-proposals`, {
        taskId,
        backupEmployeeId,
        explanationSnapshot,
      });
      const refresh = await api.get(`/leave-requests/${selectedRequest._id}/backup-recommendations`);
      if (refresh.data?.success) setBackupRecs(refresh.data);
      // Refresh handover draft so matching items pick up the proposal (no auto-submit)
      setHandoverRefreshToken((n) => n + 1);
    } catch (err) {
      setBackupRecsError(err.response?.data?.message || "Could not save proposed backup.");
    } finally {
      setSavingBackupTaskId(null);
    }
  };

  const handleSubmitDecision = async () => {
    if (!selectedRequest || !confirmAction) return;

    if (confirmAction === "REJECT" && decisionRemarks.trim().length < 3) {
      setDecisionError("Please provide a meaningful rejection reason (at least 3 characters).");
      return;
    }

    try {
      setSubmittingDecision(true);
      setDecisionError("");

      const res = await api.post(`/leave-requests/${selectedRequest._id}/decision`, {
        action: confirmAction,
        remarks: decisionRemarks,
      });

      setActionSuccess(res.data?.message || `Leave request ${confirmAction.toLowerCase()}d successfully.`);
      closeDecisionModal();
      await invalidateLeave(queryClient);
      setTimeout(() => setActionSuccess(""), 4000);
    } catch (err) {
      setDecisionError(
        err.response?.data?.message || `Failed to ${confirmAction.toLowerCase()} leave request.`
      );
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleChangeLeaveType = async () => {
    if (!selectedRequest || !selectedNewType || !changeTypeReason.trim()) {
      setChangeTypeError("Please select a new leave type and enter a reason for the change.");
      return;
    }

    try {
      setSubmittingChangeType(true);
      setChangeTypeError("");
      setChangeTypeSuccess("");

      const res = await api.patch(`/leave-requests/${selectedRequest._id}/leave-type`, {
        newLeaveType: selectedNewType,
        reason: changeTypeReason.trim(),
      });

      if (res.data?.success) {
        const updated = res.data.leaveRequest;
        setSelectedRequest((prev) => ({
          ...prev,
          leaveTypeCode: updated.leaveTypeCode,
          updatedAt: updated.updatedAt,
        }));
        if (res.data.leaveBalance) {
          setEmployeeBalance(res.data.leaveBalance);
        }
        const msg = res.data.message || "Leave type changed successfully.";
        setChangeTypeSuccess(msg);
        setActionSuccess(msg);
        await invalidateLeave(queryClient);
        setTimeout(() => setChangeTypeSuccess(""), 3500);
      }
    } catch (err) {
      setChangeTypeError(err.response?.data?.message || "Failed to change leave type.");
    } finally {
      setSubmittingChangeType(false);
    }
  };

  const formatDate = (dateString) => formatDisplayDate(dateString, timeZone);

  const getInitials = (name) => {
    if (!name) return "E";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  useEffect(() => {
    if (leaveSection !== "overview") return undefined;
    let cancelled = false;
    const loadSchedule = async () => {
      try {
        const start = formatCivilDate(calMonth.year, calMonth.month, 1);
        const end = formatCivilDate(calMonth.year, calMonth.month, civilDaysInMonth(calMonth.year, calMonth.month));
        const response = await api.get("/leave-requests", {
          params: {
            status: "APPROVED",
            fromDate: start,
            toDate: end,
            limit: 200,
            page: 1,
            includeSummary: false,
          },
        });
        if (!cancelled && response.data?.success) {
          setScheduleRequests(response.data.leaveRequests || []);
        }
      } catch {
        if (!cancelled) setScheduleRequests([]);
      }
    };
    loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [leaveSection, calMonth.year, calMonth.month, actionSuccess]);

  const todayStr = getCompanyBusinessDate(new Date(), timeZone);

  const calendarEvents = useMemo(
    () =>
      (scheduleRequests || []).map((request) => ({
        ...request,
        id: request._id,
        fromDate: request.fromDate,
        toDate: request.toDate,
        startDate: request.fromDate,
        endDate: request.toDate,
        employeeName: request.employeeName,
        leaveTypeCode: request.leaveTypeCode,
        status: request.status,
      })),
    [scheduleRequests]
  );

  const upcomingAbsences = useMemo(
    () =>
      calendarEvents
        .filter((request) => (request.toDate || request.endDate) >= todayStr)
        .sort((a, b) => String(a.fromDate).localeCompare(String(b.fromDate)))
        .slice(0, 6),
    [calendarEvents, todayStr]
  );

  return (
    <div className="lm-container">
      <AppHeader
        title="Leave"
        actions={<SoftRefresh active={Boolean(leaveQuery.isFetching && requests.length > 0)} />}
      />

      <div className="module-tabs" role="tablist" aria-label="Leave sections">
        <button
          type="button"
          className={`module-tab ${leaveSection === "overview" ? "is-active" : ""}`}
          onClick={() => {
            setLeaveSection("overview");
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("tab", "overview");
                return next;
              },
              { replace: true }
            );
            setPage(1);
          }}
        >
          Overview
        </button>
        <button
          type="button"
          className={`module-tab ${leaveSection === "leave" ? "is-active" : ""}`}
          onClick={() => {
            setLeaveSection("leave");
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("tab", "leave");
                return next;
              },
              { replace: true }
            );
            setPage(1);
          }}
        >
          Leave workspace
        </button>
      </div>

      {/* Global Alerts */}
      {actionSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{actionSuccess}</div>}
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {leaveSection === "overview" && (
        <div className="lm-summary-row">
          <button
            type="button"
            className="lm-sum-card"
            style={{ cursor: "pointer", textAlign: "left", border: "none", width: "100%" }}
            onClick={() => {
              setLeaveSection("leave");
              setStatusFilter("PENDING");
              setPage(1);
            }}
          >
            <div className="lm-sum-card-title">Pending approvals</div>
            <div className="lm-sum-card-num" style={{ color: summary.pending > 0 ? "var(--amber, #b06d0a)" : "inherit" }}>{summary.pending}</div>
          </button>
          <button
            type="button"
            className="lm-sum-card"
            style={{ cursor: "pointer", textAlign: "left", border: "none", width: "100%" }}
            onClick={() => {
              setLeaveSection("leave");
              setStatusFilter("APPROVED");
              setPage(1);
            }}
          >
            <div className="lm-sum-card-title">Approved</div>
            <div className="lm-sum-card-num">{summary.approved}</div>
          </button>
          <button
            type="button"
            className="lm-sum-card"
            style={{ cursor: "pointer", textAlign: "left", border: "none", width: "100%" }}
            onClick={() => {
              setLeaveSection("leave");
              setStatusFilter("REJECTED");
              setPage(1);
            }}
          >
            <div className="lm-sum-card-title">Rejected</div>
            <div className="lm-sum-card-num">{summary.rejected}</div>
          </button>
          <div className="lm-sum-card">
            <div className="lm-sum-card-title">On leave today</div>
            <div className="lm-sum-card-num">{summary.onLeaveToday || 0}</div>
          </div>
        </div>
      )}

      {leaveSection === "overview" && (
      <section className="lm-calendar-section" aria-label="Monthly Leave Schedule">
        <MonthCalendar
          year={calMonth.year}
          month={calMonth.month}
          timeZone={timeZone}
          events={calendarEvents}
          heading={`Approved Leave Schedule — ${monthTitle(calMonth.year, calMonth.month)}`}
          onMonthChange={setCalMonth}
        />

        <div className="lm-side-card">
          <div className="lm-side-title-row">
            <h3 className="lm-side-title">Upcoming Team Absences</h3>
            <span style={{ fontSize: "12px", color: "var(--g-800)", fontWeight: "600" }}>
              {upcomingAbsences.length} upcoming
            </span>
          </div>

          <div className="lm-team-leave-list">
            {upcomingAbsences.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "14px 0" }}>
                No approved leaves remaining this month.
              </p>
            ) : (
              upcomingAbsences.map((r) => {
                const name = r.employeeName || "Team Member";
                const type = r.leaveTypeCode || "Casual";
                return (
                  <div key={r._id} className="lm-team-leave-row">
                    <div className="lm-team-leave-left">
                      <div className="lm-req-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
                        {getInitials(name)}
                      </div>
                      <div>
                        <div className="lm-team-leave-name" title={name}>{name}</div>
                        <div className="lm-team-leave-dates">
                          {formatDate(r.fromDate)} – {formatDate(r.toDate)}
                        </div>
                      </div>
                    </div>
                    <span className={`lm-req-type-pill ${type.toLowerCase()}`}>
                      {type}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
      )}

      {leaveSection === "leave" && (
      <>
      <div className="lm-records-heading">
        <span className="m-title-full">Leave workspace</span>
        <span className="m-title-short">Leave</span>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
        Search, filter, and approve leave in one place. Pending rows show approve/reject actions.
      </p>
      <MobileFilterBar
        search={search}
        onSearchChange={(e) => setSearch(e.target.value)}
        searchPlaceholder="Search by name"
        filterCount={(typeFilter !== "ALL" ? 1 : 0) + (fromDateFilter ? 1 : 0) + (toDateFilter ? 1 : 0)}
        onReset={() => {
          setTypeFilter("ALL");
          setFromDateFilter("");
          setToDateFilter("");
          setPage(1);
        }}
      >
        <label>
          Leave type
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="filter-select"
          >
            {filterLeaveTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <DateRangePicker
          label="Date range"
          startDate={fromDateFilter}
          endDate={toDateFilter}
          onChange={({ startDate, endDate }) => {
            setFromDateFilter(startDate || "");
            setToDateFilter(endDate || "");
            setPage(1);
          }}
        />
      </MobileFilterBar>
      <div className="lm-toolbar">
        <div className="lm-toolbar-left">
          <div style={{ display: "flex", background: "#f1f5f9", padding: 2, borderRadius: 6 }}>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-filter-link ${statusFilter === opt.value ? "active" : ""}`}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: 5,
                  fontWeight: statusFilter === opt.value ? 700 : 500,
                  background: statusFilter === opt.value ? "#ffffff" : "transparent",
                  color: statusFilter === opt.value ? "var(--g-950, #0d3a23)" : "var(--muted, #646d67)",
                  border: "none",
                  boxShadow: statusFilter === opt.value ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setStatusFilter(opt.value);
                  setPage(1);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", minWidth: 200 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee, role, reason..."
              className="search-input"
              style={{ width: "100%", paddingLeft: "30px", height: 32, fontSize: 12.5 }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            style={{ height: 32, fontSize: 12.5 }}
          >
            {filterLeaveTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <DateRangePicker
            label=""
            placeholder="Date range"
            startDate={fromDateFilter}
            endDate={toDateFilter}
            onChange={({ startDate, endDate }) => {
              setFromDateFilter(startDate || "");
              setToDateFilter(endDate || "");
              setPage(1);
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ColumnChooser
            columns={leaveCols.columns}
            visible={leaveCols.visible}
            onToggle={leaveCols.toggle}
            onReset={leaveCols.reset}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => leaveQuery.refetch()}
            title="Refresh leave requests"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 12px", fontSize: 13 }}
          >
            <IconRefresh size={18} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

        {loading && requests.length === 0 ? (
          <div className="pm-empty-box">
            <div className="profile-spinner" style={{ margin: "0 auto 12px" }} />
            <p>Loading leave requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="pm-empty-box">
            <h4>No leave requests found</h4>
            <p>
              {debouncedSearch || statusFilter !== "ALL"
                ? "No requests match your search or filter criteria."
                : "No leave requests yet."}
            </p>
          </div>
        ) : (
        <div className="lm-table-view">
        <div className="data-table-container table-wrapper-relative">
          <table className="data-table">
            <thead>
              <tr>
                {leaveCols.isVisible("employee") && <th>Employee</th>}
                {leaveCols.isVisible("leaveType") && <th>Leave Type</th>}
                {leaveCols.isVisible("dates") && <th>Dates</th>}
                {leaveCols.isVisible("days") && <th>Days</th>}
                {leaveCols.isVisible("status") && <th>Status</th>}
                {leaveCols.isVisible("reason") && <th>Reason</th>}
                {leaveCols.isVisible("appliedOn") && <th>Applied On</th>}
                {leaveCols.isVisible("actions") && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req._id}>
                  {leaveCols.isVisible("employee") && (
                    <td>
                      <strong>{req.employeeId?.fullName || "—"}</strong>
                      <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                        {req.employeeId?.job?.jobTitle || "—"}
                      </div>
                    </td>
                  )}
                  {leaveCols.isVisible("leaveType") && (
                    <td>
                      <span className={"lm-req-type-pill " + (req.leaveTypeCode || "CASUAL").toLowerCase()}>
                        {req.leaveTypeCode || "CASUAL"}
                      </span>
                    </td>
                  )}
                  {leaveCols.isVisible("dates") && (
                    <td>{formatDate(req.startDate)} to {formatDate(req.endDate)}</td>
                  )}
                  {leaveCols.isVisible("days") && (
                    <td>{req.calculatedDays || req.durationDays || 1}</td>
                  )}
                  {leaveCols.isVisible("status") && (
                    <td><StatusBadge status={req.status} /></td>
                  )}
                  {leaveCols.isVisible("reason") && (
                    <td style={{ maxWidth: 180 }}>
                      <span title={req.reason} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {req.reason || "—"}
                      </span>
                    </td>
                  )}
                  {leaveCols.isVisible("appliedOn") && <td>{formatDate(req.createdAt)}</td>}
                  {leaveCols.isVisible("actions") && (
                    <td>
                      <div className="lm-row-actions">
                        {req.status === "PENDING" && (
                          <>
                            <button type="button" className="btn-primary btn-sm lm-action-btn" onClick={() => handleQuickDecisionPrompt(req, "APPROVE")}>Approve</button>
                            <button type="button" className="btn-secondary btn-sm lm-action-btn" onClick={() => handleQuickDecisionPrompt(req, "REJECT")}>Reject</button>
                          </>
                        )}
                        <button type="button" className="btn-secondary btn-sm lm-action-btn" onClick={() => handleOpenDetails(req)}>Details</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        )}

      {/* Pagination Bar */}
      {pagination.total > 0 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          pageSize={pagination.limit}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(p) => setPage(p)}
          onPageSizeChange={(s) => {
            setLimit(s);
            setPage(1);
          }}
          itemLabel="leave applications"
          className="my-3"
        />
      )}
      </>
      )}

      {/* -----------------------------------------------------------------------
          UNIFIED LEAVE DECISION MODAL (Approve / Reject)
          ----------------------------------------------------------------------- */}
      {selectedRequest && confirmAction && (() => {
        const emp = selectedRequest.employee || selectedRequest.employeeId || {};
        const empName = emp.fullName || selectedRequest.employeeName || "Employee";
        const isApprove = confirmAction === "APPROVE";

        return (
          <AppModal
            open
            onClose={closeDecisionModal}
            size="lg"
            className="lm-decision-modal"
            locked={submittingDecision}
            title={isApprove ? "Approve Leave" : "Reject Leave"}
            subtitle={
              isApprove
                ? "Review continuity information, then confirm approval. Backup selection is optional."
                : "Review the request context and provide a rejection reason before confirming."
            }
            footer={
              <>
                <button
                  type="button"
                  className="btn-secondary lm-action-btn"
                  onClick={closeDecisionModal}
                  disabled={submittingDecision}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${isApprove ? "btn-primary" : "btn-secondary"} lm-action-btn`}
                  style={
                    !isApprove
                      ? { background: "var(--rose, #c45c5c)", color: "#fff", borderColor: "var(--rose, #c45c5c)" }
                      : undefined
                  }
                  onClick={handleSubmitDecision}
                  disabled={submittingDecision}
                >
                  {submittingDecision ? "Submitting" : isApprove ? "Approve Leave" : "Reject Leave"}
                </button>
              </>
            }
          >
            {decisionError && <div className="error" style={{ marginBottom: 12 }}>{decisionError}</div>}

            <div className={`lm-decision-banner lm-decision-banner--${isApprove ? "approve" : "reject"}`}>
              You are about to <strong>{isApprove ? "approve" : "reject"}</strong> leave for{" "}
              <strong>{empName}</strong>. Operational information below is for planning only and does not block leave.
            </div>

            <LeaveReviewPanel
              selectedRequest={selectedRequest}
              employeeBalance={employeeBalance}
              leaveImpact={leaveImpact}
              leaveImpactLoading={leaveImpactLoading}
              leaveImpactError={leaveImpactError}
              backupRecs={backupRecs}
              backupRecsLoading={backupRecsLoading}
              backupRecsError={backupRecsError}
              onRetryBackup={retryBackupRecommendations}
              requestDetailsLoading={requestDetailsLoading}
              formatDate={formatDate}
              getInitials={getInitials}
              mode="decision"
              showHandover={false}
            />

            <section className="lm-decision-section lm-decision-section--action">
              <h4 className="lm-impact-heading">{isApprove ? "Approval comments" : "Rejection reason"}</h4>
              <label className="lm-decision-remarks">
                <span>
                  {isApprove
                    ? "Optional notes for the employee or your records"
                    : "Required — explain the rejection clearly"}
                </span>
                <textarea
                  rows={3}
                  value={decisionRemarks}
                  onChange={(e) => setDecisionRemarks(e.target.value)}
                  placeholder={
                    isApprove
                      ? "Optional approval notes"
                      : "Enter a meaningful rejection reason"
                  }
                  disabled={submittingDecision}
                />
              </label>
            </section>
          </AppModal>
        );
      })()}

      {/* -----------------------------------------------------------------------
          DETAILS & CHANGE LEAVE TYPE MODAL
          ----------------------------------------------------------------------- */}
      {selectedRequest && !confirmAction && (
        <AppModal
          open
          size="lg"
          className="lm-details-modal"
          title="Leave Request Details"
          subtitle="Review eligibility, work impact, and optional backup coordination. Leave approval is independent of handover."
          onClose={() => {
            setSelectedRequest(null);
            resetReviewContext();
          }}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary lm-action-btn"
                onClick={() => {
                  setSelectedRequest(null);
                  resetReviewContext();
                }}
              >
                Close
              </button>
              {selectedRequest.status === "PENDING" && (
                <>
                  <button
                    type="button"
                    className="btn-secondary lm-action-btn"
                    style={{
                      background: "var(--rose, #c45c5c)",
                      color: "#fff",
                      borderColor: "var(--rose, #c45c5c)",
                    }}
                    onClick={() => {
                      setConfirmAction("REJECT");
                      setDecisionRemarks("");
                      setDecisionError("");
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn-primary lm-action-btn"
                    onClick={() => {
                      setConfirmAction("APPROVE");
                      setDecisionRemarks("");
                      setDecisionError("");
                    }}
                  >
                    Approve
                  </button>
                </>
              )}
            </>
          }
        >
          {changeTypeSuccess && (
            <div className="success-alert" style={{ marginBottom: 14 }}>
              {changeTypeSuccess}
            </div>
          )}
          {changeTypeError && (
            <div className="error" style={{ marginBottom: 14 }}>
              {changeTypeError}
            </div>
          )}

          <LeaveReviewPanel
            selectedRequest={selectedRequest}
            employeeBalance={employeeBalance}
            leaveImpact={leaveImpact}
            leaveImpactLoading={leaveImpactLoading}
            leaveImpactError={leaveImpactError}
            backupRecs={backupRecs}
            backupRecsLoading={backupRecsLoading}
            backupRecsError={backupRecsError}
            onRetryBackup={retryBackupRecommendations}
            requestDetailsLoading={requestDetailsLoading}
            formatDate={formatDate}
            getInitials={getInitials}
            mode="details"
            showHandover
            handoverRefreshToken={handoverRefreshToken}
            savingBackupTaskId={savingBackupTaskId}
            onProposeBackup={(taskId, backupEmployeeId, explanationSnapshot) =>
              handleSelectProposedBackup(taskId, backupEmployeeId, explanationSnapshot)
            }
            onClearBackup={(taskId) => handleSelectProposedBackup(taskId, null)}
          />

          {selectedRequest.status === "APPROVED" && (
            <div className="lm-change-type-block">
              <button
                type="button"
                className="btn-secondary btn-sm lm-action-btn"
                onClick={() => setShowChangeTypeForm((prev) => !prev)}
              >
                {showChangeTypeForm ? "Cancel leave type adjustment" : "Adjust leave type"}
              </button>

              {showChangeTypeForm && (
                <div className="lm-change-type-form">
                  <label>
                    <span>Select new leave type</span>
                    <select
                      value={selectedNewType}
                      onChange={(e) => setSelectedNewType(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">Choose type</option>
                      {availableLeaveTypes
                        .filter((t) => t.code !== selectedRequest.leaveTypeCode)
                        .map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name || t.code}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>Reason for adjustment</span>
                    <input
                      value={changeTypeReason}
                      onChange={(e) => setChangeTypeReason(e.target.value)}
                      placeholder="e.g. Employee requested change from Casual to Sick leave"
                      className="search-input"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-primary btn-sm lm-action-btn"
                    onClick={handleChangeLeaveType}
                    disabled={
                      submittingChangeType || !selectedNewType || !changeTypeReason.trim()
                    }
                  >
                    {submittingChangeType ? "Updating…" : "Save leave type change"}
                  </button>
                </div>
              )}
            </div>
          )}
        </AppModal>
      )}
    </div>
  );
}

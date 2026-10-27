import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { IconClose, IconCheck, IconRefresh, IconArrowLeft, IconArrowRight } from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";
import AppHeader from "../components/AppHeader";
import "./LeaveManagement.css";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

export default function AdminLeaveManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = (searchParams.get("status") || "ALL").toUpperCase();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    onLeaveToday: 0,
  });

  // Calendar View State
  const [calDate, setCalDate] = useState(() => new Date());

  // View mode: "cards" | "table" (default cards as per Reference 1)
  const [viewMode, setViewMode] = useState("cards");

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
  const [limit, setLimit] = useState(12);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 1,
  });

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
  const [filterLeaveTypes, setFilterLeaveTypes] = useState([
    { value: "ALL", label: "All Types" },
    { value: "CASUAL", label: "Casual" },
    { value: "SICK", label: "Sick" },
    { value: "EARNED", label: "Earned" },
  ]);
  const [showChangeTypeForm, setShowChangeTypeForm] = useState(false);
  const [selectedNewType, setSelectedNewType] = useState("");
  const [changeTypeReason, setChangeTypeReason] = useState("");
  const [confirmChangeType, setConfirmChangeType] = useState(false);
  const [submittingChangeType, setSubmittingChangeType] = useState(false);
  const [changeTypeError, setChangeTypeError] = useState("");
  const [changeTypeSuccess, setChangeTypeSuccess] = useState("");

  useEffect(() => {
    api
      .get("/policies/active")
      .then((res) => {
        const types = res.data?.policy?.leaveTypes || [];
        if (types.length > 0) {
          setFilterLeaveTypes([
            { value: "ALL", label: "All Types" },
            ...types.map((t) => ({ value: t.code, label: t.name || t.code })),
          ]);
          setAvailableLeaveTypes(types);
        }
      })
      .catch(() => {});
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch Leave Requests and Summary
  const fetchLeaveData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");

      const params = {
        page,
        limit,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        leaveType: typeFilter !== "ALL" ? typeFilter : undefined,
        search: debouncedSearch || undefined,
        fromDate: fromDateFilter || undefined,
        toDate: toDateFilter || undefined,
      };

      const response = await api.get("/leave-requests", { params });

      if (response.data?.success) {
        setRequests(response.data.leaveRequests || []);
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
        if (response.data.summary) {
          setSummary(response.data.summary);
        }
      }
    } catch (err) {
      if (!silent) {
        if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
          setError("Unable to connect to the server. Please check your connection and try again.");
        } else {
          setError(err.response?.data?.message || "Failed to load leave requests.");
        }
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchLeaveDataRef = useRef(fetchLeaveData);
  useEffect(() => {
    fetchLeaveDataRef.current = fetchLeaveData;
  });

  useEffect(() => {
    fetchLeaveData();
  }, [page, limit, statusFilter, typeFilter, debouncedSearch, fromDateFilter, toDateFilter]);

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
            if (fetchLeaveDataRef.current) fetchLeaveDataRef.current(true);
          }
        } catch {}
      };
    } catch {}

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        if (fetchLeaveDataRef.current) fetchLeaveDataRef.current(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        if (fetchLeaveDataRef.current) fetchLeaveDataRef.current(true);
      }
    }, 15000);

    return () => {
      if (eventSource) eventSource.close();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      clearInterval(intervalId);
    };
  }, []);

  // Quick Action Handler (Approve / Reject directly or via modal)
  const handleQuickDecisionPrompt = (reqItem, action) => {
    setSelectedRequest(reqItem);
    setConfirmAction(action);
    setDecisionRemarks("");
    setDecisionError("");
    setShowChangeTypeForm(false);
  };

  const handleOpenDetails = async (reqItem) => {
    setSelectedRequest(reqItem);
    setConfirmAction(null);
    setDecisionRemarks("");
    setDecisionError("");
    setEmployeeBalance(null);
    setShowChangeTypeForm(false);
    setSelectedNewType("");
    setChangeTypeReason("");
    setConfirmChangeType(false);
    setChangeTypeError("");
    setChangeTypeSuccess("");

    try {
      setRequestDetailsLoading(true);
      const res = await api.get(`/leave-requests/${reqItem._id}`);
      if (res.data?.success) {
        setSelectedRequest(res.data.leaveRequest);
        setEmployeeBalance(res.data.leaveBalance);
        if (Array.isArray(res.data.availableLeaveTypes)) {
          setAvailableLeaveTypes(res.data.availableLeaveTypes);
        }
      }
    } catch (err) {
      console.warn("Could not fetch full details, using local data", err);
    } finally {
      setRequestDetailsLoading(false);
    }
  };

  const handleSubmitDecision = async () => {
    if (!selectedRequest || !confirmAction) return;

    try {
      setSubmittingDecision(true);
      setDecisionError("");

      const res = await api.post(`/leave-requests/${selectedRequest._id}/decision`, {
        action: confirmAction,
        remarks: decisionRemarks,
      });

      setActionSuccess(res.data?.message || `Leave request ${confirmAction.toLowerCase()}d successfully.`);
      setSelectedRequest(null);
      setConfirmAction(null);
      setDecisionRemarks("");
      await fetchLeaveData();
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
        await fetchLeaveData(true);
        setTimeout(() => setChangeTypeSuccess(""), 3500);
      }
    } catch (err) {
      setChangeTypeError(err.response?.data?.message || "Failed to change leave type.");
    } finally {
      setSubmittingChangeType(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getInitials = (name) => {
    if (!name) return "E";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Calendar calculations: days of current selected month
  const calendarData = useMemo(() => {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-based week index (0 = Mon, 6 = Sun)
    let startDayIdx = firstDay.getDay() - 1;
    if (startDayIdx === -1) startDayIdx = 6;

    const days = [];
    // Days from previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayIdx - 1; i >= 0; i--) {
      days.push({
        dayNum: prevMonthLastDay - i,
        dateStr: `${year}-${String(month).padStart(2, "0")}-${String(prevMonthLastDay - i).padStart(2, "0")}`,
        isOtherMonth: true,
      });
    }

    // Days of current month
    const totalDays = lastDay.getDate();
    const today = new Date().toISOString().split("T")[0];

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({
        dayNum: d,
        dateStr,
        isOtherMonth: false,
        isToday: dateStr === today,
      });
    }

    // Pad end of calendar to complete grid
    const remaining = (7 - (days.length % 7)) % 7;
    for (let r = 1; r <= remaining; r++) {
      days.push({
        dayNum: r,
        dateStr: `${year}-${String(month + 2).padStart(2, "0")}-${String(r).padStart(2, "0")}`,
        isOtherMonth: true,
      });
    }

    // Filter approved leaves that intersect with days
    const approvedRequests = requests.filter((r) => r.status === "APPROVED");

    return {
      monthName: calDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      days,
      approvedRequests,
    };
  }, [calDate, requests]);

  const handlePrevMonth = () => {
    setCalDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCalDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  return (
    <div className="lm-container">
      <AppHeader title="Leave Requests" />

      {/* Global Alerts */}
      {actionSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{actionSuccess}</div>}
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Compact Inline Leave Statistics Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 8,
          padding: "8px 16px",
          marginBottom: 12,
          fontSize: 13,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Pending Approvals: <strong style={{ color: summary.pending > 0 ? "#b06d0a" : "var(--ink)" }}>{summary.pending}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Approved: <strong style={{ color: "var(--g-800, #155a37)" }}>{summary.approved}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Rejected: <strong style={{ color: "#b91c1c" }}>{summary.rejected}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          On Leave Today: <strong style={{ color: "var(--g-800, #155a37)" }}>{summary.onLeaveToday || 0}</strong>
        </span>
      </div>

      {/* Consolidated Single Leave Toolbar */}
      <div
        className="lm-toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 10,
          padding: "8px 14px",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Status Filter Tabs */}
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

          {/* Search Input */}
          <div style={{ position: "relative", minWidth: 200 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee, role, reason..."
              className="search-input"
              style={{ width: "100%", paddingLeft: "30px", height: 32, fontSize: 12.5 }}
            />
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {/* Leave Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            style={{ height: 32, fontSize: 12.5, padding: "0 8px" }}
          >
            {filterLeaveTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {/* Date range filters */}
          <input
            type="date"
            value={fromDateFilter}
            onChange={(e) => {
              setFromDateFilter(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            title="From Date"
            style={{ height: 32, fontSize: 12, padding: "0 6px" }}
          />
          <input
            type="date"
            value={toDateFilter}
            onChange={(e) => {
              setToDateFilter(e.target.value);
              setPage(1);
            }}
            className="filter-select"
            title="To Date"
            style={{ height: 32, fontSize: 12, padding: "0 6px" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* View Mode Toggle: Cards vs Table */}
          <div className="pm-view-toggle" style={{ height: 32 }}>
            <button
              type="button"
              className={`pm-view-toggle-btn ${viewMode === "cards" ? "active" : ""}`}
              onClick={() => setViewMode("cards")}
              style={{ padding: "0 8px", height: "100%", fontSize: 12 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>Cards</span>
            </button>
            <button
              type="button"
              className={`pm-view-toggle-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              style={{ padding: "0 8px", height: "100%", fontSize: 12 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
              <span>Table</span>
            </button>
          </div>

          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
            className="filter-select"
            style={{ height: 32, fontSize: 12, padding: "0 6px" }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fetchLeaveData()}
            title="Refresh leave requests"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", fontSize: 12.5 }}
          >
            <IconRefresh size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* -----------------------------------------------------------------------
          REFERENCE 1: LEAVE REQUESTS AND APPROVALS SECTION
          ----------------------------------------------------------------------- */}
      {viewMode === "cards" ? (
        <>
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
                  : "No leave applications have been submitted yet."}
              </p>
              {(debouncedSearch || statusFilter !== "ALL") && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: "12px" }}
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                    setStatusFilter("ALL");
                    setTypeFilter("ALL");
                    setFromDateFilter("");
                    setToDateFilter("");
                    setPage(1);
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="lm-requests-grid">
              {requests.map((req) => {
                const empName = req.employeeId?.fullName || "Employee";
                const role = req.employeeId?.job?.jobTitle || "Team Member";
                const isPending = req.status === "PENDING";
                const isApproved = req.status === "APPROVED";
                const typeCode = (req.leaveTypeCode || "CASUAL").toLowerCase();

                return (
                  <div key={req._id} className="lm-req-card">
                    {/* Header */}
                    <div className="lm-req-card-header">
                      <div className="lm-req-employee-info">
                        <div className="lm-req-avatar">
                          {getInitials(empName)}
                        </div>
                        <div className="lm-req-emp-details">
                          <h3 className="lm-req-emp-name" title={empName}>
                            {empName}
                          </h3>
                          <span className="lm-req-emp-role" title={role}>
                            {role}
                          </span>
                        </div>
                      </div>

                      <StatusBadge status={req.status} />
                    </div>

                    {/* Body */}
                    <div className="lm-req-body">
                      <div className="lm-req-meta-row">
                        <span className={`lm-req-type-pill ${typeCode}`}>
                          {req.leaveTypeCode || "CASUAL"}
                        </span>
                        <span className="lm-req-duration">
                          {req.calculatedDays || req.durationDays || 1} Day(s)
                        </span>
                      </div>

                      <div className="lm-req-dates-line">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span>
                          {formatDate(req.startDate)} to {formatDate(req.endDate)}
                        </span>
                      </div>

                      <div className="lm-req-reason-box" title={req.reason}>
                        "{req.reason || "No reason provided."}"
                      </div>

                      {req.reviewedBy && (
                        <div className="lm-req-reviewer-row">
                          <span>Decision by: <strong>{req.reviewedBy.fullName || "HR Admin"}</strong></span>
                        </div>
                      )}
                    </div>

                    {/* Footer Actions (Reference 1 style) */}
                    <div className="lm-req-card-actions">
                      {isPending ? (
                        <>
                          <div className="lm-action-btn-group">
                            <button
                              type="button"
                              className="lm-btn-approve"
                              onClick={() => handleQuickDecisionPrompt(req, "APPROVE")}
                              title="Approve leave request"
                              aria-label="Approve leave request"
                            >
                              <IconCheck size={16} />
                            </button>
                            <button
                              type="button"
                              className="lm-btn-reject"
                              onClick={() => handleQuickDecisionPrompt(req, "REJECT")}
                              title="Reject leave request"
                              aria-label="Reject leave request"
                            >
                              <IconClose size={16} />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="lm-btn-details"
                            onClick={() => handleOpenDetails(req)}
                          >
                            Details
                          </button>
                        </>
                      ) : isApproved ? (
                        <>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => {
                              handleOpenDetails(req);
                              setShowChangeTypeForm(true);
                            }}
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                          >
                            Change Type
                          </button>
                          <button
                            type="button"
                            className="lm-btn-details"
                            onClick={() => handleOpenDetails(req)}
                          >
                            View Record
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="lm-btn-details"
                          onClick={() => handleOpenDetails(req)}
                          style={{ width: "100%", textAlign: "center" }}
                        >
                          View Reason & Record
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Table Fallback View */
        <div className="data-table-container table-wrapper-relative" style={{ marginBottom: 28 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th>Dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Applied On</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req._id}>
                  <td>
                    <strong>{req.employeeId?.fullName || "—"}</strong>
                    <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                      {req.employeeId?.job?.jobTitle || "—"}
                    </div>
                  </td>
                  <td>
                    <span className={`lm-req-type-pill ${(req.leaveTypeCode || "CASUAL").toLowerCase()}`}>
                      {req.leaveTypeCode || "CASUAL"}
                    </span>
                  </td>
                  <td>
                    {formatDate(req.startDate)} to {formatDate(req.endDate)}
                  </td>
                  <td><strong>{req.calculatedDays || req.durationDays || 1}</strong></td>
                  <td><StatusBadge status={req.status} /></td>
                  <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {req.reason || "—"}
                  </td>
                  <td>{formatDate(req.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      {req.status === "PENDING" && (
                        <>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => handleQuickDecisionPrompt(req, "APPROVE")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => handleQuickDecisionPrompt(req, "REJECT")}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleOpenDetails(req)}
                      >
                        Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* -----------------------------------------------------------------------
          REFERENCE 1: LEAVE CALENDAR AND SCHEDULE VISUALIZATION
          ----------------------------------------------------------------------- */}
      <section className="lm-calendar-section" aria-label="Monthly Leave Schedule">
        {/* Calendar Card */}
        <div className="lm-calendar-card">
          <div className="lm-cal-header-bar">
            <h3 className="lm-cal-title">
              Approved Leave Schedule — {calendarData.monthName}
            </h3>
            <div className="lm-cal-nav">
              <button
                type="button"
                className="lm-cal-nav-btn"
                onClick={handlePrevMonth}
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                type="button"
                className="lm-cal-nav-btn"
                onClick={handleNextMonth}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </div>

          <div className="lm-cal-grid">
            <div className="lm-cal-weekday">Mon</div>
            <div className="lm-cal-weekday">Tue</div>
            <div className="lm-cal-weekday">Wed</div>
            <div className="lm-cal-weekday">Thu</div>
            <div className="lm-cal-weekday">Fri</div>
            <div className="lm-cal-weekday">Sat</div>
            <div className="lm-cal-weekday">Sun</div>

            {calendarData.days.map((day, idx) => {
              // Find matching approved leaves for this day
              const dayLeaves = calendarData.approvedRequests.filter((r) => {
                const s = r.startDate?.split("T")[0];
                const e = r.endDate?.split("T")[0];
                return s && e && day.dateStr >= s && day.dateStr <= e;
              });

              return (
                <div
                  key={idx}
                  className={`lm-cal-day ${day.isOtherMonth ? "other-month" : ""} ${day.isToday ? "today" : ""}`}
                >
                  <span className="lm-cal-day-num">{day.dayNum}</span>
                  {dayLeaves.slice(0, 2).map((l, lIdx) => {
                    const empShort = (l.employeeId?.fullName || "Leave").split(" ")[0];
                    const tCode = (l.leaveTypeCode || "CASUAL").toLowerCase();
                    return (
                      <div
                        key={lIdx}
                        className={`lm-cal-leave-pill ${tCode}`}
                        title={`${l.employeeId?.fullName || "Employee"}: ${l.leaveTypeCode} Leave`}
                      >
                        {empShort} · {l.leaveTypeCode?.slice(0, 3)}
                      </div>
                    );
                  })}
                  {dayLeaves.length > 2 && (
                    <div style={{ fontSize: "9px", color: "var(--muted)", marginTop: 2 }}>
                      +{dayLeaves.length - 2} more
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side Card: Currently / Scheduled on Leave */}
        <div className="lm-side-card">
          <div className="lm-side-title-row">
            <h3 className="lm-side-title">Upcoming Team Absences</h3>
            <span style={{ fontSize: "12px", color: "var(--g-800)", fontWeight: "600" }}>
              {calendarData.approvedRequests.length} Scheduled
            </span>
          </div>

          <div className="lm-team-leave-list">
            {calendarData.approvedRequests.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "14px 0" }}>
                No approved leaves scheduled for this month.
              </p>
            ) : (
              calendarData.approvedRequests.slice(0, 5).map((r) => {
                const name = r.employeeId?.fullName || "Team Member";
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
                          {formatDate(r.startDate)} - {formatDate(r.endDate)}
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

      {/* -----------------------------------------------------------------------
          CONFIRM DECISION MODAL (Quick Decision or Full Decision)
          ----------------------------------------------------------------------- */}
      {selectedRequest && confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Confirm {confirmAction === "APPROVE" ? "Approval" : "Rejection"}</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setConfirmAction(null)}
                aria-label="Close"
              >
                <IconClose size={14} />
              </button>
            </div>

            {decisionError && <div className="error" style={{ marginBottom: 14 }}>{decisionError}</div>}

            <p style={{ fontSize: "13.5px", color: "var(--ink)", margin: "8px 0 16px" }}>
              Are you sure you want to <strong>{confirmAction.toLowerCase()}</strong> this leave request for{" "}
              <strong>{selectedRequest.employeeId?.fullName || "this employee"}</strong>?
            </p>

            <div style={{ background: "var(--panel)", padding: "12px 14px", borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: "13px", marginBottom: 4 }}>
                <strong>Dates:</strong> {formatDate(selectedRequest.startDate)} to {formatDate(selectedRequest.endDate)} ({selectedRequest.calculatedDays || 1} day(s))
              </div>
              <div style={{ fontSize: "13px" }}>
                <strong>Reason:</strong> {selectedRequest.reason || "Not specified"}
              </div>
            </div>

            <label style={{ display: "block", marginBottom: 18 }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", display: "block", marginBottom: 6 }}>
                Reviewer Remarks (Optional)
              </span>
              <textarea
                rows={3}
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                placeholder="Enter remarks or approval notes..."
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hair)", boxSizing: "border-box" }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={confirmAction === "APPROVE" ? "btn-primary" : "btn-secondary"}
                style={confirmAction === "REJECT" ? { background: "var(--rose)", color: "#fff", borderColor: "var(--rose)" } : {}}
                onClick={handleSubmitDecision}
                disabled={submittingDecision}
              >
                {submittingDecision ? "Submitting..." : `Confirm ${confirmAction}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------------------
          DETAILS & CHANGE LEAVE TYPE MODAL
          ----------------------------------------------------------------------- */}
      {selectedRequest && !confirmAction && (
        <div className="modal-overlay" onClick={() => setSelectedRequest(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>Leave Request Details</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSelectedRequest(null)}
                aria-label="Close"
              >
                <IconClose size={14} />
              </button>
            </div>

            {changeTypeSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{changeTypeSuccess}</div>}
            {changeTypeError && <div className="error" style={{ marginBottom: 14 }}>{changeTypeError}</div>}

            <div style={{ padding: "8px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div className="lm-req-avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                  {getInitials(selectedRequest.employeeId?.fullName)}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{selectedRequest.employeeId?.fullName}</h3>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {selectedRequest.employeeId?.job?.jobTitle || "Team Member"} • {selectedRequest.employeeId?.job?.department || "General"}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={{ background: "var(--panel)", padding: "10px 12px", borderRadius: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Leave Type</span>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{selectedRequest.leaveTypeCode}</div>
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 12px", borderRadius: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Status</span>
                  <div style={{ marginTop: 2 }}><StatusBadge status={selectedRequest.status} /></div>
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 12px", borderRadius: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Duration</span>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{selectedRequest.calculatedDays || 1} Day(s)</div>
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 12px", borderRadius: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Dates</span>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                    {formatDate(selectedRequest.startDate)} - {formatDate(selectedRequest.endDate)}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Reason for Leave</span>
                <div style={{ padding: "10px 12px", background: "var(--panel)", borderRadius: 8, marginTop: 4, fontSize: 13, fontStyle: "italic" }}>
                  "{selectedRequest.reason || "No reason specified."}"
                </div>
              </div>

              {/* Change Leave Type Form for APPROVED requests */}
              {selectedRequest.status === "APPROVED" && (
                <div style={{ borderTop: "1px solid var(--hair)", paddingTop: 16, marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setShowChangeTypeForm((prev) => !prev)}
                    style={{ marginBottom: 12 }}
                  >
                    {showChangeTypeForm ? "Cancel Leave Type Adjustment" : "Adjust / Change Leave Type"}
                  </button>

                  {showChangeTypeForm && (
                    <div style={{ background: "var(--panel)", padding: "14px", borderRadius: 8 }}>
                      <label style={{ display: "block", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Select New Leave Type:</span>
                        <select
                          value={selectedNewType}
                          onChange={(e) => setSelectedNewType(e.target.value)}
                          className="filter-select"
                          style={{ width: "100%", marginTop: 4 }}
                        >
                          <option value="">-- Choose Type --</option>
                          {availableLeaveTypes
                            .filter((t) => t.code !== selectedRequest.leaveTypeCode)
                            .map((t) => (
                              <option key={t.code} value={t.code}>
                                {t.name || t.code}
                              </option>
                            ))}
                        </select>
                      </label>

                      <label style={{ display: "block", marginBottom: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Reason for Adjustment:</span>
                        <input
                          value={changeTypeReason}
                          onChange={(e) => setChangeTypeReason(e.target.value)}
                          placeholder="e.g. Employee requested change from Casual to Sick leave"
                          className="search-input"
                          style={{ width: "100%", marginTop: 4 }}
                        />
                      </label>

                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={handleChangeLeaveType}
                        disabled={submittingChangeType || !selectedNewType || !changeTypeReason.trim()}
                      >
                        {submittingChangeType ? "Updating..." : "Save Leave Type Change"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setSelectedRequest(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

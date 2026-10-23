import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import { IconClose, IconCheck, IconRefresh, IconArrowLeft, IconArrowRight } from "../components/Icons";
import api from "../services/api";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const LEAVE_TYPE_OPTIONS = [
  { value: "ALL", label: "All Types" },
  { value: "CASUAL", label: "Casual" },
  { value: "SICK", label: "Sick" },
  { value: "EARNED", label: "Earned" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function AdminLeaveManagement() {
  const [searchParams] = useSearchParams();
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
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
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

  useEffect(() => {
    fetchLeaveData();
  }, [page, limit, statusFilter, typeFilter, debouncedSearch, fromDateFilter, toDateFilter]);

  // Live Cross-Portal Synchronization via SSE & visibility-aware background sync
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
            // Live update of HR pending queue and summary counters without manual page refresh
            fetchLeaveData(true);
          }
        } catch {
          // ignore non-json
        }
      };
      eventSource.onerror = () => {
        // Browser reconnects automatically
      };
    } catch {
      // EventSource fallback
    }

    // Visibility-aware background polling & window focus sync
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        fetchLeaveData(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchLeaveData(true);
      }
    }, 10000);

    return () => {
      if (eventSource) eventSource.close();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      clearInterval(intervalId);
    };
  }, [page, limit, statusFilter, typeFilter, debouncedSearch, fromDateFilter, toDateFilter]);

  // Open details modal
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
      // Non-blocking fallback to row data
      console.warn("Could not fetch full details, using table data", err);
    } finally {
      setRequestDetailsLoading(false);
    }
  };

  // Submit decision (APPROVE or REJECT)
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
    } catch (err) {
      setDecisionError(
        err.response?.data?.message || `Failed to ${confirmAction.toLowerCase()} leave request.`
      );
    } finally {
      setSubmittingDecision(false);
    }
  };

  // Submit leave type change (HR action on APPROVED request)
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
        const successMsg = res.data.message || "Leave type changed successfully.";
        setChangeTypeSuccess(successMsg);
        setActionSuccess(successMsg);
        setShowChangeTypeForm(false);
        setConfirmChangeType(false);
        setSelectedNewType("");
        setChangeTypeReason("");

        // Immediately update item in table
        setRequests((prev) =>
          prev.map((r) =>
            r._id === selectedRequest._id ? { ...r, leaveTypeCode: updated.leaveTypeCode } : r
          )
        );

        await fetchLeaveData(true);
      }
    } catch (err) {
      setChangeTypeError(
        err.response?.data?.message || "Failed to change leave type. Please try again."
      );
    } finally {
      setSubmittingChangeType(false);
    }
  };

  const handleClearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("ALL");
    setTypeFilter("ALL");
    setFromDateFilter("");
    setToDateFilter("");
    setPage(1);
  };

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="Leave" />

      {/* Action alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconCheck size={16} />
            <span>{actionSuccess}</span>
          </span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss alert">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss alert">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* SUMMARY STATS CARDS */}
      <div className="stats-grid">
        <div
          className="stat-card"
          style={{ cursor: "pointer", borderLeft: statusFilter === "PENDING" ? "4px solid #b45309" : undefined }}
          onClick={() => {
            setStatusFilter("PENDING");
            setPage(1);
          }}
          title="Click to view pending requests"
        >
          <span className="stat-label">Pending</span>
          <div className="stat-value" style={{ color: "#b45309" }}>{summary.pending}</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: "pointer", borderLeft: statusFilter === "APPROVED" ? "4px solid #15803d" : undefined }}
          onClick={() => {
            setStatusFilter("APPROVED");
            setPage(1);
          }}
          title="Click to view approved requests"
        >
          <span className="stat-label">Approved</span>
          <div className="stat-value" style={{ color: "#15803d" }}>{summary.approved}</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: "pointer", borderLeft: statusFilter === "REJECTED" ? "4px solid #b91c1c" : undefined }}
          onClick={() => {
            setStatusFilter("REJECTED");
            setPage(1);
          }}
          title="Click to view rejected requests"
        >
          <span className="stat-label">Rejected</span>
          <div className="stat-value" style={{ color: "#b91c1c" }}>{summary.rejected}</div>
        </div>

        <div className="stat-card highlight">
          <span className="stat-label">On Leave Today</span>
          <div className="stat-value" style={{ color: "#09090b" }}>{summary.onLeaveToday}</div>
        </div>
      </div>

      {/* TOOLBAR & FILTERS */}
      <div
        className="toolbar"
        style={{
          background: "#ffffff",
          padding: "16px 20px",
          borderRadius: 12,
          border: "1px solid #e4e4e7",
          marginBottom: 20,
        }}
      >
        <div className="toolbar-left" style={{ flexWrap: "wrap", gap: 10 }}>
          {/* Search Input */}
          <div style={{ position: "relative", minWidth: 260 }}>
            <input
              type="text"
              className="search-input"
              placeholder="Search by name, email, or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", paddingLeft: 34 }}
            />
            <svg
              style={{ position: "absolute", left: 10, top: 11, color: "#71717a" }}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {/* Status Filter */}
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Leave Type Filter */}
          <select
            className="filter-select"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            {filterLeaveTypes.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Date range filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="date"
              className="filter-select"
              title="From date filter"
              value={fromDateFilter}
              onChange={(e) => {
                setFromDateFilter(e.target.value);
                setPage(1);
              }}
              style={{ fontSize: 13, padding: "7px 10px" }}
            />
            <span style={{ color: "#71717a", fontSize: 12 }}>to</span>
            <input
              type="date"
              className="filter-select"
              title="To date filter"
              value={toDateFilter}
              onChange={(e) => {
                setToDateFilter(e.target.value);
                setPage(1);
              }}
              style={{ fontSize: 13, padding: "7px 10px" }}
            />
          </div>

          {(search || statusFilter !== "ALL" || typeFilter !== "ALL" || fromDateFilter || toDateFilter) && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleClearFilters}
              title="Reset all search and filter conditions"
            >
              Clear Filters
            </button>
          )}
        </div>

        <div className="toolbar-right">
          <label style={{ fontSize: 13, color: "#71717a", display: "flex", alignItems: "center", gap: 6 }}>
            Show:
            <select
              className="filter-select"
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="error" style={{ textAlign: "center", padding: 24, marginBottom: 20 }}>
          <p style={{ margin: "0 0 14px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={fetchLeaveData}>
            Retry Loading Requests
          </button>
        </div>
      )}

      {/* TABLE SECTION */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#71717a", fontSize: 14 }}>Loading leave requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#71717a" }}>
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a1a1aa"
              strokeWidth="1.5"
              style={{ margin: "0 auto 12px", display: "block" }}
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <h4 style={{ margin: "0 0 6px", fontSize: 16, color: "#09090b" }}>No leave requests found</h4>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              {statusFilter !== "ALL" || search || fromDateFilter || toDateFilter
                ? "No requests match your filters."
                : "No leave requests submitted yet."}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Employee</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Leave Type</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Dates</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Duration</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Reason</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Submitted</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr
                    key={item._id}
                    style={{
                      borderBottom: "1px solid #f4f4f5",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Employee code & name */}
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 600, color: "#09090b" }}>{item.employeeName}</div>
                      <div style={{ fontSize: 12, color: "#71717a" }}>
                        {item.employeeCode} • {item.department}
                      </div>
                    </td>

                    {/* Leave Type */}
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#f4f4f5",
                          color: "#18181b",
                          border: "1px solid #e4e4e7",
                        }}
                      >
                        {item.leaveTypeCode}
                      </span>
                    </td>

                    {/* Dates */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 500, color: "#09090b" }}>{item.fromDate}</div>
                      <div style={{ fontSize: 12, color: "#71717a" }}>to {item.toDate}</div>
                    </td>

                    {/* Calculated leave duration */}
                    <td style={{ padding: "14px 16px", fontWeight: 600 }}>
                      {item.daysCount} {item.daysCount === 1 ? "day" : "days"}
                    </td>

                    {/* Reason preview */}
                    <td style={{ padding: "14px 16px", maxWidth: 220 }}>
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          color: "#52525b",
                        }}
                        title={item.reason}
                      >
                        {item.reason || "--"}
                      </div>
                    </td>

                    {/* Submission Date */}
                    <td style={{ padding: "14px 16px", color: "#71717a", fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "--"}
                    </td>

                    {/* Current Status */}
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <StatusBadge status={item.status} />
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "14px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button
                          type="button"
                          className="btn-sm btn-secondary"
                          onClick={() => handleOpenDetails(item)}
                          title="View complete request details"
                        >
                          Review
                        </button>

                        {item.status === "PENDING" && (
                          <>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => {
                                handleOpenDetails(item);
                                setConfirmAction("APPROVE");
                              }}
                              style={{ background: "#15803d", borderColor: "#15803d", color: "#ffffff" }}
                              title="Quick approve"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => {
                                handleOpenDetails(item);
                                setConfirmAction("REJECT");
                              }}
                              style={{ background: "#b91c1c", borderColor: "#b91c1c", color: "#ffffff" }}
                              title="Quick reject"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINATION FOOTER */}
        {!loading && requests.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 20px",
              borderTop: "1px solid #e4e4e7",
              background: "#fafafa",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: "#71717a" }}>
              Showing <strong>{(page - 1) * limit + 1}</strong> to{" "}
              <strong>{Math.min(page * limit, pagination.total)}</strong> of{" "}
              <strong>{pagination.total}</strong> leave requests
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <IconArrowLeft size={14} />
                <span>Previous</span>
              </button>

              <span style={{ fontSize: 13, color: "#52525b", padding: "0 6px" }}>
                Page <strong>{page}</strong> of <strong>{pagination.totalPages || 1}</strong>
              </span>

              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>Next</span>
                <IconArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* DETAILS & APPROVAL / REJECTION DRAWER/MODAL */}
      {selectedRequest && (
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
          onClick={() => !submittingDecision && setSelectedRequest(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 580,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, borderBottom: "1px solid #e4e4e7", paddingBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>
                  Leave Request
                </div>
                <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  {selectedRequest.employeeName || selectedRequest.employee?.fullName || "Employee Leave"}
                </h3>
                <span style={{ fontSize: 13, color: "#71717a" }}>
                  {selectedRequest.employeeCode || selectedRequest.employee?.employeeCode || "N/A"} •{" "}
                  {selectedRequest.department || selectedRequest.employee?.department || "General"}
                </span>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setSelectedRequest(null)}
                disabled={submittingDecision}
                aria-label="Close modal"
              >
                <IconClose size={14} />
              </button>
            </div>

            {decisionError && <div className="error">{decisionError}</div>}

            {/* Request Summary Details */}
            <div
              style={{
                background: "#f9fafb",
                padding: "16px",
                borderRadius: 10,
                border: "1px solid #e4e4e7",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  Leave Type
                </span>
                <div style={{ fontWeight: 700, color: "#09090b", marginTop: 2 }}>
                  {selectedRequest.leaveTypeCode}
                </div>
              </div>

              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  Duration
                </span>
                <div style={{ fontWeight: 700, color: "#09090b", marginTop: 2 }}>
                  {selectedRequest.daysCount} {selectedRequest.daysCount === 1 ? "day" : "days"}
                </div>
              </div>

              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  From Date
                </span>
                <div style={{ fontWeight: 600, color: "#09090b", marginTop: 2 }}>
                  {selectedRequest.fromDate}
                </div>
              </div>

              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  To Date
                </span>
                <div style={{ fontWeight: 600, color: "#09090b", marginTop: 2 }}>
                  {selectedRequest.toDate}
                </div>
              </div>

              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  Status
                </span>
                <div style={{ marginTop: 2 }}>
                  <StatusBadge status={selectedRequest.status} />
                </div>
              </div>

              <div>
                <span style={{ color: "#71717a", fontSize: 11.5, textTransform: "uppercase", fontWeight: 600 }}>
                  Submitted
                </span>
                <div style={{ fontSize: 12, color: "#52525b", marginTop: 2 }}>
                  {selectedRequest.createdAt ? new Date(selectedRequest.createdAt).toLocaleString() : "--"}
                </div>
              </div>
            </div>

            {/* Employee's Leave Balance Context (if fetched) */}
            {employeeBalance?.balance && (
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e4e4e7",
                  padding: "12px 14px",
                  borderRadius: 10,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", marginBottom: 8 }}>
                  Leave Balances
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
                  <div>
                    <span style={{ color: "#71717a" }}>Casual: </span>
                    <strong style={{ color: "#09090b" }}>{employeeBalance.balance.casual ?? 0} days</strong>
                  </div>
                  <div>
                    <span style={{ color: "#71717a" }}>Sick: </span>
                    <strong style={{ color: "#09090b" }}>{employeeBalance.balance.sick ?? 0} days</strong>
                  </div>
                  <div>
                    <span style={{ color: "#71717a" }}>Earned: </span>
                    <strong style={{ color: "#09090b" }}>{employeeBalance.balance.earned ?? 0} days</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Reason */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", marginBottom: 4 }}>
                Reason
              </label>
              <div
                style={{
                  padding: "10px 14px",
                  background: "#f4f4f5",
                  borderRadius: 8,
                  fontSize: 13.5,
                  color: "#09090b",
                  border: "1px solid #e4e4e7",
                }}
              >
                {selectedRequest.reason || "No written explanation provided."}
              </div>
            </div>

            {/* Previous decision info if processed */}
            {selectedRequest.status !== "PENDING" && selectedRequest.decision && (
              <div
                style={{
                  padding: "12px 14px",
                  background: selectedRequest.status === "APPROVED" ? "#f0fdf4" : "#fef2f2",
                  borderRadius: 8,
                  border: `1px solid ${selectedRequest.status === "APPROVED" ? "#bbf7d0" : "#fecaca"}`,
                  marginBottom: 16,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600, color: selectedRequest.status === "APPROVED" ? "#15803d" : "#b91c1c", marginBottom: 4 }}>
                  Decision Record: {selectedRequest.status}
                </div>
                <div style={{ color: "#52525b", fontSize: 12 }}>
                  Decided by: <strong>{selectedRequest.decision.decidedBy || "HR Admin"}</strong> on{" "}
                  {selectedRequest.decision.decidedAt ? new Date(selectedRequest.decision.decidedAt).toLocaleString() : "--"}
                </div>
                {selectedRequest.decision.remarks && (
                  <div style={{ marginTop: 6, fontStyle: "italic", color: "#3f3f46" }}>
                    Remarks: "{selectedRequest.decision.remarks}"
                  </div>
                )}
              </div>
            )}

            {/* PENDING Decision Form & Actions */}
            {selectedRequest.status === "PENDING" && (
              <div style={{ marginTop: 18, borderTop: "1px solid #e4e4e7", paddingTop: 16 }}>
                {!confirmAction ? (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setSelectedRequest(null)}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction("REJECT")}
                      style={{ background: "#b91c1c", borderColor: "#b91c1c", color: "#ffffff" }}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmAction("APPROVE")}
                      style={{ background: "#15803d", borderColor: "#15803d", color: "#ffffff" }}
                    >
                      Approve
                    </button>
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: confirmAction === "APPROVE" ? "#f0fdf4" : "#fef2f2",
                        border: `1px solid ${confirmAction === "APPROVE" ? "#bbf7d0" : "#fecaca"}`,
                        marginBottom: 12,
                        fontSize: 13,
                        fontWeight: 600,
                        color: confirmAction === "APPROVE" ? "#15803d" : "#b91c1c",
                      }}
                    >
                      Are you sure you want to {confirmAction === "APPROVE" ? "approve" : "reject"} this leave request?
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#09090b", marginBottom: 6 }}>
                        Remarks (Optional)
                      </label>
                      <textarea
                        rows="2"
                        className="filter-select"
                        placeholder="Add notes for the employee..."
                        value={decisionRemarks}
                        onChange={(e) => setDecisionRemarks(e.target.value)}
                        style={{ width: "100%", padding: "8px 12px", fontFamily: "inherit" }}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setConfirmAction(null)}
                        disabled={submittingDecision}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitDecision}
                        disabled={submittingDecision}
                        style={{
                          background: confirmAction === "APPROVE" ? "#15803d" : "#b91c1c",
                          borderColor: confirmAction === "APPROVE" ? "#15803d" : "#b91c1c",
                          color: "#ffffff",
                        }}
                      >
                        {submittingDecision
                          ? "Saving..."
                          : (confirmAction === "APPROVE" ? "Approve" : "Reject")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* APPROVED: Change Leave Type Action */}
            {selectedRequest.status === "APPROVED" && (
              <div
                style={{
                  marginTop: 18,
                  borderTop: "1px solid #e4e4e7",
                  paddingTop: 16,
                }}
              >
                {changeTypeSuccess && (
                  <div className="success-alert" style={{ marginBottom: 12, padding: "8px 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    <IconCheck size={14} />
                    <span>{changeTypeSuccess}</span>
                  </div>
                )}
                {changeTypeError && (
                  <div className="error" style={{ marginBottom: 12, padding: "8px 12px", fontSize: 13 }}>
                    {changeTypeError}
                  </div>
                )}

                {!showChangeTypeForm ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12.5, color: "#71717a" }}>
                      Need to reclassify this approved leave (e.g. Casual to Sick)?
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setSelectedRequest(null)}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        id="btn-change-leave-type"
                        className="btn-primary"
                        onClick={() => {
                          setShowChangeTypeForm(true);
                          setChangeTypeError("");
                          setChangeTypeSuccess("");
                          setConfirmChangeType(false);
                          const firstOther = availableLeaveTypes.find(
                            (t) => t.code !== selectedRequest.leaveTypeCode
                          );
                          setSelectedNewType(firstOther?.code || "");
                        }}
                        style={{
                          background: "#0284c7",
                          borderColor: "#0284c7",
                          color: "#ffffff",
                          fontSize: 13,
                          padding: "6px 14px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <IconRefresh size={14} />
                        <span>Change Leave Type</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      padding: "16px 18px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                        Change Approved Leave Type
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#e2e8f0",
                          color: "#475569",
                          fontWeight: 600,
                        }}
                      >
                        HR Admin Authorization
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>
                          Current Leave Type
                        </label>
                        <div
                          style={{
                            padding: "8px 12px",
                            background: "#e2e8f0",
                            borderRadius: 6,
                            fontWeight: 700,
                            color: "#334155",
                            fontSize: 13,
                          }}
                        >
                          {selectedRequest.leaveTypeCode}
                        </div>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#0284c7", textTransform: "uppercase", marginBottom: 4 }}>
                          New Leave Type *
                        </label>
                        <select
                          id="select-new-leave-type"
                          value={selectedNewType}
                          onChange={(e) => {
                            setSelectedNewType(e.target.value);
                            setConfirmChangeType(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#ffffff",
                          }}
                        >
                          <option value="">-- Select New Type --</option>
                          {availableLeaveTypes
                            .filter((t) => t.code !== selectedRequest.leaveTypeCode)
                            .map((t) => (
                              <option key={t.code} value={t.code}>
                                {t.name} ({t.code})
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                        Reason for Change *
                      </label>
                      <textarea
                        id="input-change-type-reason"
                        rows="2"
                        className="filter-select"
                        placeholder="Reason for changing the leave type..."
                        value={changeTypeReason}
                        onChange={(e) => {
                          setChangeTypeReason(e.target.value);
                          setConfirmChangeType(false);
                        }}
                        style={{ width: "100%", padding: "8px 12px", fontFamily: "inherit", fontSize: 13 }}
                      />
                    </div>

                    {confirmChangeType ? (
                      <div
                        style={{
                          padding: "10px 14px",
                          borderRadius: 8,
                          background: "#fef3c7",
                          border: "1px solid #fde68a",
                          marginBottom: 12,
                          fontSize: 12.5,
                          color: "#92400e",
                        }}
                      >
                        <strong>Please confirm:</strong> You are changing this leave from{" "}
                        <span style={{ textDecoration: "line-through" }}>{selectedRequest.leaveTypeCode}</span> to{" "}
                        <strong>{selectedNewType}</strong>. Leave balances will be updated.
                      </div>
                    ) : null}

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setShowChangeTypeForm(false);
                          setConfirmChangeType(false);
                          setChangeTypeError("");
                        }}
                        disabled={submittingChangeType}
                      >
                        Cancel
                      </button>

                      {!confirmChangeType ? (
                        <button
                          type="button"
                          id="btn-confirm-stage-leave-type"
                          onClick={() => {
                            if (!selectedNewType) {
                              setChangeTypeError("Please select a new leave type.");
                              return;
                            }
                            if (!changeTypeReason.trim()) {
                              setChangeTypeError("Please enter a reason for the change.");
                              return;
                            }
                            setChangeTypeError("");
                            setConfirmChangeType(true);
                          }}
                          style={{
                            background: "#0284c7",
                            borderColor: "#0284c7",
                            color: "#ffffff",
                            fontSize: 13,
                            padding: "6px 14px",
                          }}
                        >
                          Continue
                        </button>
                      ) : (
                        <button
                          type="button"
                          id="btn-save-changed-leave-type"
                          onClick={handleChangeLeaveType}
                          disabled={submittingChangeType}
                          style={{
                            background: "#15803d",
                            borderColor: "#15803d",
                            color: "#ffffff",
                            fontSize: 13,
                            padding: "6px 16px",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {submittingChangeType ? (
                            "Saving..."
                          ) : (
                            <>
                              <IconCheck size={14} />
                              <span>Save Change</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* REJECTED: Close action */}
            {selectedRequest.status === "REJECTED" && (
              <div style={{ marginTop: 18, borderTop: "1px solid #e4e4e7", paddingTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSelectedRequest(null)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

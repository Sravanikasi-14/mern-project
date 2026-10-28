import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconInfo,
  IconSearch,
} from "../components/Icons";
import Pagination, { useClientPagination } from "../components/Pagination";
import api from "../services/api";
import "./WorkManagement.css";

const PERIOD_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
];

export default function AdminImpactPoints() {
  const [activeTab, setActiveTab] = useState("LEADERBOARD"); // 'LEADERBOARD' | 'LEDGER'
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [periodFilter, setPeriodFilter] = useState("all");

  // Ledger state
  const [transactions, setTransactions] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [searchLedger, setSearchLedger] = useState("");
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 1 });
  const leaderboardPager = useClientPagination(leaderboard, 10);

  // Metadata
  const [meta, setMeta] = useState({
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  });

  // In-layout Right Side Panel Mode: 'none' | 'recognize' | 'reverse'
  const [sidePanelMode, setSidePanelMode] = useState("none");

  // Reversal state
  const [selectedTx, setSelectedTx] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reversalError, setReversalError] = useState("");

  // Recognition state
  const [recognizeForm, setRecognizeForm] = useState({
    recipientId: "",
    points: 10,
    reason: "",
  });
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState("");

  // Fetch Metadata
  useEffect(() => {
    let cancelled = false;
    async function fetchMeta() {
      try {
        const res = await api.get("/tasks/meta");
        if (!cancelled && res.data?.success) {
          const metaData = res.data?.data || res.data || {};
          setMeta({
            userRole: metaData.userRole || "",
            isManager: Boolean(metaData.isManager),
            directReportsCount: metaData.directReportsCount || 0,
            assignableEmployees: Array.isArray(metaData.assignableEmployees)
              ? metaData.assignableEmployees
              : [],
            departments: Array.isArray(metaData.departments) ? metaData.departments : [],
          });
        }
      } catch (err) {
        console.error("Failed to load metadata:", err);
      }
    }
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch Leaderboard
  const fetchLeaderboard = async () => {
    try {
      setLeaderboardLoading(true);
      setError("");
      const params = {};
      if (departmentFilter !== "ALL") params.department = departmentFilter;
      if (periodFilter !== "all") params.period = periodFilter;

      const res = await api.get("/impact-points/leaderboard", { params });
      if (res.data?.success) {
        const list =
          res.data?.leaderboard ||
          res.data?.data?.leaderboard ||
          (Array.isArray(res.data?.data) ? res.data.data : []);
        setLeaderboard(Array.isArray(list) ? list : []);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load leaderboard");
    } finally {
      setLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "LEADERBOARD") {
      fetchLeaderboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, departmentFilter, periodFilter]);

  // Fetch Ledger Transactions
  const fetchLedger = async (page = 1, limitOverride) => {
    try {
      setLedgerLoading(true);
      setError("");
      const params = { page, limit: limitOverride || pagination.limit };
      if (typeFilter !== "ALL") params.type = typeFilter;
      if (sourceFilter !== "ALL") params.source = sourceFilter;
      if (searchLedger.trim()) params.search = searchLedger.trim();

      const res = await api.get("/impact-points/transactions", { params });
      if (res.data?.success) {
        const txList = res.data?.transactions || res.data?.data?.transactions || [];
        const pag = res.data?.pagination || res.data?.data?.pagination || {
          page: 1,
          limit: 20,
          total: txList.length,
          pages: 1,
        };
        setTransactions(Array.isArray(txList) ? txList : []);
        setPagination(pag);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load transactions");
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "LEDGER") {
      fetchLedger(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, typeFilter, sourceFilter]);

  const handleSearchLedgerSubmit = (e) => {
    e.preventDefault();
    fetchLedger(1);
  };

  // Aggregate stats from leaderboard
  const stats = useMemo(() => {
    let totalPoints = 0;
    let totalEarned = 0;
    let totalDeducted = 0;
    (leaderboard || []).forEach((item) => {
      totalPoints += item.balance || 0;
      totalEarned += item.pointsEarned || 0;
      totalDeducted += item.pointsDeducted || 0;
    });
    return {
      totalPoints,
      totalEarned,
      totalDeducted,
      participants: (leaderboard || []).length,
    };
  }, [leaderboard]);

  // Handle Recognition Submit
  const handleRecognizeSubmit = async (e) => {
    e.preventDefault();
    if (!recognizeForm.recipientId || !recognizeForm.reason.trim()) {
      setRecognizeError("Please select a recipient employee and provide a reason.");
      return;
    }

    try {
      setRecognizing(true);
      setRecognizeError("");
      const res = await api.post("/impact-points/recognize", {
        recipientEmployeeId: recognizeForm.recipientId,
        recipientId: recognizeForm.recipientId,
        points: Number(recognizeForm.points) || 10,
        reason: recognizeForm.reason.trim(),
      });

      if (res.data?.success) {
        setSuccessMsg(
          `Successfully awarded ${res.data.data?.points || res.data.transaction?.points || recognizeForm.points} Impact Points to employee.`
        );
        setRecognizeForm({ recipientId: "", points: 10, reason: "" });
        setSidePanelMode("none");
        fetchLeaderboard();
        fetchLedger(1);
      }
    } catch (err) {
      setRecognizeError(err.response?.data?.message || "Failed to submit recognition");
    } finally {
      setRecognizing(false);
    }
  };

  // Handle Reversal Submit
  const handleReverseSubmit = async (e) => {
    e.preventDefault();
    if (!reversalReason.trim()) {
      setReversalError("Reason for reversal is required.");
      return;
    }

    try {
      setReversing(true);
      setReversalError("");
      const res = await api.post(`/impact-points/transactions/${selectedTx._id}/reverse`, {
        reason: reversalReason.trim(),
      });

      if (res.data?.success) {
        setSuccessMsg("Transaction reversed successfully. Compensating ledger entry recorded.");
        setSelectedTx(null);
        setReversalReason("");
        setSidePanelMode("none");
        fetchLedger(pagination.page);
        fetchLeaderboard();
      }
    } catch (err) {
      setReversalError(err.response?.data?.message || "Failed to reverse transaction");
    } finally {
      setReversing(false);
    }
  };

  const toggleRecognizePanel = () => {
    if (sidePanelMode === "recognize") {
      setSidePanelMode("none");
    } else {
      setSelectedTx(null);
      setRecognizeError("");
      setSidePanelMode("recognize");
    }
  };

  const startReversal = (tx) => {
    setSelectedTx(tx);
    setReversalReason("");
    setReversalError("");
    setSidePanelMode("reverse");
  };

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Header */}
      <AppHeader
        title="Impact Points"
        hideLogout={true}
      >
        <button
          className={sidePanelMode === "recognize" ? "wm-btn-secondary" : "wm-btn-primary"}
          onClick={toggleRecognizePanel}
          style={{ whiteSpace: "nowrap" }}
        >
          {sidePanelMode === "recognize" ? "Cancel Recognition" : "+ Recognize Employee"}
        </button>
      </AppHeader>

      {/* Notifications */}
      {(error || successMsg) && (
        <div className="split-page-alerts">
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <IconAlertCircle size={18} />
              <span>{error}</span>
              <button className="btn-icon" onClick={() => setError("")} style={{ marginLeft: "auto" }}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          {successMsg && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <IconCheck size={18} />
              <span>{successMsg}</span>
              <button className="btn-icon" onClick={() => setSuccessMsg("")} style={{ marginLeft: "auto" }}>
                <IconClose size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Compact Inline Impact Statistics Strip */}
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
          Circulation: <strong style={{ color: "#2563eb" }}>{stats.totalPoints} pts</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Total Earned: <strong style={{ color: "#059669" }}>+{stats.totalEarned} pts</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Deductions: <strong style={{ color: "#dc2626" }}>-{stats.totalDeducted} pts</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Participants: <strong style={{ color: "var(--ink)" }}>{stats.participants}</strong>
        </span>
      </div>

      {/* Main Responsive Grid Layout (Resizes dynamically when right side panel opens) */}
      <div
        className="split-page-grid wm-split-grid"
        style={{
          gridTemplateColumns: sidePanelMode !== "none" ? "minmax(0, 1fr) minmax(360px, 420px)" : "1fr",
        }}
      >
        {/* Left Column: Tables and Toolbars */}
        <div className="split-page-left-col wm-left-col">
          {/* Navigation & Filters Toolbar Card */}
          <div className="wm-toolbar-card">
            {/* Tab Selection Row */}
            <div className="wm-tab-strip">
              <div className="wm-tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab("LEADERBOARD")}
                  className={`wm-tab-btn ${activeTab === "LEADERBOARD" ? "active" : ""}`}
                >
                  Leaderboard
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("LEDGER")}
                  className={`wm-tab-btn ${activeTab === "LEDGER" ? "active" : ""}`}
                >
                  Transaction History
                </button>
              </div>

              <div className="wm-tab-count">
                {activeTab === "LEADERBOARD"
                  ? `${leaderboard.length} ranked employee${leaderboard.length === 1 ? "" : "s"}`
                  : `${pagination.total} transaction${pagination.total === 1 ? "" : "s"} logged`}
              </div>
            </div>

            {/* Tab-Specific Filters */}
            {activeTab === "LEADERBOARD" && (
              <div className="wm-filter-row">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Department:</span>
                  <select
                    className="wm-select"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    style={{ minWidth: 160 }}
                  >
                    <option value="ALL">All Departments</option>
                    {(meta?.departments || []).map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Timeframe:</span>
                  <div style={{ display: "flex", gap: 3, background: "#e2e8f0", padding: 3, borderRadius: 8 }}>
                    {PERIOD_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPeriodFilter(opt.value)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          border: "none",
                          background: periodFilter === opt.value ? "#ffffff" : "transparent",
                          color: periodFilter === opt.value ? "#2563eb" : "#475569",
                          boxShadow: periodFilter === opt.value ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "LEDGER" && (
              <div className="wm-filter-row">
                <form onSubmit={handleSearchLedgerSubmit} className="wm-search-wrapper">
                  <span className="wm-search-icon">
                    <IconSearch size={15} />
                  </span>
                  <input
                    type="text"
                    className="wm-input-search"
                    placeholder="Search reason or employee..."
                    value={searchLedger}
                    onChange={(e) => setSearchLedger(e.target.value)}
                  />
                </form>

                <div className="wm-filter-group">
                  <select
                    className="wm-select"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="ALL">Type: All</option>
                    <option value="EARNED">Earned (+)</option>
                    <option value="DEDUCTED">Deducted (-)</option>
                    <option value="REVERSAL">Reversals</option>
                  </select>

                  <select
                    className="wm-select"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                  >
                    <option value="ALL">Source: All</option>
                    <option value="AUTOMATIC_TASK">Automatic Task</option>
                    <option value="MANAGER_RECOGNITION">Recognition</option>
                    <option value="MANUAL_HR">Manual HR</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Table Container Card */}
          <div className="wm-table-card">
            {activeTab === "LEADERBOARD" && (
              <div className="wm-table-container">
                <table className="wm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Rank</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th style={{ textAlign: "right" }}>Earned</th>
                      <th style={{ textAlign: "right" }}>Deductions</th>
                      <th style={{ textAlign: "right" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardLoading ? (
                      <TableSkeletonRows cols={6} rows={5} />
                    ) : leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="wm-empty-state">
                            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", marginBottom: 6 }}>
                              <IconInfo size={22} />
                            </div>
                            <h4 className="wm-empty-title">No Leaderboard Entries</h4>
                            <p className="wm-empty-desc">
                              Points will accumulate when tasks are completed or recognitions awarded.
                            </p>
                            <button
                              type="button"
                              className="wm-btn-secondary"
                              style={{ marginTop: 10 }}
                              onClick={() => setSidePanelMode("recognize")}
                            >
                              + Recognize Employee
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      leaderboardPager.slice.map((row) => (
                        <tr key={row.employeeId}>
                          <td>
                            <span
                              className={`wm-rank-badge ${
                                row.rank === 1
                                  ? "wm-rank-1"
                                  : row.rank === 2
                                  ? "wm-rank-2"
                                  : row.rank === 3
                                  ? "wm-rank-3"
                                  : "wm-rank-neutral"
                              }`}
                            >
                              {row.rank}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{row.name || row.fullName || "Employee"}</div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{row.employeeCode}</div>
                          </td>
                          <td style={{ color: "#475569", fontSize: 12 }}>
                            {row.department || "General"}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#059669" }}>
                            +{row.pointsEarned ?? row.totalEarned ?? 0}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: row.pointsDeducted > 0 ? "#dc2626" : "#94a3b8" }}>
                            {row.pointsDeducted > 0 ? `-${row.pointsDeducted}` : "0"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className="wm-balance-pill">
                              {row.balance ?? row.totalPoints ?? ((row.pointsEarned || 0) - (row.pointsDeducted || 0))} pts
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <Pagination
                  currentPage={leaderboardPager.page}
                  totalPages={leaderboardPager.totalPages}
                  totalItems={leaderboardPager.total}
                  pageSize={leaderboardPager.pageSize}
                  onPageChange={leaderboardPager.setPage}
                  onPageSizeChange={leaderboardPager.setPageSize}
                  itemLabel="employees"
                />
              </div>
            )}

            {activeTab === "LEDGER" && (
              <div className="wm-table-container">
                <table className="wm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Timestamp</th>
                      <th>Employee</th>
                      <th style={{ width: 120 }}>Points</th>
                      <th style={{ width: 130 }}>Source</th>
                      <th>Reason</th>
                      <th style={{ width: 140 }}>Actor</th>
                      <th style={{ width: 90, textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerLoading ? (
                      <TableSkeletonRows cols={7} rows={5} />
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="wm-empty-state">
                            <div className="wm-empty-icon">
                              <IconInfo size={22} />
                            </div>
                            <div className="wm-empty-title">No Transactions Recorded</div>
                            <p className="wm-empty-desc">
                              Activity will appear as tasks are approved or points awarded.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr
                          key={tx._id}
                          className={selectedTx?._id === tx._id ? "selected-row" : ""}
                        >
                          <td style={{ color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>
                              {tx.employee?.name || tx.employeeSnapshot?.fullName || "Employee"}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {tx.employee?.employeeCode || tx.employeeSnapshot?.employeeCode || ""}
                            </div>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: tx.points > 0 ? "#059669" : tx.points < 0 ? "#dc2626" : "#64748b",
                              }}
                            >
                              {tx.points > 0 ? `+${tx.points}` : tx.points} pts
                            </span>
                            <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700 }}>
                              {tx.transactionType}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: "#f1f5f9",
                                color: "#334155",
                              }}
                            >
                              {tx.source}
                            </span>
                          </td>
                          <td style={{ color: "#334155", fontSize: 12, maxWidth: 240 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tx.reason}>
                              {tx.reason}
                            </div>
                          </td>
                          <td style={{ color: "#475569", fontSize: 12, whiteSpace: "nowrap" }}>
                            {tx.actor?.name || tx.actorSnapshot?.fullName || tx.actorSnapshot?.email || "System"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {tx.transactionType !== "REVERSAL" && (
                              <button
                                onClick={() => startReversal(tx)}
                                className="wm-btn-table-action"
                                style={{
                                  color: "#dc2626",
                                  borderColor: "#fecaca",
                                  background: "#fef2f2",
                                }}
                              >
                                Reverse
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "LEDGER" && (
              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.pages}
                totalItems={pagination.total}
                pageSize={pagination.limit}
                onPageChange={(p) => fetchLedger(p)}
                onPageSizeChange={(s) => {
                  setPagination((prev) => ({ ...prev, limit: s, page: 1 }));
                  fetchLedger(1, s);
                }}
                itemLabel="transactions"
              />
            )}
          </div>
        </div>

        {/* Right Column: Persistent In-Layout Side Panel (No modal backdrop) */}
        {sidePanelMode !== "none" && (
          <div className="split-page-panel wm-side-panel">
            {/* Panel Mode: Recognize Employee */}
            {sidePanelMode === "recognize" && (
              <>
                <div className="wm-panel-header">
                  <div>
                    <h3 className="wm-panel-title">
                      Award Recognition
                    </h3>
                  </div>
                  <button
                    className="wm-panel-close-btn"
                    onClick={() => setSidePanelMode("none")}
                    aria-label="Close form"
                  >
                    <IconClose size={16} />
                  </button>
                </div>

                {recognizeError && (
                  <div className="alert alert-danger" style={{ margin: "14px 20px 0", padding: "10px 14px", fontSize: 13 }}>
                    <IconAlertCircle size={16} />
                    <span>{recognizeError}</span>
                  </div>
                )}

                <form onSubmit={handleRecognizeSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  <div className="wm-panel-body">
                    <div className="wm-form-group">
                      <label className="wm-form-label">
                        Recipient Employee <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <select
                        required
                        className="wm-select"
                        value={recognizeForm.recipientId}
                        onChange={(e) =>
                          setRecognizeForm({ ...recognizeForm, recipientId: e.target.value })
                        }
                      >
                        <option value="">Select recipient...</option>
                        {(meta?.assignableEmployees || []).map((emp) => (
                          <option key={emp._id} value={emp._id}>
                            {emp.fullName || emp.name} ({emp.employeeCode}) — {emp.job?.department || emp.department || "General"}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="wm-form-group">
                      <label className="wm-form-label">
                        Points to Award (1 to 50) <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        required
                        className="wm-form-input"
                        value={recognizeForm.points}
                        onChange={(e) =>
                          setRecognizeForm({ ...recognizeForm, points: e.target.value })
                        }
                      />
                      <div className="wm-form-hint">
                        Standard recognition is 10 points. Maximum allowed per award is 50.
                      </div>
                    </div>

                    <div className="wm-form-group">
                      <label className="wm-form-label">
                        Reason / Citation <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <textarea
                        rows={4}
                        required
                        className="wm-form-textarea"
                        placeholder="Detail the initiative, team support, or delivery..."
                        value={recognizeForm.reason}
                        onChange={(e) =>
                          setRecognizeForm({ ...recognizeForm, reason: e.target.value })
                        }
                      />
                    </div>

                    <div
                      style={{
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: 8,
                        padding: "12px 14px",
                        fontSize: 12,
                        color: "#1e40af",
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>Policy Notice:</strong> Self-awards are blocked. All awarded points are permanently tracked toward your monthly recognition quota and visible on the public leaderboard.
                    </div>
                  </div>

                  <div className="wm-panel-footer">
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={() => setSidePanelMode("none")}
                      disabled={recognizing}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="wm-btn-primary" disabled={recognizing}>
                      {recognizing ? "Submitting..." : "Grant Points"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* Panel Mode: Reverse Transaction */}
            {sidePanelMode === "reverse" && selectedTx && (
              <>
                <div className="wm-panel-header">
                  <div>
                    <h3 className="wm-panel-title" style={{ color: "#b91c1c" }}>
                      Reverse Transaction
                    </h3>
                  </div>
                  <button
                    className="wm-panel-close-btn"
                    onClick={() => {
                      setSelectedTx(null);
                      setSidePanelMode("none");
                    }}
                    aria-label="Close"
                  >
                    <IconClose size={16} />
                  </button>
                </div>

                {reversalError && (
                  <div className="alert alert-danger" style={{ margin: "14px 20px 0", padding: "10px 14px", fontSize: 13 }}>
                    <IconAlertCircle size={16} />
                    <span>{reversalError}</span>
                  </div>
                )}

                <form onSubmit={handleReverseSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                  <div className="wm-panel-body">
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, fontSize: 13 }}>
                      <div>
                        <strong style={{ color: "#334155" }}>Employee:</strong>{" "}
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>
                          {selectedTx.employee?.name || selectedTx.employeeSnapshot?.fullName || "Employee"} ({selectedTx.employee?.employeeCode || selectedTx.employeeSnapshot?.employeeCode || ""})
                        </span>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <strong style={{ color: "#334155" }}>Original Amount:</strong>{" "}
                        <span style={{ fontWeight: 700, color: selectedTx.points > 0 ? "#059669" : "#dc2626" }}>
                          {selectedTx.points > 0 ? `+${selectedTx.points}` : selectedTx.points} pts
                        </span>
                      </div>
                      <div style={{ marginTop: 6, color: "#64748b" }}>
                        <strong style={{ color: "#334155" }}>Reason:</strong> {selectedTx.reason}
                      </div>
                    </div>

                    <div className="wm-form-group">
                      <label className="wm-form-label">
                        Reason for Reversal <span style={{ color: "#ef4444" }}>*</span>
                      </label>
                      <textarea
                        rows={3}
                        required
                        className="wm-form-textarea"
                        placeholder="Explain why this transaction is being reversed..."
                        value={reversalReason}
                        onChange={(e) => setReversalReason(e.target.value)}
                      />
                    </div>

                    <div
                      style={{
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: 8,
                        padding: "12px 14px",
                        fontSize: 12,
                        color: "#92400e",
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>Audit Integrity:</strong> Original ledger records cannot be deleted. This creates an inverse entry of{" "}
                      <strong>{-selectedTx.points > 0 ? `+${-selectedTx.points}` : -selectedTx.points} pts</strong>.
                    </div>
                  </div>

                  <div className="wm-panel-footer">
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={() => {
                        setSelectedTx(null);
                        setSidePanelMode("none");
                      }}
                      disabled={reversing}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="wm-btn-primary"
                      style={{ background: "#dc2626", borderColor: "#dc2626" }}
                      disabled={reversing}
                    >
                      {reversing ? "Reversing..." : "Confirm Reversal"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

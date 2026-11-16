import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconInfo,
  IconSearch,
} from "../components/Icons";
import Pagination from "../components/Pagination";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import { AccessRestrictedInline } from "../components/AccessRestrictedNotice";
import {
  useAdminImpactLeaderboardQuery,
  useAdminImpactTransactionsQuery,
} from "../hooks/useAdminQueries";
import { useTasksMetaQuery } from "../hooks/useEmployeeQueries";
import { invalidateImpact } from "../lib/queryKeys";
import "./WorkManagement.css";
import ModuleToolbar from "../components/ModuleToolbar";
import SegmentedTabs from "../components/SegmentedTabs";

const PERIOD_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
];

export default function AdminImpactPoints() {
  const queryClient = useQueryClient();
  const { user, company } = useAuth();
  const canManageImpact = hrPortalAllows(user, company, "impact.manage");
  const [activeTab, setActiveTab] = useState("LEADERBOARD"); // 'LEADERBOARD' | 'LEDGER'
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Leaderboard filters
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [appliedLeaderboardSearch, setAppliedLeaderboardSearch] = useState("");
  const [leaderboardPage, setLeaderboardPage] = useState(1);
  const [leaderboardLimit, setLeaderboardLimit] = useState(10);

  // Ledger filters
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [searchLedger, setSearchLedger] = useState("");
  const [appliedLedgerSearch, setAppliedLedgerSearch] = useState("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerLimit, setLedgerLimit] = useState(10);

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

  const metaQuery = useTasksMetaQuery();
  const meta = metaQuery.data || {
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  };

  const leaderboardQuery = useAdminImpactLeaderboardQuery(
    {
      period: periodFilter,
      department: departmentFilter,
      page: leaderboardPage,
      limit: leaderboardLimit,
      search: appliedLeaderboardSearch,
    },
    { enabled: activeTab === "LEADERBOARD" }
  );
  const ledgerQuery = useAdminImpactTransactionsQuery(
    {
      page: ledgerPage,
      limit: ledgerLimit,
      type: typeFilter,
      source: sourceFilter,
      search: appliedLedgerSearch,
    },
    { enabled: activeTab === "LEDGER" }
  );

  const leaderboard = Array.isArray(leaderboardQuery.data?.leaderboard)
    ? leaderboardQuery.data.leaderboard
    : [];
  const leaderboardPagination = leaderboardQuery.data?.pagination || {
    page: leaderboardPage,
    limit: leaderboardLimit,
    total: leaderboard.length,
    totalPages: 1,
  };
  const leaderboardLoading = leaderboardQuery.isLoading && leaderboard.length === 0;
  const leaderboardPager = {
    slice: leaderboard,
    page: leaderboardPagination.page || leaderboardPage,
    totalPages: leaderboardPagination.totalPages || leaderboardPagination.pages || 1,
    total: leaderboardPagination.total || 0,
    pageSize: leaderboardPagination.limit || leaderboardLimit,
    setPage: setLeaderboardPage,
    setPageSize: (size) => {
      setLeaderboardLimit(size);
      setLeaderboardPage(1);
    },
  };

  const transactions = Array.isArray(ledgerQuery.data?.transactions)
    ? ledgerQuery.data.transactions
    : [];
  const pagination = ledgerQuery.data?.pagination || {
    page: ledgerPage,
    limit: ledgerLimit,
    total: transactions.length,
    pages: 1,
  };
  const ledgerLoading = ledgerQuery.isLoading && transactions.length === 0;

  useEffect(() => {
    const err = activeTab === "LEADERBOARD" ? leaderboardQuery.error : ledgerQuery.error;
    if (err) {
      setError(
        err.response?.data?.message ||
          (activeTab === "LEADERBOARD" ? "Failed to load leaderboard" : "Failed to load transactions")
      );
    } else {
      setError("");
    }
  }, [activeTab, leaderboardQuery.error, ledgerQuery.error]);

  useEffect(() => {
    setLedgerPage(1);
  }, [typeFilter, sourceFilter]);

  useEffect(() => {
    setLeaderboardPage(1);
  }, [departmentFilter, periodFilter]);

  const handleSearchLedgerSubmit = (e) => {
    e.preventDefault();
    setLedgerPage(1);
    setAppliedLedgerSearch(searchLedger);
  };

  const handleLeaderboardSearchSubmit = (e) => {
    e?.preventDefault?.();
    setLeaderboardPage(1);
    setAppliedLeaderboardSearch(leaderboardSearch);
  };

  // F71: stats from server summary (full filtered set), not the current page.
  const stats = useMemo(() => {
    const s = leaderboardQuery.data?.summary;
    if (s) {
      return {
        totalPoints: s.circulation ?? s.totalPoints ?? 0,
        totalEarned: s.totalEarned ?? 0,
        totalDeducted: s.totalDeducted ?? 0,
        participants: s.participants ?? 0,
      };
    }
    return { totalPoints: 0, totalEarned: 0, totalDeducted: 0, participants: 0 };
  }, [leaderboardQuery.data?.summary]);

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
        setLedgerPage(1);
        await invalidateImpact(queryClient);
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
        await invalidateImpact(queryClient);
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

  const recognizeAction = canManageImpact ? (
    <button
      type="button"
      className={sidePanelMode === "recognize" ? "btn-secondary" : "btn-primary"}
      onClick={toggleRecognizePanel}
    >
      {sidePanelMode === "recognize" ? "Cancel" : "Recognize"}
    </button>
  ) : (
    <AccessRestrictedInline />
  );

  // Podium: top three on the first, unfiltered page of the leaderboard.
  const topPerformers =
    leaderboardPager.page === 1 && !appliedLeaderboardSearch
      ? leaderboard.filter((row) => row.rank >= 1 && row.rank <= 3).slice(0, 3)
      : [];

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Header */}
      <AppHeader
        title="Impact Points"
        hideLogout={true}
        actions={
          <SoftRefresh
            active={Boolean(
              (activeTab === "LEADERBOARD" && leaderboardQuery.isFetching && leaderboard.length > 0) ||
                (activeTab === "LEDGER" && ledgerQuery.isFetching && transactions.length > 0)
            )}
          />
        }
        nav={
          <SegmentedTabs
            ariaLabel="Impact sections"
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { value: "LEADERBOARD", label: "Leaderboard" },
              { value: "LEDGER", label: "Transactions" },
            ]}
          />
        }
      />

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

      <div className="metric-card-row ip-metric-row" role="group" aria-label="Impact points summary">
        <button
          type="button"
          className={`metric-card ip-metric-card ip-metric--blue${
            activeTab === "LEADERBOARD" ? " is-active" : ""
          }`}
          onClick={() => setActiveTab("LEADERBOARD")}
        >
          <span className="metric-card-label">Circulation</span>
          <span className="metric-card-value">{stats.totalPoints}</span>
          <span className="metric-card-sub">Points in play · view leaderboard</span>
        </button>
        <button
          type="button"
          className={`metric-card ip-metric-card ip-metric--green${
            activeTab === "LEDGER" && typeFilter === "EARNED" ? " is-active" : ""
          }`}
          onClick={() => {
            setTypeFilter("EARNED");
            setActiveTab("LEDGER");
          }}
        >
          <span className="metric-card-label">Total earned</span>
          <span className="metric-card-value">+{stats.totalEarned}</span>
          <span className="metric-card-sub">Awards issued · view earnings</span>
        </button>
        <button
          type="button"
          className={`metric-card ip-metric-card ip-metric--red${
            activeTab === "LEDGER" && typeFilter === "DEDUCTED" ? " is-active" : ""
          }`}
          onClick={() => {
            setTypeFilter("DEDUCTED");
            setActiveTab("LEDGER");
          }}
        >
          <span className="metric-card-label">Deductions</span>
          <span className="metric-card-value">-{stats.totalDeducted}</span>
          <span className="metric-card-sub">Reversals &amp; deductions · view ledger</span>
        </button>
        <button
          type="button"
          className="metric-card ip-metric-card"
          onClick={() => {
            setActiveTab("LEADERBOARD");
            setDepartmentFilter("ALL");
            setPeriodFilter("all");
          }}
        >
          <span className="metric-card-label">Participants</span>
          <span className="metric-card-value">{stats.participants}</span>
          <span className="metric-card-sub">People on the board</span>
        </button>
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
          <div className="wm-toolbar-card wm-toolbar-card--bare">
            {activeTab === "LEADERBOARD" && (
              <ModuleToolbar
                actions={recognizeAction}
                searchValue={leaderboardSearch}
                onSearchChange={(e) => setLeaderboardSearch(e.target.value)}
                onSearchSubmit={handleLeaderboardSearchSubmit}
                onSearchClear={() => {
                  setLeaderboardSearch("");
                  setAppliedLeaderboardSearch("");
                  setLeaderboardPage(1);
                }}
                searchPlaceholder="Search name or employee ID..."
                searchAriaLabel="Search leaderboard"
                filterCount={
                  (departmentFilter !== "ALL" ? 1 : 0) +
                  (periodFilter !== "all" ? 1 : 0) +
                  (appliedLeaderboardSearch ? 1 : 0)
                }
                onFiltersClear={() => {
                  setDepartmentFilter("ALL");
                  setPeriodFilter("all");
                  setLeaderboardSearch("");
                  setAppliedLeaderboardSearch("");
                  setLeaderboardPage(1);
                }}
                filters={
                  <>
                    <label className="module-toolbar-filter-field">
                      Department
                      <select
                        className="filter-select"
                        value={departmentFilter}
                        onChange={(e) => setDepartmentFilter(e.target.value)}
                      >
                        <option value="ALL">All Departments</option>
                        {(meta?.departments || []).map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="module-toolbar-filter-field">
                      Timeframe
                      <select
                        className="filter-select"
                        value={periodFilter}
                        onChange={(e) => setPeriodFilter(e.target.value)}
                      >
                        {PERIOD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                }
              />
            )}

            {activeTab === "LEDGER" && (
              <ModuleToolbar
                actions={recognizeAction}
                searchValue={searchLedger}
                onSearchChange={(e) => setSearchLedger(e.target.value)}
                onSearchSubmit={handleSearchLedgerSubmit}
                searchPlaceholder="Search reason or employee..."
                searchAriaLabel="Search reason or employee"
                filterCount={
                  (typeFilter !== "ALL" ? 1 : 0) + (sourceFilter !== "ALL" ? 1 : 0)
                }
                onFiltersClear={() => {
                  setTypeFilter("ALL");
                  setSourceFilter("ALL");
                }}
                filters={
                  <>
                    <label className="module-toolbar-filter-field">
                      Type
                      <select
                        className="filter-select"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                      >
                        <option value="ALL">All</option>
                        <option value="EARNED">Earned (+)</option>
                        <option value="DEDUCTED">Deducted (-)</option>
                        <option value="REVERSAL">Reversals</option>
                      </select>
                    </label>
                    <label className="module-toolbar-filter-field">
                      Source
                      <select
                        className="filter-select"
                        value={sourceFilter}
                        onChange={(e) => setSourceFilter(e.target.value)}
                      >
                        <option value="ALL">All</option>
                        <option value="AUTOMATIC_TASK">Automatic Task</option>
                        <option value="MANAGER_RECOGNITION">Recognition</option>
                        <option value="MANUAL_HR">Manual HR</option>
                      </select>
                    </label>
                  </>
                }
              />
            )}
          </div>

          {/* Table Container Card */}
          <div className="wm-table-card">
            <div className="ip-section-head">
              <div>
                <h3 className="ip-section-title">
                  {activeTab === "LEADERBOARD" ? "Leaderboard" : "Transaction ledger"}
                </h3>
                <p className="ip-section-sub">
                  {activeTab === "LEADERBOARD"
                    ? "Ranked by impact points balance"
                    : "Every award, deduction and reversal"}
                </p>
              </div>
              <span className="ip-section-count">
                {activeTab === "LEADERBOARD"
                  ? `${leaderboardPager.total} ranked employee${leaderboardPager.total === 1 ? "" : "s"}`
                  : `${pagination.total} transaction${pagination.total === 1 ? "" : "s"} logged`}
              </span>
            </div>

            {activeTab === "LEADERBOARD" && topPerformers.length > 0 && (
              <div className="ip-podium" aria-label="Top performers">
                {topPerformers.map((row) => (
                  <div key={row.employeeId} className={`ip-podium-card ip-podium-${row.rank}`}>
                    <span className="ip-podium-rank">#{row.rank}</span>
                    <div className="ip-podium-body">
                      <div className="ip-podium-name">{row.name || row.fullName || "Employee"}</div>
                      <div className="ip-podium-dept">{row.department || "General"}</div>
                    </div>
                    <div className="ip-podium-score">
                      {row.balance ?? row.totalPoints ?? ((row.pointsEarned || 0) - (row.pointsDeducted || 0))}
                      <span> pts</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                            {canManageImpact && tx.transactionType !== "REVERSAL" && (
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
                currentPage={pagination.page || ledgerPage}
                totalPages={pagination.pages || 1}
                totalItems={pagination.total || transactions.length}
                pageSize={pagination.limit || ledgerLimit}
                onPageChange={(p) => setLedgerPage(p)}
                onPageSizeChange={(s) => {
                  setLedgerLimit(s);
                  setLedgerPage(1);
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

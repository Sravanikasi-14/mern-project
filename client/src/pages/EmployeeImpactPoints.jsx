import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconInfo,
} from "../components/Icons";
import api from "../services/api";
import "./WorkManagement.css";

const PERIOD_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
];

export default function EmployeeImpactPoints() {
  const [activeTab, setActiveTab] = useState("MY_HISTORY"); // 'MY_HISTORY' | 'LEADERBOARD'
  const [myPoints, setMyPoints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [periodFilter, setPeriodFilter] = useState("all");

  // Recognition state (for managers with direct reports)
  const [meta, setMeta] = useState({
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  });
  const [sidePanelMode, setSidePanelMode] = useState("none"); // 'none' | 'recognize'
  const [recognizeForm, setRecognizeForm] = useState({
    recipientId: "",
    points: 10,
    reason: "",
  });
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState("");

  // Fetch Meta and My Points
  useEffect(() => {
    let cancelled = false;
    async function loadInitialData() {
      try {
        setLoading(true);
        const [metaRes, myRes] = await Promise.all([
          api.get("/tasks/meta"),
          api.get("/impact-points/me"),
        ]);

        if (!cancelled) {
          if (metaRes.data?.success) {
            const metaData = metaRes.data?.data || metaRes.data || {};
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
          if (myRes.data?.success) {
            const summaryData = myRes.data?.summary || myRes.data?.data || myRes.data || null;
            setMyPoints(summaryData);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load impact points profile");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch Leaderboard
  const fetchLeaderboard = async () => {
    try {
      setLeaderboardLoading(true);
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

  // Handle Recognition Submit
  const handleRecognizeSubmit = async (e) => {
    e.preventDefault();
    if (!recognizeForm.recipientId || !recognizeForm.reason.trim()) {
      setRecognizeError("Please select a colleague and state a reason.");
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
          `Successfully awarded ${res.data.data?.points || res.data.transaction?.points || recognizeForm.points} Impact Points to team member!`
        );
        setRecognizeForm({ recipientId: "", points: 10, reason: "" });
        setSidePanelMode("none");

        // Refresh my points
        const myRes = await api.get("/impact-points/me");
        if (myRes.data?.success) {
          setMyPoints(myRes.data?.summary || myRes.data?.data || myRes.data);
        }
      }
    } catch (err) {
      setRecognizeError(err.response?.data?.message || "Failed to submit recognition");
    } finally {
      setRecognizing(false);
    }
  };

  const balance = myPoints?.balance ?? 0;
  const companyRank = myPoints?.companyRank ?? myPoints?.rankInCompany;
  const departmentRank = myPoints?.departmentRank ?? myPoints?.rankInDepartment;
  const pointsEarned = myPoints?.pointsEarned ?? myPoints?.totalEarned ?? 0;
  const pointsDeducted = myPoints?.pointsDeducted ?? myPoints?.totalDeducted ?? 0;
  const recentTransactions = myPoints?.recentTransactions || myPoints?.history || [];

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Header */}
      <AppHeader
        title="Impact Points"
        subtitle="Track your earned points balance, recognition history, and company leaderboard"
        hideLogout={true}
      >
        {meta.isManager && (
          <button
            className={sidePanelMode === "recognize" ? "wm-btn-secondary" : "wm-btn-primary"}
            onClick={() => setSidePanelMode(sidePanelMode === "recognize" ? "none" : "recognize")}
            style={{ whiteSpace: "nowrap" }}
          >
            {sidePanelMode === "recognize" ? "Cancel Recognition" : "+ Recognize Colleague"}
          </button>
        )}
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

      {/* Summary KPI Cards - Balanced 4 Column Grid */}
      <div className="wm-kpi-grid">
        <div className="wm-kpi-card accent-blue">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#2563eb" }}>Current Balance</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#2563eb" }}>
            {balance} pts
          </div>
          <div className="wm-kpi-subtext">Available net recognition balance</div>
        </div>

        <div className="wm-kpi-card accent-emerald">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#059669" }}>Lifetime Earned</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#059669" }}>
            +{pointsEarned} pts
          </div>
          <div className="wm-kpi-subtext">From tasks & peer recognitions</div>
        </div>

        <div className="wm-kpi-card accent-rose">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#dc2626" }}>Deductions / Reversals</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#dc2626" }}>
            -{pointsDeducted} pts
          </div>
          <div className="wm-kpi-subtext">Administrative adjustments</div>
        </div>

        <div className="wm-kpi-card accent-slate">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label">Standing / Rank</span>
          </div>
          <div className="wm-kpi-value" style={{ fontSize: 22 }}>
            {companyRank ? `#${companyRank} Company` : "Unranked"}
          </div>
          <div className="wm-kpi-subtext">
            {departmentRank ? `#${departmentRank} in department` : "Leaderboard standing"}
          </div>
        </div>
      </div>

      {/* Main Responsive Grid Layout (Resizes dynamically when recognition panel opens) */}
      <div
        className="split-page-grid wm-split-grid"
        style={{
          gridTemplateColumns: sidePanelMode !== "none" ? "minmax(0, 1fr) minmax(360px, 420px)" : "1fr",
        }}
      >
        {/* Left Column: Activity Ledger or Leaderboard */}
        <div className="split-page-left-col wm-left-col">
          {/* Navigation & Filters Toolbar Card */}
          <div className="wm-toolbar-card">
            <div className="wm-tab-strip">
              <div className="wm-tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab("MY_HISTORY")}
                  className={`wm-tab-btn ${activeTab === "MY_HISTORY" ? "active" : ""}`}
                >
                  My Activity Ledger
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("LEADERBOARD")}
                  className={`wm-tab-btn ${activeTab === "LEADERBOARD" ? "active" : ""}`}
                >
                  Company Leaderboard
                </button>
              </div>

              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                {activeTab === "MY_HISTORY"
                  ? `${recentTransactions.length} activity item${recentTransactions.length === 1 ? "" : "s"}`
                  : `${leaderboard.length} ranked employee${leaderboard.length === 1 ? "" : "s"}`}
              </div>
            </div>

            {/* Filter Bar (for Leaderboard) */}
            {activeTab === "LEADERBOARD" && (
              <div className="wm-filter-row">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Department:</span>
                  <select
                    className="wm-select"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    style={{ width: "auto", minWidth: 160 }}
                  >
                    <option value="ALL">All Departments</option>
                    {(meta?.departments || []).map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Timeframe:</span>
                  <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 3, borderRadius: 8 }}>
                    {PERIOD_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPeriodFilter(opt.value)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: "none",
                          background: periodFilter === opt.value ? "#ffffff" : "transparent",
                          color: periodFilter === opt.value ? "#2563eb" : "#64748b",
                          boxShadow: periodFilter === opt.value ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Table Container */}
          <div className="wm-table-card">
            {/* TAB 1: My Activity History */}
            {activeTab === "MY_HISTORY" && (
              <div className="wm-table-container">
                <table className="wm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Date</th>
                      <th style={{ width: 140 }}>Event / Source</th>
                      <th>Reason / Notes</th>
                      <th style={{ width: 140 }}>Awarder</th>
                      <th style={{ width: 120, textAlign: "right" }}>Impact Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <TableSkeletonRows cols={5} rows={4} />
                    ) : recentTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="wm-empty-state">
                            <div className="wm-empty-icon">
                              <IconInfo size={22} />
                            </div>
                            <div className="wm-empty-title">No Activity Recorded Yet</div>
                            <p className="wm-empty-desc">
                              Complete assigned tasks or collaborate with colleagues to earn verified Impact Points.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      recentTransactions.map((tx) => (
                        <tr key={tx._id}>
                          <td style={{ color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: "#f1f5f9",
                                color: "#334155",
                              }}
                            >
                              {tx.source}
                            </span>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{tx.eventType}</div>
                          </td>
                          <td style={{ color: "#334155", fontSize: 12 }}>
                            {tx.reason}
                          </td>
                          <td style={{ color: "#475569", fontSize: 12, whiteSpace: "nowrap" }}>
                            {tx.actor?.name || "System"}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: tx.points > 0 ? "#059669" : tx.points < 0 ? "#dc2626" : "#64748b",
                              }}
                            >
                              {tx.points > 0 ? `+${tx.points}` : tx.points} pts
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: Company Leaderboard */}
            {activeTab === "LEADERBOARD" && (
              <div className="wm-table-container">
                <table className="wm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Rank</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th style={{ width: 110, textAlign: "right" }}>Earned</th>
                      <th style={{ width: 130, textAlign: "right" }}>Net Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardLoading ? (
                      <TableSkeletonRows cols={5} rows={5} />
                    ) : leaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="wm-empty-state">
                            <div className="wm-empty-icon">
                              <IconInfo size={22} />
                            </div>
                            <div className="wm-empty-title">No Leaderboard Entries Found</div>
                            <p className="wm-empty-desc">
                              Activity will appear once points have been awarded.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      leaderboard.map((row) => {
                        const isMe = Boolean(
                          myPoints &&
                            (String(row.employeeId) === String(myPoints.employeeId) ||
                              (row.employeeCode && row.employeeCode === myPoints.employeeCode))
                        );
                        return (
                          <tr
                            key={row.employeeId}
                            className={isMe ? "selected-row" : ""}
                          >
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
                              <div style={{ fontWeight: 600, color: "#0f172a" }}>
                                {row.name || row.fullName || "Employee"} {isMe && <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}>(You)</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "#64748b" }}>{row.employeeCode}</div>
                            </td>
                            <td style={{ color: "#475569", fontSize: 12 }}>
                              {row.department || "General"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 700, color: "#059669" }}>
                              +{row.pointsEarned ?? row.totalEarned ?? 0}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <span className="wm-balance-pill">
                                {row.balance ?? row.totalPoints ?? ((row.pointsEarned || 0) - (row.pointsDeducted || 0))} pts
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Earning Guide Card */}
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              padding: "20px 24px",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>
              How to Earn Impact Points
            </div>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px", lineHeight: 1.5 }}>
              Impact Points acknowledge measurable contributions and teamwork across the company. Points are awarded through verified workflows:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                  1. On-Time Task Delivery
                </div>
                <div style={{ color: "#64748b", lineHeight: 1.4 }}>
                  Complete assigned initiatives with verifiable deliverables before deadline (+10 pts standard).
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                  2. Priority Milestone Bonus
                </div>
                <div style={{ color: "#64748b", lineHeight: 1.4 }}>
                  High-priority or critical initiatives qualify for accelerated point allocations (+20 pts).
                </div>
              </div>

              <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                  3. Colleague Recognition
                </div>
                <div style={{ color: "#64748b", lineHeight: 1.4 }}>
                  Discretionary recognition granted by managers for cross-functional support and assistance.
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 14, borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
              Impact Points reflect workplace recognition within the HRMS rewards system and do not determine formal appraisals.
            </div>
          </div>
        </div>

        {/* Right Column: Persistent In-Layout Recognition Panel (For managers recognizing direct reports) */}
        {sidePanelMode === "recognize" && meta.isManager && (
          <div className="split-page-panel wm-side-panel">
            <div className="wm-panel-header">
              <div>
                <h3 className="wm-panel-title">
                  Recognize Colleague
                </h3>
                <p className="wm-panel-subtitle">
                  Grant Impact Points to a reporting team member
                </p>
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
                    Recipient Team Member <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    required
                    className="wm-select"
                    value={recognizeForm.recipientId}
                    onChange={(e) =>
                      setRecognizeForm({ ...recognizeForm, recipientId: e.target.value })
                    }
                  >
                    <option value="">Select team member...</option>
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
                    placeholder="Specify the achievement or collaboration delivered..."
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
                  <strong>Quota Policy:</strong> Self-awards are blocked by policy. Points are counted toward your monthly recognition quota.
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
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import SegmentedTabs from "../../components/SegmentedTabs";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import Modal from "../../components/Modal";
import WorkSectionNav from "../../components/WorkSectionNav";
import Icon from "../../components/Icon";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { formatDisplayDate, resolveCompanyTimezone } from "../../utils/dateUtils";
import {
  useImpactLeaderboardQuery,
  useImpactMeQuery,
  useTasksMetaQuery,
} from "../../hooks/useEmployeeQueries";
import { invalidateImpact } from "../../app/queryKeys";

const SOURCE_LABELS = {
  TASK_COMPLETION: "Task Completion",
  MANAGER_RECOGNITION: "Recognition",
  AUTOMATIC_EVENT: "Automatic Event",
  MANUAL_ADJUSTMENT: "Adjustment",
  BONUS: "Bonus",
  PENALTY: "Penalty",
  REVERSAL: "Reversal",
};

const PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function activityTitle(tx) {
  const event = String(tx?.eventType || "").trim();
  if (event && !/^[A-Z0-9_]+$/.test(event)) return event;
  if (SOURCE_LABELS[tx?.source]) return SOURCE_LABELS[tx.source];
  if (event) return titleCase(event);
  if (tx?.reason) return tx.reason;
  return "Points update";
}

function activityDate(tx, timezone) {
  const formatted = formatDisplayDate(tx?.createdAt, timezone);
  return formatted === "—" ? "" : formatted;
}

function pointsValue(tx) {
  const n = Number(tx?.points);
  return Number.isFinite(n) ? n : 0;
}

function rankLabel(value) {
  if (value == null || value === "" || value === "-") return "";
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return `#${n}`;
  const text = String(value);
  return text.startsWith("#") ? text : "";
}

export default function EmployeeImpactPage() {
  const { company, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const timezone = resolveCompanyTimezone(company);
  const [tab, setTab] = useState("activity");
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [recognizeForm, setRecognizeForm] = useState({ recipientId: "", points: 10, reason: "" });
  const [recognizeError, setRecognizeError] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [periodFilter, setPeriodFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");

  const meQuery = useImpactMeQuery();
  const metaQuery = useTasksMetaQuery();
  const boardQuery = useImpactLeaderboardQuery({ period: periodFilter, department: departmentFilter });

  const me = meQuery.data || null;
  const board = boardQuery.data || [];
  const meta = metaQuery.data || {};
  const isManager = Boolean(meta.isManager);
  const reports = Array.isArray(meta.assignableEmployees) ? meta.assignableEmployees : [];
  const departments = Array.isArray(meta.departments) ? meta.departments : [];
  const loading = meQuery.isLoading && !me;
  const error = meQuery.error?.response?.data?.message
    || meQuery.error?.message
    || boardQuery.error?.response?.data?.message
    || "";
  const boardLoading = boardQuery.isFetching;

  const load = () => Promise.all([meQuery.refetch(), metaQuery.refetch(), boardQuery.refetch()]);

  const submitRecognize = async (event) => {
    event.preventDefault();
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
      toast.push(res.data?.message || "Recognition submitted.");
      setRecognizeForm({ recipientId: "", points: 10, reason: "" });
      setRecognizeOpen(false);
      await invalidateImpact(queryClient);
    } catch (err) {
      setRecognizeError(err.response?.data?.message || "Failed to submit recognition.");
    } finally {
      setRecognizing(false);
    }
  };

  const txs = useMemo(
    () => (Array.isArray(me?.recentTransactions) ? me.recentTransactions : Array.isArray(me?.history) ? me.history : []),
    [me]
  );
  const companyRank = rankLabel(me?.companyRank ?? me?.rankInCompany);
  const departmentRank = rankLabel(me?.departmentRank ?? me?.rankInDepartment);
  const balance = Number.isFinite(Number(me?.balance)) ? Number(me.balance) : null;
  const monthPoints = Number.isFinite(Number(me?.pointsThisMonth)) ? Number(me.pointsThisMonth) : null;
  const myId = String(me?.employeeId || user?._id || "");

  if (loading) {
    return (
      <>
        <PageHeader title="Impact Points" />
        <WorkSectionNav />
        <Skeleton />
      </>
    );
  }
  if (error && !me) {
    return (
      <>
        <PageHeader title="Impact Points" />
        <WorkSectionNav />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <div className="ip-page">
      <PageHeader title="Impact Points" />
      <WorkSectionNav />
      {error ? <div className="alert alert-error">{error}</div> : null}
      {isManager ? (
        <button type="button" className="btn-secondary btn-block" onClick={() => setRecognizeOpen(true)}>
          Recognize a teammate
        </button>
      ) : null}

      <section className="ip-hero">
        <span className="ip-kicker">My Points</span>
        <div className="ip-balance">
          <strong>{balance == null ? "—" : balance}</strong>
          {companyRank ? <span className="ip-rank-pill">{companyRank}</span> : null}
        </div>
        {(departmentRank || me?.department) ? (
          <div className="ip-standing">
            <span className="ip-standing-icon"><Icon name="star" size={16} /></span>
            <span>
              {departmentRank ? (
                <>
                  <strong>{departmentRank}</strong>
                  {me?.department ? ` in ${me.department}` : ""}
                </>
              ) : me?.department}
            </span>
          </div>
        ) : null}
      </section>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "activity", label: "Recent Activity" },
          { value: "leaderboard", label: "Leaderboard" },
        ]}
      />

      {tab === "activity" ? (
        <>
          <div className="ip-section-head">
            <span>Activity</span>
            {monthPoints != null ? (
              <em>{monthPoints > 0 ? `This month: +${monthPoints} pts` : `This month: ${monthPoints} pts`}</em>
            ) : null}
          </div>
          {txs.length === 0 ? (
            <EmptyState message="No Impact Point activity yet." />
          ) : (
            <div className="ip-list">
              {txs.map((tx) => {
                const pts = pointsValue(tx);
                return (
                  <div key={tx._id || `${tx.createdAt}-${pts}`} className="ip-row">
                    <span className="ip-row-icon"><Icon name="star" size={18} /></span>
                    <span className="ip-row-body">
                      <span className="ip-row-title">{activityTitle(tx)}</span>
                      <span className="ip-row-sub">{activityDate(tx, timezone)}</span>
                    </span>
                    <span className={`ip-pts${pts < 0 ? " is-neg" : ""}`}>
                      {pts > 0 ? `+${pts}` : pts}
                      <small>pts</small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ip-section-head">
            <span>Leaderboard</span>
            {boardLoading ? <em>Updating...</em> : null}
          </div>
          <div className="ip-filters">
            <label className="tk-priority-filter">
              Period
              <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="tk-priority-filter">
              Department
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="ALL">All departments</option>
                {departments.map((dept) => {
                  const value = typeof dept === "string" ? dept : dept.name || dept.code || "";
                  if (!value) return null;
                  return <option key={value} value={value}>{value}</option>;
                })}
              </select>
            </label>
          </div>
          {board.length === 0 ? (
            <EmptyState message="No leaderboard entries yet." />
          ) : (
            <div className="ip-list">
              {board.map((row, index) => {
                const id = String(row.employeeId || row._id || "");
                const isMe = myId && id && id === myId;
                const pts = Number(row.points ?? row.balance);
                return (
                  <div key={id || index} className={`ip-row${isMe ? " is-me" : ""}`}>
                    <span className="ip-rank">{row.rank || index + 1}</span>
                    <span className="summary-avatar">{initialsFrom(row.fullName || row.name)}</span>
                    <span className="ip-row-body">
                      <span className="ip-row-title">{isMe ? `You (${row.fullName || row.name})` : (row.fullName || row.name)}</span>
                      <span className="ip-row-sub">{row.department || row.employee?.department || ""}</span>
                    </span>
                    <strong className="ip-board-pts">{Number.isFinite(pts) ? `${pts} pts` : "—"}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={recognizeOpen}
        onClose={() => setRecognizeOpen(false)}
        title="Recognize colleague"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRecognizeOpen(false)} disabled={recognizing}>Cancel</button>
            <button type="submit" form="recognize-form" className="btn-primary" disabled={recognizing}>
              {recognizing ? "Submitting..." : "Award points"}
            </button>
          </>
        }
      >
        <form id="recognize-form" className="form-grid" onSubmit={submitRecognize}>
          {recognizeError ? <div className="alert alert-error">{recognizeError}</div> : null}
          <label>
            Team member
            <select
              required
              value={recognizeForm.recipientId}
              onChange={(event) => setRecognizeForm((prev) => ({ ...prev, recipientId: event.target.value }))}
            >
              <option value="">Select team member...</option>
              {reports.map((emp) => (
                <option key={emp._id} value={emp._id}>
                  {emp.fullName || emp.name} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </label>
          <label>
            Points (1 to 50)
            <input
              type="number"
              min="1"
              max="50"
              required
              value={recognizeForm.points}
              onChange={(event) => setRecognizeForm((prev) => ({ ...prev, points: event.target.value }))}
            />
          </label>
          <label>
            Reason
            <textarea
              required
              value={recognizeForm.reason}
              onChange={(event) => setRecognizeForm((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Specify the achievement or collaboration delivered..."
            />
          </label>
          <p className="caption">Self-awards are blocked. Points count toward your monthly recognition quota.</p>
        </form>
      </Modal>
    </div>
  );
}

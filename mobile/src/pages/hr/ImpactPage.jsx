import { useCallback, useEffect, useMemo, useState } from "react";
import { useSmartBack } from "../../hooks/useSmartBack";
import HrPortalHeader from "../../components/HrPortalHeader";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import Modal from "../../components/Modal";
import SearchBar from "../../components/SearchBar";
import ProfileAvatar from "../../components/ProfileAvatar";
import SegmentedTabs from "../../components/SegmentedTabs";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export default function HrImpactPage() {
  const goBack = useSmartBack("/admin/more");
  const toast = useToast();
  const [tab, setTab] = useState("leaderboard");
  const [board, setBoard] = useState([]);
  const [activity, setActivity] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [awardOpen, setAwardOpen] = useState(false);
  const [form, setForm] = useState({ recipientId: "", points: "10", reason: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverseTx, setReverseTx] = useState(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = {};
      if (period !== "all") params.period = period;
      const [boardRes, peopleRes, txRes] = await Promise.all([
        api.get("/impact-points/leaderboard", { params }),
        api.get("/employees", { params: { page: 1, limit: 100, status: "ACTIVE" } }).catch(() => null),
        api.get("/impact-points/transactions", { params: { limit: 30 } }).catch(() => null),
      ]);
      setBoard(boardRes.data?.leaderboard || boardRes.data?.data?.leaderboard || []);
      setPeople(peopleRes?.data?.employees || []);
      const txs =
        txRes?.data?.transactions ||
        txRes?.data?.data?.transactions ||
        txRes?.data?.items ||
        [];
      setActivity(Array.isArray(txs) ? txs : []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load Impact Points.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredBoard = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return board;
    return board.filter((row) =>
      `${row.fullName || row.name || ""} ${row.department || ""} ${row.jobTitle || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [board, search]);

  const totalPoints = useMemo(
    () => board.reduce((sum, row) => sum + Number(row.points ?? row.balance ?? 0), 0),
    [board]
  );

  const submitReverse = async (event) => {
    event.preventDefault();
    if (!reverseTx?._id) return;
    if (!reverseReason.trim()) {
      setReverseError("Reason for reversal is required.");
      return;
    }
    try {
      setBusy(true);
      setReverseError("");
      const res = await api.post(`/impact-points/transactions/${reverseTx._id}/reverse`, {
        reason: reverseReason.trim(),
      });
      toast.push(res.data?.message || "Transaction reversed.");
      setReverseTx(null);
      setReverseReason("");
      await load();
    } catch (err) {
      setReverseError(err.response?.data?.message || "Could not reverse this transaction.");
    } finally {
      setBusy(false);
    }
  };

  const submitAward = async (event) => {
    event.preventDefault();
    if (!form.recipientId) {
      setFormError("Select an employee.");
      return;
    }
    const points = Number(form.points);
    if (!Number.isFinite(points) || points <= 0) {
      setFormError("Enter a positive points amount.");
      return;
    }
    if (!form.reason.trim()) {
      setFormError("Add a recognition reason.");
      return;
    }
    try {
      setBusy(true);
      setFormError("");
      const res = await api.post("/impact-points/recognize", {
        recipientEmployeeId: form.recipientId,
        recipientId: form.recipientId,
        points,
        reason: form.reason.trim(),
      });
      toast.push(res.data?.message || "Impact Points awarded.");
      setAwardOpen(false);
      setForm({ recipientId: "", points: "10", reason: "" });
      await load();
    } catch (err) {
      setFormError(err.response?.data?.message || "Could not award Impact Points.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hr-impact ip-page">
      <HrPortalHeader title="Impact Points" showBack onBack={() => goBack()} />

      <section className="ip-hero hr-impact-hero">
        <div className="hr-impact-hero-row">
          <div>
            <span className="ip-kicker">Total points</span>
            <div className="ip-balance">
              <strong>{loading ? "—" : totalPoints}</strong>
              <span className="ip-rank-pill">{board.length} people</span>
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={() => setAwardOpen(true)}>
            Award points
          </button>
        </div>
      </section>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "leaderboard", label: "Leaderboard" },
          { value: "activity", label: "Transactions" },
        ]}
      />

      {tab === "leaderboard" ? (
        <>
          <div className="hr-impact-toolbar">
            <SearchBar value={search} onChange={setSearch} placeholder="Search employees" />
            <label className="hr-impact-period">
              <span className="sr-only">Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Leaderboard period">
                {PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <Skeleton />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : filteredBoard.length === 0 ? (
            <EmptyState message="No leaderboard entries yet." />
          ) : (
            <div className="ip-list">
              {filteredBoard.map((row, index) => (
                <div key={row.employeeId || row._id || index} className="ip-row">
                  <span className="leader-rank">{index + 1}</span>
                  <ProfileAvatar name={row.fullName || row.name} photo={row.avatar} size={40} />
                  <span className="summary-body">
                    <span className="summary-title">{row.fullName || row.name}</span>
                    <span className="summary-sub">{row.department || row.jobTitle || "Team member"}</span>
                  </span>
                  <strong className="hr-impact-pts">{row.points ?? row.balance ?? 0} pts</strong>
                </div>
              ))}
            </div>
          )}
        </>
      ) : loading ? (
        <Skeleton />
      ) : activity.length === 0 ? (
        <EmptyState message="No recent recognition activity." />
      ) : (
        <div className="ip-list">
          {activity.map((tx, index) => {
            const emp =
              tx.employee?.fullName ||
              tx.employeeSnapshot?.fullName ||
              tx.recipientName ||
              tx.employeeName ||
              tx.fullName ||
              "Employee";
            const pts = Number(tx.points || 0);
            const isReversal = tx.transactionType === "REVERSAL" || tx.isReversed;
            const canReverse = tx.transactionType !== "REVERSAL" && !tx.isReversed && tx._id;
            return (
              <div key={tx._id || index} className="ip-row" style={{ alignItems: "flex-start" }}>
                <ProfileAvatar name={emp} photo={tx.avatar} size={40} />
                <span className="summary-body">
                  <span className="summary-title">{emp}</span>
                  <span className="summary-sub">
                    {tx.transactionType || tx.source || "Recognition"}
                    {tx.isReversed ? " · Reversed" : ""}
                  </span>
                  <span className="caption">{tx.reason || tx.eventType || ""}</span>
                  {canReverse ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: 6 }}
                      onClick={() => {
                        setReverseTx(tx);
                        setReverseReason("");
                        setReverseError("");
                      }}
                    >
                      Reverse
                    </button>
                  ) : null}
                </span>
                <strong className={`hr-impact-pts${pts >= 0 && !isReversal ? " is-plus" : ""}`}>
                  {pts >= 0 ? "+" : ""}
                  {pts}
                </strong>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(reverseTx)}
        onClose={() => !busy && setReverseTx(null)}
        title="Reverse transaction"
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setReverseTx(null)}>
              Cancel
            </button>
            <button type="submit" form="reverse-impact" className="btn-danger" disabled={busy}>
              {busy ? "Reversing…" : "Confirm reverse"}
            </button>
          </>
        }
      >
        {reverseTx ? (
          <form id="reverse-impact" className="form-grid" onSubmit={submitReverse}>
            {reverseError ? <div className="alert alert-error">{reverseError}</div> : null}
            <p className="caption">
              {reverseTx.employee?.fullName ||
                reverseTx.employeeSnapshot?.fullName ||
                reverseTx.recipientName ||
                "Employee"}{" "}
              · {Number(reverseTx.points || 0)} pts
            </p>
            <p className="caption">{reverseTx.reason || "No original reason"}</p>
            <div className="alert alert-warn">
              A compensating ledger entry of {Number(-(reverseTx.points || 0))} points will be recorded.
            </div>
            <label>
              Reason for reversal
              <textarea
                rows={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Why is this transaction being reversed?"
                required
              />
            </label>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={awardOpen}
        onClose={() => !busy && setAwardOpen(false)}
        title="Award Impact Points"
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setAwardOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="award-impact" className="btn-primary" disabled={busy}>
              {busy ? "Awarding..." : "Confirm award"}
            </button>
          </>
        }
      >
        <form id="award-impact" className="form-grid" onSubmit={submitAward}>
          {formError ? <div className="alert alert-error">{formError}</div> : null}
          <label>
            Employee
            <select
              value={form.recipientId}
              onChange={(e) => setForm((prev) => ({ ...prev, recipientId: e.target.value }))}
              required
            >
              <option value="">Select employee</option>
              {people.map((person) => (
                <option key={person._id} value={person._id}>
                  {person.fullName} {person.employeeCode ? `· ${person.employeeCode}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Points
            <input
              type="number"
              min="1"
              step="1"
              value={form.points}
              onChange={(e) => setForm((prev) => ({ ...prev, points: e.target.value }))}
              required
            />
          </label>
          <label>
            Reason / recognition message
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Why are these points being awarded?"
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}

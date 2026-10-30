import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Plus,
  Users,
  User,
} from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import ProfileAvatar from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useToast } from "../../components/Toast";
import { useNotify } from "../../app/notifyContext";
import { useAuth } from "../../app/AuthContext";
import api from "../../services/api";
import { formatDisplayDate } from "../../utils/dateUtils";

const LEAVE_PAGE_SIZE = 20;

function daysBetween(start, end) {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diff = Math.round((b - a) / 86400000) + 1;
  return diff > 0 ? diff : null;
}

function statusNote(req) {
  const s = String(req.status || "").toUpperCase();
  const remarks = req.decision?.remarks || req.reviewRemarks || req.remarks;
  if (s === "PENDING") return { text: "Awaiting review", tone: "is-pending" };
  if (s === "APPROVED") return { text: remarks || "Approved", tone: "is-ok" };
  if (s === "REJECTED") return { text: remarks || "Rejected", tone: "is-bad" };
  return { text: s || "—", tone: "" };
}

export default function HrLeavePage() {
  const toast = useToast();
  const notify = useNotify();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [scope, setScope] = useState("team");
  const [items, setItems] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [balance, setBalance] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summaryCounts, setSummaryCounts] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({ leaveType: "", startDate: "", endDate: "", reason: "" });
  const [applyBusy, setApplyBusy] = useState(false);

  const loadTeam = async () => {
    const res = await api.get("/leave-requests", {
      params: {
        page,
        limit: LEAVE_PAGE_SIZE,
        ...(status !== "ALL" ? { status } : {}),
      },
    });
    const list = res.data?.leaveRequests;
    if (!Array.isArray(list)) throw new Error("Leave requests could not be read from the server response.");
    setItems(list);
    const pagination = res.data?.pagination || {};
    setTotalItems(pagination.total ?? list.length);
    setTotalPages(pagination.totalPages ?? 1);
    if (res.data?.summary) setSummaryCounts(res.data.summary);
  };

  const loadMine = async () => {
    try {
      // HR personal leave uses the employee dashboard leave payload when an
      // employee profile is linked. There is no GET /employees/me/leave endpoint.
      const res = await api.get("/employees/me/dashboard");
      const leave = res.data?.leave || res.data?.data?.leave || {};
      const list = leave.recentRequests || leave.requests || leave.history || [];
      setMyItems(Array.isArray(list) ? list : []);
      setBalance(leave.balance || leave.summary || leave || null);
      const leaveTypes = leave.detailed?.length ? leave.detailed : leave.types || leave.leaveTypes || [];
      setTypes(Array.isArray(leaveTypes) ? leaveTypes : []);
      if (!applyForm.leaveType && leaveTypes[0]) {
        const first = leaveTypes[0];
        setApplyForm((prev) => ({
          ...prev,
          leaveType: first.code || first.name || first.leaveType || "",
        }));
      }
    } catch {
      setMyItems([]);
      setBalance(null);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      await Promise.all([loadTeam(), loadMine()]);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [status, scope]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, scope]);

  useEffect(() => {
    const focusId = location.state?.focusId;
    if (!focusId || !items.length) return;
    const hit = items.find((item) => String(item._id) === String(focusId));
    if (hit) {
      setScope("team");
      setSelected(hit);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [items, location.state, location.pathname, navigate]);

  const teamPending = useMemo(
    () =>
      summaryCounts?.pending ??
      items.filter((i) => String(i.status).toUpperCase() === "PENDING").length,
    [items, summaryCounts]
  );

  const visible = useMemo(() => {
    if (scope === "team") return items;
    if (status === "ALL") return myItems;
    return myItems.filter((i) => String(i.status).toUpperCase() === status);
  }, [scope, items, myItems, status]);

  const statusCounts = useMemo(() => {
    if (scope === "team" && summaryCounts) {
      const pending = Number(summaryCounts.pending || 0);
      const approved = Number(summaryCounts.approved || 0);
      const rejected = Number(summaryCounts.rejected || 0);
      return {
        ALL: pending + approved + rejected,
        PENDING: pending,
        APPROVED: approved,
        REJECTED: rejected,
      };
    }
    const source = scope === "team" ? items : myItems;
    const counts = { ALL: source.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    source.forEach((i) => {
      const s = String(i.status || "").toUpperCase();
      if (counts[s] != null) counts[s] += 1;
    });
    return counts;
  }, [scope, items, myItems, summaryCounts]);

  const totalBalance = useMemo(() => {
    if (balance == null) return null;
    if (typeof balance === "number") return balance;
    if (Number.isFinite(Number(balance.totalAvailable))) return Number(balance.totalAvailable);
    if (Number.isFinite(Number(balance.available))) return Number(balance.available);
    const vals = Object.values(balance).filter((v) => typeof v === "number" || (v && typeof v === "object"));
    let sum = 0;
    let found = false;
    vals.forEach((v) => {
      if (typeof v === "number") {
        sum += v;
        found = true;
      } else if (v && Number.isFinite(Number(v.available ?? v.remaining ?? v.balance))) {
        sum += Number(v.available ?? v.remaining ?? v.balance);
        found = true;
      }
    });
    return found ? sum : null;
  }, [balance]);

  const quotaRows = useMemo(() => {
    if (!balance || typeof balance !== "object") return [];
    const skip = new Set(["totalAvailable", "available", "total", "summary"]);
    return Object.entries(balance)
      .filter(([key, val]) => !skip.has(key) && val != null && typeof val === "object")
      .map(([key, val]) => {
        const used = Number(val.used ?? val.consumed ?? val.taken ?? 0);
        const total = Number(val.total ?? val.quota ?? val.entitled ?? val.limit ?? 0);
        const available = Number(val.available ?? val.remaining ?? val.balance ?? Math.max(total - used, 0));
        const denom = total || used + available;
        const pct = denom > 0 ? Math.min(100, Math.round((used / denom) * 100)) : 0;
        return {
          key,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          used: Number.isFinite(used) ? used : 0,
          total: Number.isFinite(denom) ? denom : 0,
          pct,
        };
      })
      .filter((row) => row.total > 0)
      .slice(0, 4);
  }, [balance]);

  const decide = async () => {
    try {
      setBusy(true);
      await api.post(`/leave-requests/${selected._id}/decision`, { action: confirm, remarks });
      toast.push(confirm === "APPROVE" ? "Leave approved." : "Leave rejected.");
      setConfirm(null);
      setSelected(null);
      setRemarks("");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this decision.");
    } finally {
      setBusy(false);
    }
  };

  const submitApply = async (event) => {
    event.preventDefault();
    if (!applyForm.leaveType || !applyForm.startDate || !applyForm.endDate || !applyForm.reason.trim()) {
      setError("Leave type, dates, and reason are required.");
      return;
    }
    try {
      setApplyBusy(true);
      await api.post("/employees/me/leave-requests", {
        leaveType: applyForm.leaveType,
        startDate: applyForm.startDate,
        endDate: applyForm.endDate,
        reason: applyForm.reason.trim(),
      });
      toast.push("Leave request submitted.");
      setApplyOpen(false);
      setApplyForm({ leaveType: applyForm.leaveType, startDate: "", endDate: "", reason: "" });
      setScope("my");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit leave.");
    } finally {
      setApplyBusy(false);
    }
  };

  const chips = [
    { value: "ALL", label: "All", count: statusCounts.ALL },
    { value: "PENDING", label: "Pending", count: statusCounts.PENDING },
    { value: "APPROVED", label: "Approved", count: statusCounts.APPROVED },
    { value: "REJECTED", label: "Rejected", count: statusCounts.REJECTED },
  ];

  return (
    <div className="st-leave">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Leave Management</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <ProfileAvatar name={user?.name || user?.fullName || user?.email || "HR"} size={36} className="hr-portal-avatar" />
        </div>
      </header>

      <div className="st-scope" role="tablist" aria-label="Leave scope">
        <button
          type="button"
          className={scope === "my" ? "is-active" : ""}
          onClick={() => setScope("my")}
        >
          <User size={16} strokeWidth={2} aria-hidden="true" />
          My Requests
        </button>
        <button
          type="button"
          className={scope === "team" ? "is-active" : ""}
          onClick={() => setScope("team")}
        >
          <Users size={16} strokeWidth={2} aria-hidden="true" />
          Team Requests
          {teamPending > 0 ? <span className="st-scope-count">{teamPending}</span> : null}
        </button>
      </div>

      <div className="st-leave-balance">
        <div>
          <span className="st-leave-balance-label">Available Balance</span>
          <div className="st-leave-balance-value">
            <strong>{totalBalance != null ? totalBalance : "—"}</strong>
            <span>days total</span>
          </div>
        </div>
        <button type="button" className="st-apply-btn" onClick={() => setApplyOpen(true)}>
          <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
          Apply Leave
        </button>
      </div>

      <div className="st-pill-row" role="tablist" aria-label="Leave status filters">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`st-pill${status === chip.value ? " is-active" : ""}`}
            onClick={() => setStatus(chip.value)}
          >
            {chip.label}
            <em>{chip.count}</em>
          </button>
        ))}
      </div>

      <div className="st-leave-list-head">
        <span>Recent Applications</span>
        <span>{scope === "team" ? "Team queue" : "My history"}</span>
      </div>

      {loading ? (
        <Skeleton />
      ) : error && visible.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState message="No leave requests in this view." />
      ) : (
        <div className="st-leave-list">
          {visible.map((req) => {
            const typeLabel = req.leaveTypeCode || req.leaveType || req.type || "Leave";
            const start = req.startDate || req.fromDate;
            const end = req.endDate || req.toDate;
            const days = req.totalDays || req.days || daysBetween(start, end);
            const note = statusNote(req);
            const name =
              scope === "team"
                ? req.employeeName || req.employeeId?.fullName || req.employee?.fullName || "Employee"
                : user?.name || user?.fullName || "You";
            const photo =
              req.avatar ||
              req.employeeId?.avatar ||
              req.employee?.avatar ||
              (scope === "my" ? user?.avatar : "");
            const sub =
              scope === "team"
                ? `${typeLabel} · ${formatDisplayDate(start)} – ${formatDisplayDate(end)}`
                : `${typeLabel} · ${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
            return (
              <article key={req._id} className="st-leave-card">
                <button type="button" className="st-leave-card-main" onClick={() => setSelected(req)}>
                  <ProfileAvatar name={name} photo={photo} size={40} className="st-leave-avatar" />
                  <span className="st-leave-copy">
                    <strong>{scope === "team" ? name : typeLabel}</strong>
                    <span>{sub}</span>
                  </span>
                  <span className="st-leave-side">
                    <StatusBadge status={req.status} />
                    {days != null ? <em>{days} day{days === 1 ? "" : "s"}</em> : null}
                  </span>
                </button>
                <div className="st-leave-card-foot">
                  <span className={`st-leave-note ${note.tone}`}>
                    <i />
                    {note.text}
                  </span>
                  {scope === "team" && String(req.status).toUpperCase() === "PENDING" ? (
                    <div className="hr-attention-actions">
                      <button
                        type="button"
                        className="btn-ghost-sm"
                        onClick={() => {
                          setSelected(req);
                          setConfirm("REJECT");
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn-primary-sm"
                        onClick={() => {
                          setSelected(req);
                          setConfirm("APPROVE");
                        }}
                      >
                        Approve
                      </button>
                    </div>
                  ) : (
                    <ChevronRight size={16} strokeWidth={1.85} className="st-leave-chevron" aria-hidden="true" />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {scope === "team" ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={LEAVE_PAGE_SIZE}
          onPageChange={setPage}
          itemLabel="leave requests"
        />
      ) : null}

      {quotaRows.length > 0 ? (
        <section className="st-quota">
          <div className="st-quota-head">
            <h3>Category Quotas</h3>
            <span>Policy</span>
          </div>
          <div className="st-quota-grid">
            {quotaRows.map((row) => (
              <div key={row.key} className="st-quota-cell">
                <div className="st-quota-cell-top">
                  <span>{row.label}</span>
                  <em>
                    {row.used} / {row.total}
                  </em>
                </div>
                <div className="st-quota-bar">
                  <i style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Modal open={Boolean(selected) && !confirm} onClose={() => setSelected(null)} title="Leave Request">
        {selected ? (
          <>
            <p className="section-title">{selected.employeeName || selected.employeeId?.fullName || "Leave"}</p>
            <p className="caption">{selected.jobTitle || selected.employeeId?.job?.jobTitle}</p>
            <div style={{ margin: "12px 0" }}>
              <StatusBadge status={selected.status} />
            </div>
            <p>{selected.leaveTypeCode || selected.leaveType}</p>
            <p className="caption">
              {formatDisplayDate(selected.startDate || selected.fromDate)} – {formatDisplayDate(selected.endDate || selected.toDate)}
            </p>
            <p style={{ marginTop: 12 }}>{selected.reason || "No reason on file."}</p>
            {scope === "team" && String(selected.status).toUpperCase() === "PENDING" ? (
              <div className="row-actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn-danger" onClick={() => setConfirm("REJECT")}>
                  Reject
                </button>
                <button type="button" className="btn-primary" onClick={() => setConfirm("APPROVE")}>
                  Approve
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="New Leave Request"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setApplyOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="hr-apply-leave" className="btn-primary" disabled={applyBusy}>
              {applyBusy ? "Submitting..." : "Submit"}
            </button>
          </>
        }
      >
        <form id="hr-apply-leave" className="form-grid" onSubmit={submitApply}>
          <p className="caption">Submit for manager approval</p>
          <label>
            Leave Type
            <select
              value={applyForm.leaveType}
              onChange={(event) => setApplyForm((prev) => ({ ...prev, leaveType: event.target.value }))}
              required
            >
              {(types.length ? types : [{ code: "CASUAL", name: "Casual Leave" }, { code: "SICK", name: "Sick Leave" }]).map(
                (type) => {
                  const value = type.code || type.name || type.leaveType;
                  return (
                    <option key={value} value={value}>
                      {type.name || type.code || value}
                    </option>
                  );
                }
              )}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={applyForm.startDate}
              onChange={(event) => setApplyForm((prev) => ({ ...prev, startDate: event.target.value }))}
              required
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={applyForm.endDate}
              onChange={(event) => setApplyForm((prev) => ({ ...prev, endDate: event.target.value }))}
              required
            />
          </label>
          <label>
            Reason / Notes
            <textarea
              value={applyForm.reason}
              onChange={(event) => setApplyForm((prev) => ({ ...prev, reason: event.target.value }))}
              placeholder="Add optional details for your approver..."
              required
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm === "APPROVE" ? "Approve leave" : "Reject leave"}
        message="This decision is recorded on the leave request."
        confirmLabel={confirm === "APPROVE" ? "Approve" : "Reject"}
        danger={confirm === "REJECT"}
        busy={busy}
        onConfirm={decide}
      >
        <label className="form-grid" style={{ marginTop: 12 }}>
          Remarks
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        </label>
      </ConfirmDialog>
    </div>
  );
}

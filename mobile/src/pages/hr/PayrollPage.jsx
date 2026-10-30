import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Plus,
  Receipt,
  Search,
  Wallet,
} from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import {
  MONTHS,
  cycleLabel,
  extractPayslips,
  formatMoney,
  payslipEmployeeCode,
  payslipEmployeeName,
  payslipStatus,
  periodLabel,
  statusBucket,
} from "../../utils/payrollUtils";
import MonthNav from "../../components/MonthNav";

function cycleMatchesPeriod(cycle, month, year) {
  return Number(cycle?.periodMonth) === Number(month) && Number(cycle?.periodYear) === Number(year);
}

export default function HrPayrollPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();
  const navigate = useNavigate();
  const now = new Date();

  const [cycles, setCycles] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [tab, setTab] = useState("payslips");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [confirm, setConfirm] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(() => {
    const now = new Date();
    return { periodMonth: String(now.getMonth() + 1), periodYear: String(now.getFullYear()) };
  });
  const [busy, setBusy] = useState(false);

  const applyCycleDetail = (detailData, fallbackCycle) => {
    const cycle = detailData?.cycle || fallbackCycle || null;
    setSelected(cycle);
    setSelectedId(cycle?._id ? String(cycle._id) : "");
    setPayslips(extractPayslips(detailData));
  };

  const loadCycles = async (preferId, month = viewMonth, year = viewYear) => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/payroll/cycles");
      const list = Array.isArray(res.data?.cycles) ? res.data.cycles : [];
      setCycles(list);
      const preferred = list.find((c) => String(c._id) === String(preferId || selectedId));
      const byPeriod = list.find((c) => cycleMatchesPeriod(c, month, year));
      const target = preferred && cycleMatchesPeriod(preferred, month, year) ? preferred : byPeriod || null;
      if (target) {
        setDetailLoading(true);
        if (target.periodMonth) setViewMonth(Number(target.periodMonth));
        if (target.periodYear) setViewYear(Number(target.periodYear));
        const detail = await api.get(`/payroll/cycles/${target._id}`);
        applyCycleDetail(detail.data, target);
      } else {
        setSelected(null);
        setSelectedId("");
        setPayslips([]);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not load payroll.");
      setCycles([]);
      setSelected(null);
      setPayslips([]);
    } finally {
      setLoading(false);
      setDetailLoading(false);
    }
  };

  const goToPeriod = async ({ month, year }) => {
    setViewMonth(month);
    setViewYear(year);
    try {
      setDetailLoading(true);
      setError("");
      const list = cycles.length
        ? cycles
        : ((await api.get("/payroll/cycles")).data?.cycles || []);
      if (!cycles.length) setCycles(list);
      const target = list.find((c) => cycleMatchesPeriod(c, month, year)) || null;
      if (target) {
        setSelectedId(String(target._id));
        setSelected(target);
        const detail = await api.get(`/payroll/cycles/${target._id}`);
        applyCycleDetail(detail.data, target);
      } else {
        setSelected(null);
        setSelectedId("");
        setPayslips([]);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not load this payroll period.");
      setSelected(null);
      setPayslips([]);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadCycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectCycle = async (cycle) => {
    if (!cycle?._id) return;
    if (cycle.periodMonth) setViewMonth(Number(cycle.periodMonth));
    if (cycle.periodYear) setViewYear(Number(cycle.periodYear));
    if (String(cycle._id) === String(selectedId) && payslips.length) return;
    try {
      setDetailLoading(true);
      setError("");
      setSelectedId(String(cycle._id));
      setSelected(cycle);
      setPayslips([]);
      const detail = await api.get(`/payroll/cycles/${cycle._id}`);
      applyCycleDetail(detail.data, cycle);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load this payroll cycle.");
    } finally {
      setDetailLoading(false);
    }
  };

  const createCycle = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      const res = await api.post("/payroll/cycles", {
        periodMonth: Number(form.periodMonth),
        periodYear: Number(form.periodYear),
      });
      toast.push("Payroll cycle created.");
      setCreateOpen(false);
      const createdId = res.data?.cycle?._id || res.data?.data?._id;
      await loadCycles(createdId);
      setTab("runs");
    } catch (err) {
      setError(err.response?.data?.message || "Could not create this cycle.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!selected?._id || !confirm || busy) return;
    try {
      setBusy(true);
      if (confirm === "calculate") await api.post(`/payroll/cycles/${selected._id}/calculate`);
      if (confirm === "finalize") await api.post(`/payroll/cycles/${selected._id}/finalize`);
      if (confirm === "pay") await api.post(`/payroll/cycles/${selected._id}/pay`, {});
      toast.push(
        confirm === "calculate"
          ? "Payroll calculated."
          : confirm === "finalize"
            ? "Payroll finalized."
            : "Payroll marked paid."
      );
      setConfirm(null);
      await loadCycles(selected._id);
    } catch (err) {
      setError(err.response?.data?.message || "Could not update payroll.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const buckets = { all: payslips.length, paid: 0, pending: 0, failed: 0 };
    payslips.forEach((row) => {
      const b = statusBucket(row);
      if (buckets[b] != null) buckets[b] += 1;
    });
    return buckets;
  }, [payslips]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payslips.filter((row) => {
      if (statusFilter !== "all" && statusBucket(row) !== statusFilter) return false;
      if (!q) return true;
      return `${payslipEmployeeName(row)} ${payslipEmployeeCode(row)}`
        .toLowerCase()
        .includes(q);
    });
  }, [payslips, search, statusFilter]);

  const totalNet = selected?.totalNetPayable ?? selected?.totalNetSalary ?? 0;
  const totalGross = selected?.totalGrossEarnings ?? 0;
  const employeeCount = selected?.employeeCount ?? payslips.length;
  const paidPct =
    employeeCount > 0 ? Math.round((counts.paid / Math.max(payslips.length, 1)) * 100) : 0;
  const symbol = payslips[0]?.currencySymbol || "₹";

  const statusChips = [
    { value: "all", label: "All", count: counts.all },
    { value: "paid", label: "Paid", count: counts.paid },
    { value: "pending", label: "Pending", count: counts.pending },
    { value: "failed", label: "Failed", count: counts.failed },
  ];

  if (loading) {
    return (
      <div className="st-pay">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Payroll & Payslips</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  if (error && cycles.length === 0) {
    return (
      <div className="st-pay">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Payroll & Payslips</h1>
        </header>
        <ErrorState message={error} onRetry={() => loadCycles()} />
      </div>
    );
  }

  return (
    <div className="st-pay">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Payroll & Payslips</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="st-pay-tabs" role="tablist" aria-label="Payroll views">
        <button
          type="button"
          className={tab === "payslips" ? "is-active" : ""}
          onClick={() => setTab("payslips")}
        >
          <Receipt size={16} strokeWidth={2} aria-hidden="true" />
          Payslips
        </button>
        <button
          type="button"
          className={tab === "runs" ? "is-active" : ""}
          onClick={() => setTab("runs")}
        >
          <Wallet size={16} strokeWidth={2} aria-hidden="true" />
          Payroll Runs
        </button>
      </div>

      <div className="st-pay-period-row">
        <MonthNav
          month={viewMonth}
          year={viewYear}
          onChange={goToPeriod}
          label="Pay period"
          className="st-pay-month-nav"
        />
        <span className="st-pay-count-pill">
          <i aria-hidden="true" />
          {payslips.length} records
        </span>
      </div>

      <section className="st-pay-kpi">
        <div>
          <span>Total disbursed</span>
          <strong>{formatMoney(totalNet, symbol)}</strong>
        </div>
        <div className="st-pay-kpi-badge">
          {selected?.paymentStatus || selected?.status || (selected ? "—" : "No cycle")}
          {payslips.length ? ` · ${paidPct}% paid` : ""}
        </div>
      </section>

      {tab === "payslips" ? (
        <>
          <div className="st-att-search">
            <Search size={18} strokeWidth={1.85} aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or employee ID"
              aria-label="Search payslips"
            />
          </div>

          <div className="st-pill-row" role="tablist" aria-label="Payment status filters">
            {statusChips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={`st-pill${statusFilter === chip.value ? " is-active" : ""}`}
                onClick={() => setStatusFilter(chip.value)}
              >
                {chip.label} ({chip.count})
              </button>
            ))}
          </div>

          <div className="st-pay-list-head">
            <h2>Employee disbursals</h2>
            <span>Sorted by name</span>
          </div>

          {detailLoading ? (
            <Skeleton />
          ) : !selected ? (
            <EmptyState
              message={`No payroll cycle for ${periodLabel(viewMonth, viewYear)}.`}
              actionLabel="Create cycle"
              onAction={() => {
                setForm({ periodMonth: String(viewMonth), periodYear: String(viewYear) });
                setCreateOpen(true);
              }}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              message={
                cycles.length === 0
                  ? "No payroll cycles yet."
                  : "No payslips match this filter for the selected period."
              }
              actionLabel={cycles.length === 0 ? "Create payroll cycle" : undefined}
              onAction={cycles.length === 0 ? () => setCreateOpen(true) : undefined}
            />
          ) : (
            <div className="st-pay-list">
              {filtered.map((row) => {
                const id = row._id || row.id;
                const name = payslipEmployeeName(row);
                const code = payslipEmployeeCode(row);
                const net = row.netPayable ?? row.netPay;
                return (
                  <button
                    key={id}
                    type="button"
                    className="st-pay-card"
                    onClick={() =>
                      navigate(`/admin/payroll/payslips/${id}`, {
                        state: { cycleId: selectedId, payslip: row },
                      })
                    }
                  >
                    <span className="st-pay-avatar-wrap">
                      <span className="st-pay-avatar">{initialsFrom(name)}</span>
                      <span className="st-pay-avatar-badge" aria-hidden="true">
                        <Receipt size={12} strokeWidth={2} />
                      </span>
                    </span>
                    <span className="st-pay-copy">
                      <strong>{name}</strong>
                      <span>
                        {periodLabel(row.periodMonth || selected?.periodMonth, row.periodYear || selected?.periodYear)}
                        {Number.isFinite(Number(net)) ? ` · Net ${formatMoney(net, row.currencySymbol || symbol)}` : ""}
                        {code ? ` · ${code}` : ""}
                      </span>
                    </span>
                    <span className="st-pay-side">
                      <StatusBadge status={payslipStatus(row)} />
                      <ChevronRight size={18} strokeWidth={1.85} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="st-pay-runs">
          {!selected ? (
            <EmptyState
              message="No payroll cycle selected."
              actionLabel="Create payroll cycle"
              onAction={() => setCreateOpen(true)}
            />
          ) : (
            <>
              <section className="st-pay-overview card">
                <div className="st-pay-overview-head">
                  <h2>Payroll overview</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <div className="st-pay-overview-net">
                  <span>Total net payable</span>
                  <strong>{formatMoney(totalNet, symbol)}</strong>
                </div>
                <div className="st-pay-overview-grid">
                  <div>
                    <span>Employees</span>
                    <strong>{employeeCount}</strong>
                  </div>
                  <div>
                    <span>Gross</span>
                    <strong>{formatMoney(totalGross, symbol)}</strong>
                  </div>
                  <div>
                    <span>Deductions</span>
                    <strong>
                      {formatMoney(selected.totalEmployeeDeductions ?? selected.totalDeductions ?? 0, symbol)}
                    </strong>
                  </div>
                  <div>
                    <span>Payment</span>
                    <strong>{selected.paymentStatus || "—"}</strong>
                  </div>
                </div>
                <div className="st-pay-status-row">
                  <div>
                    <i className="is-paid" /> Paid <strong>{counts.paid}</strong>
                  </div>
                  <div>
                    <i className="is-pending" /> Pending <strong>{counts.pending}</strong>
                  </div>
                  <div>
                    <i className="is-failed" /> Failed <strong>{counts.failed}</strong>
                  </div>
                </div>
              </section>

              <div className="st-pay-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || detailLoading}
                  onClick={() => setConfirm("calculate")}
                >
                  Calculate
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || detailLoading}
                  onClick={() => setConfirm("finalize")}
                >
                  Finalize
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || detailLoading}
                  onClick={() => setConfirm("pay")}
                >
                  Mark paid
                </button>
              </div>

              <div className="st-pay-list-head">
                <h2>Cycle history</h2>
              </div>
              <div className="st-pay-cycle-list">
                {cycles.map((cycle) => (
                  <button
                    key={cycle._id}
                    type="button"
                    className={`st-pay-cycle${String(cycle._id) === String(selectedId) ? " is-active" : ""}`}
                    onClick={() => selectCycle(cycle)}
                  >
                    <span className="st-pay-copy">
                      <strong>{cycleLabel(cycle)}</strong>
                      <span>
                        {cycle.employeeCount ?? 0} employees ·{" "}
                        {formatMoney(cycle.totalNetPayable || 0, symbol)}
                      </span>
                    </span>
                    <StatusBadge status={cycle.status} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button type="button" className="st-pay-fab" onClick={() => setCreateOpen(true)}>
        <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
        Create cycle
      </button>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create cycle"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="create-cycle" className="btn-primary" disabled={busy}>
              {busy ? "Saving..." : "Create cycle"}
            </button>
          </>
        }
      >
        <form id="create-cycle" className="form-grid" onSubmit={createCycle}>
          <label>
            Month
            <select
              value={form.periodMonth}
              onChange={(event) => setForm((prev) => ({ ...prev, periodMonth: event.target.value }))}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <input
              type="number"
              value={form.periodYear}
              onChange={(event) => setForm((prev) => ({ ...prev, periodYear: event.target.value }))}
            />
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => (!busy ? setConfirm(null) : null)}
        title={
          confirm === "calculate"
            ? "Calculate payroll"
            : confirm === "finalize"
              ? "Finalize payroll"
              : "Mark as paid"
        }
        message="This uses the same payroll APIs as the web app."
        confirmLabel={
          confirm === "calculate" ? "Calculate" : confirm === "finalize" ? "Finalize" : "Mark as paid"
        }
        busy={busy}
        onConfirm={run}
      />
    </div>
  );
}

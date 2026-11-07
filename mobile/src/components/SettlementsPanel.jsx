import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Handshake,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import Pagination from "./Pagination";
import EmptyState, { ErrorState, Skeleton } from "./EmptyState";
import { initialsFrom } from "./SummaryRow";
import { useToast } from "./Toast";
import api from "../services/api";
import { formatMoney } from "../utils/payrollUtils";

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "APPROVED", label: "Approved" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "PAID", label: "Paid" },
  { value: "COMPLETED", label: "Completed" },
];

const STATUS_LABELS = {
  DRAFT: "Draft",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  ON_HOLD: "On hold",
  PAID: "Paid",
  COMPLETED: "Completed",
};

// Display order of the happy path (ON_HOLD is shown as a banner, not a step).
const STEPS = ["DRAFT", "UNDER_REVIEW", "APPROVED", "PAID", "COMPLETED"];

// Same category lists the web app offers when adding manual line items.
const EARNING_CATEGORIES = [
  { value: "SALARY", label: "Salary" },
  { value: "BONUS", label: "Bonus" },
  { value: "GRATUITY", label: "Gratuity" },
  { value: "REIMBURSEMENT", label: "Reimbursement" },
  { value: "OTHER", label: "Other" },
];

const DEDUCTION_CATEGORIES = [
  { value: "STATUTORY", label: "Statutory" },
  { value: "ADVANCE_RECOVERY", label: "Advance recovery" },
  { value: "NOTICE_RECOVERY", label: "Notice period recovery" },
  { value: "ASSET_RECOVERY", label: "Asset recovery" },
  { value: "TAX", label: "Tax deduction" },
  { value: "OTHER", label: "Other" },
];

const PAYMENT_METHODS = [
  { value: "NEFT_RTGS", label: "Bank transfer (NEFT/RTGS)" },
  { value: "BANK_TRANSFER", label: "Direct transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "UPI", label: "UPI" },
  { value: "DIRECT_DEPOSIT", label: "Direct deposit" },
];

function todayInputValue() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function userLabel(user) {
  if (!user) return "";
  if (typeof user === "string") return "";
  return user.name || user.email || "";
}

function methodLabel(value) {
  const found = PAYMENT_METHODS.find((m) => m.value === value);
  if (found) return found.label;
  return value ? String(value).replace(/_/g, " ") : "—";
}

function categoryLabel(value) {
  if (!value) return "";
  const all = [...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES];
  const found = all.find((c) => c.value === value);
  if (found) return found.label;
  return String(value)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function amountOf(item) {
  const n = parseFloat(item?.amount);
  return Number.isFinite(n) ? n : 0;
}

function sumItems(items) {
  return (items || []).reduce((acc, it) => acc + amountOf(it), 0);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatMoney(Math.round(n * 100) / 100);
}

function apiError(err, fallback) {
  return err?.response?.data?.message || fallback;
}

function employeeOf(settlement) {
  const emp = settlement?.employeeId;
  return emp && typeof emp === "object" ? emp : {};
}

function DetailRow({ label, value }) {
  return (
    <div className="st-ff-row">
      <span>{label}</span>
      <strong>{value || value === 0 ? value : "—"}</strong>
    </div>
  );
}

export default function SettlementsPanel({ initialSettlementId = "" }) {
  const toast = useToast();

  // ---------------- list state ----------------
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const listReq = useRef(0);

  // ---------------- detail state ----------------
  const [selectedId, setSelectedId] = useState(initialSettlementId || "");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const detailReq = useRef(0);

  // ---------------- editing state (DRAFT / ON_HOLD only) ----------------
  const [earnings, setEarnings] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [hrRemarks, setHrRemarks] = useState("");
  const [adjustmentRemarks, setAdjustmentRemarks] = useState("");
  const [lineModal, setLineModal] = useState(null); // { kind, index|null, title, category, amount, error }

  // ---------------- action dialogs ----------------
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { status, title, message, confirmLabel, remarks } | { complete: true }
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [holdError, setHoldError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    paymentDate: todayInputValue(),
    paymentMethod: "NEFT_RTGS",
    referenceNumber: "",
    remarks: "",
  });
  const [payError, setPayError] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load list
  useEffect(() => {
    const reqId = ++listReq.current;
    (async () => {
      setListLoading(true);
      setListError("");
      try {
        const params = { page, limit: PAGE_SIZE };
        if (search) params.search = search;
        if (statusFilter !== "ALL") params.status = statusFilter;
        const res = await api.get("/settlements", { params });
        if (reqId !== listReq.current) return;
        const data = res.data || {};
        setRows(Array.isArray(data.settlements) ? data.settlements : []);
        setTotal(Number(data.total) || 0);
        setTotalPages(Math.max(1, Number(data.totalPages) || 1));
      } catch (err) {
        if (reqId !== listReq.current) return;
        setListError(apiError(err, "Could not load settlements."));
        setRows([]);
      } finally {
        if (reqId === listReq.current) setListLoading(false);
      }
    })();
  }, [page, search, statusFilter, refreshKey]);

  // Load detail
  const loadDetail = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    const reqId = ++detailReq.current;
    if (!silent) setDetailLoading(true);
    setDetailError("");
    try {
      const res = await api.get(`/settlements/${id}`);
      if (reqId !== detailReq.current) return;
      const s = res.data?.settlement || null;
      setDetail(s);
      setEarnings((s?.financialBreakdown?.earnings || []).map((it) => ({ ...it })));
      setDeductions((s?.financialBreakdown?.deductions || []).map((it) => ({ ...it })));
      setHrRemarks(s?.exitDetails?.hrRemarks || "");
      setAdjustmentRemarks("");
    } catch (err) {
      if (reqId !== detailReq.current) return;
      setDetailError(apiError(err, "Could not load settlement details."));
    } finally {
      if (reqId === detailReq.current && !silent) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      detailReq.current += 1;
      setDetail(null);
      setActionError("");
      return;
    }
    setDetail(null);
    setActionError("");
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const status = detail?.status || "";
  const isEditable = status === "DRAFT" || status === "ON_HOLD";

  const isDirty = useMemo(() => {
    if (!detail || !isEditable) return false;
    const base = detail.financialBreakdown || {};
    const strip = (items) =>
      (items || []).map((it) => ({
        id: it.id,
        title: it.title,
        category: it.category,
        amount: amountOf(it),
      }));
    return (
      JSON.stringify(strip(earnings)) !== JSON.stringify(strip(base.earnings)) ||
      JSON.stringify(strip(deductions)) !== JSON.stringify(strip(base.deductions)) ||
      (hrRemarks || "") !== (detail.exitDetails?.hrRemarks || "") ||
      Boolean(adjustmentRemarks.trim())
    );
  }, [detail, isEditable, earnings, deductions, hrRemarks, adjustmentRemarks]);

  const totals = useMemo(() => {
    if (isEditable) {
      const totalEarnings = sumItems(earnings);
      const totalDeductions = sumItems(deductions);
      return {
        totalEarnings,
        totalDeductions,
        net: Math.max(0, totalEarnings - totalDeductions),
      };
    }
    const fb = detail?.financialBreakdown || {};
    return {
      totalEarnings: Number(fb.totalEarnings) || 0,
      totalDeductions: Number(fb.totalDeductions) || 0,
      net: Number(fb.netSettlementAmount) || 0,
    };
  }, [isEditable, earnings, deductions, detail]);

  const openSettlement = (id) => {
    setSelectedId(String(id));
  };

  const closeDetail = () => {
    setSelectedId("");
    setDetailError("");
  };

  // ---------------- line item editing ----------------
  const openLineModal = (kind, index = null) => {
    const list = kind === "earning" ? earnings : deductions;
    if (index != null) {
      const item = list[index];
      setLineModal({
        kind,
        index,
        title: item?.title || "",
        category: item?.category || "OTHER",
        amount: String(item?.amount ?? ""),
        isSystemCalculated: Boolean(item?.isSystemCalculated),
        error: "",
      });
    } else {
      setLineModal({ kind, index: null, title: "", category: "OTHER", amount: "", error: "" });
    }
  };

  const submitLine = (event) => {
    event.preventDefault();
    if (!lineModal) return;
    const title = lineModal.title.trim();
    const amount = parseFloat(lineModal.amount);
    if (!title) {
      setLineModal((m) => ({ ...m, error: "Title is required." }));
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setLineModal((m) => ({ ...m, error: "Enter a valid amount (0 or more)." }));
      return;
    }
    const setList = lineModal.kind === "earning" ? setEarnings : setDeductions;
    if (lineModal.index != null) {
      setList((prev) =>
        prev.map((it, i) => (i === lineModal.index ? { ...it, title, amount } : it))
      );
    } else {
      setList((prev) => [
        ...prev,
        {
          id: `custom_${lineModal.kind === "earning" ? "earn" : "ded"}_${Date.now()}`,
          title,
          category: lineModal.category,
          amount,
          isSystemCalculated: false,
          remarks: "Manually added by HR Admin",
        },
      ]);
    }
    setLineModal(null);
  };

  const removeLine = () => {
    if (!lineModal || lineModal.index == null) return;
    const setList = lineModal.kind === "earning" ? setEarnings : setDeductions;
    setList((prev) => prev.filter((_, i) => i !== lineModal.index));
    setLineModal(null);
  };

  // ---------------- actions ----------------
  const saveDraft = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const res = await api.patch(`/settlements/${detail._id}`, {
        earnings,
        deductions,
        hrRemarks,
        manualAdjustmentRemarks: adjustmentRemarks,
      });
      toast.push(res.data?.message || "Settlement draft saved.");
      await loadDetail(detail._id, { silent: true });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(apiError(err, "Could not save settlement changes."));
    } finally {
      setBusy(false);
    }
  };

  // Resolves to "" on success, or an error message on failure.
  const transition = async (targetStatus, reason = "") => {
    if (!detail) return "No settlement selected.";
    setActionError("");
    try {
      const res = await api.post(`/settlements/${detail._id}/status`, {
        status: targetStatus,
        reason,
        remarks: reason,
        ...(targetStatus === "ON_HOLD" ? { holdReason: reason } : {}),
      });
      toast.push(res.data?.message || `Moved to ${STATUS_LABELS[targetStatus] || targetStatus}.`);
      await loadDetail(detail._id, { silent: true });
      setRefreshKey((k) => k + 1);
      return "";
    } catch (err) {
      const message = apiError(err, `Could not move settlement to ${STATUS_LABELS[targetStatus] || targetStatus}.`);
      setActionError(message);
      return message;
    }
  };

  const runConfirm = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      if (confirm.complete) {
        setActionError("");
        try {
          const res = await api.post(`/settlements/${detail._id}/complete`);
          toast.push(res.data?.message || "Settlement completed.");
          await loadDetail(detail._id, { silent: true });
          setRefreshKey((k) => k + 1);
        } catch (err) {
          setActionError(apiError(err, "Could not complete settlement."));
        }
      } else {
        await transition(confirm.status, confirm.remarks || "");
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const submitHold = async (event) => {
    event.preventDefault();
    if (busy) return;
    const reason = holdReason.trim();
    if (!reason) {
      setHoldError("A reason is required to place a settlement on hold.");
      return;
    }
    setBusy(true);
    setHoldError("");
    const failure = await transition("ON_HOLD", reason);
    setBusy(false);
    if (failure) {
      setHoldError(failure);
    } else {
      setHoldOpen(false);
      setHoldReason("");
    }
  };

  const openPay = () => {
    setPayForm({
      paymentDate: todayInputValue(),
      paymentMethod: "NEFT_RTGS",
      referenceNumber: "",
      remarks: "",
    });
    setPayError("");
    setPayOpen(true);
  };

  const submitPay = async (event) => {
    event.preventDefault();
    if (!detail || busy) return;
    if (!payForm.paymentDate) {
      setPayError("Payment date is required.");
      return;
    }
    if (!payForm.paymentMethod) {
      setPayError("Payment method is required.");
      return;
    }
    setBusy(true);
    setPayError("");
    try {
      const res = await api.post(`/settlements/${detail._id}/pay`, {
        paymentDate: payForm.paymentDate,
        paymentMethod: payForm.paymentMethod,
        referenceNumber: payForm.referenceNumber.trim(),
        remarks: payForm.remarks.trim(),
      });
      toast.push(res.data?.message || "Payment recorded.");
      setPayOpen(false);
      await loadDetail(detail._id, { silent: true });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setPayError(apiError(err, "Could not record payment."));
    } finally {
      setBusy(false);
    }
  };

  const askConfirm = (cfg) => setConfirm(cfg);

  // ---------------- detail view ----------------
  if (selectedId) {
    const emp = employeeOf(detail);
    const name = emp.fullName || "Employee";
    const exit = detail?.exitDetails || {};
    const calc = detail?.calculationInputs || {};
    const flags = Array.isArray(calc.missingDataFlags) ? calc.missingDataFlags : [];
    const pay = detail?.paymentDetails || {};
    const hasPayment = Boolean(pay.paymentDate);
    const history = [...(detail?.statusHistory || [])].reverse();
    const adjustments = [...(detail?.adjustmentsHistory || [])].reverse();
    const currentStep = STEPS.indexOf(status === "ON_HOLD" ? "UNDER_REVIEW" : status);
    const needsSaveFirst = isEditable && isDirty;

    const renderLines = (kind, items) => {
      const label = kind === "earning" ? "Earnings" : "Deductions";
      const sum = kind === "earning" ? totals.totalEarnings : totals.totalDeductions;
      return (
        <section className="card st-ff-section">
          <div className="st-ff-section-head">
            <h3 className={kind === "earning" ? "is-earn" : "is-ded"}>{label}</h3>
            {isEditable ? (
              <button
                type="button"
                className="st-ff-add"
                onClick={() => openLineModal(kind)}
                disabled={busy}
              >
                <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                Add
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="st-ff-empty">No {label.toLowerCase()} recorded.</p>
          ) : (
            <ul className="st-ff-lines">
              {items.map((item, idx) => (
                <li key={`${item.id || "line"}-${idx}`}>
                  <div className="st-ff-line-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {categoryLabel(item.category)}
                      {item.isSystemCalculated ? " · System calculated" : ""}
                    </span>
                    {item.remarks ? <em>{item.remarks}</em> : null}
                  </div>
                  <div className="st-ff-line-amt">
                    <b className={kind === "earning" ? "is-earn" : "is-ded"}>
                      {kind === "earning" ? "" : "− "}
                      {money(item.amount)}
                    </b>
                    {isEditable ? (
                      <button
                        type="button"
                        className="icon-btn st-ff-edit"
                        aria-label={`Edit ${item.title}`}
                        onClick={() => openLineModal(kind, idx)}
                        disabled={busy}
                      >
                        <Pencil size={16} strokeWidth={1.9} />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="st-ff-total-row">
            <span>Total {label.toLowerCase()}</span>
            <strong className={kind === "earning" ? "is-earn" : "is-ded"}>{money(sum)}</strong>
          </div>
        </section>
      );
    };

    return (
      <div className="st-ff">
        <button type="button" className="st-ff-back" onClick={closeDetail}>
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          Back to settlements
        </button>

        {detailLoading && !detail ? <Skeleton rows={4} /> : null}

        {detailError && !detail ? (
          <ErrorState message={detailError} onRetry={() => loadDetail(selectedId)} />
        ) : null}

        {detail ? (
          <>
            {actionError ? <div className="alert alert-error" role="alert">{actionError}</div> : null}

            {/* Overview */}
            <section className="card st-ff-overview">
              <div className="st-ff-emp">
                <span className="st-pay-avatar">{initialsFrom(name)}</span>
                <div className="st-pay-copy">
                  <strong>{name}</strong>
                  <span>
                    {emp.employeeCode || "—"}
                    {emp.job?.jobTitle ? ` · ${emp.job.jobTitle}` : ""}
                  </span>
                </div>
                <StatusBadge status={status} label={STATUS_LABELS[status]} />
              </div>

              {status === "ON_HOLD" ? (
                <div className="alert alert-warn" role="status">
                  <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
                  <span>On hold: {detail.holdReason || "Processing paused"}</span>
                </div>
              ) : null}

              <ol className="st-ff-steps" aria-label="Settlement progress">
                {STEPS.map((step, i) => (
                  <li
                    key={step}
                    className={
                      i < currentStep ? "is-done" : i === currentStep ? "is-current" : ""
                    }
                  >
                    <i aria-hidden="true" />
                    <span>{STATUS_LABELS[step]}</span>
                  </li>
                ))}
              </ol>

              <div className="st-pay-overview-net">
                <span>Net settlement{isEditable && isDirty ? " (unsaved preview)" : ""}</span>
                <strong>{money(totals.net)}</strong>
              </div>
            </section>

            {/* Employee + exit */}
            <section className="card st-ff-section">
              <div className="st-ff-section-head">
                <h3>Employee &amp; exit details</h3>
              </div>
              <DetailRow label="Employee" value={name} />
              <DetailRow label="Employee code" value={emp.employeeCode} />
              <DetailRow label="Job title" value={emp.job?.jobTitle} />
              <DetailRow label="Email" value={emp.email} />
              <DetailRow label="Last working day" value={formatDate(exit.lastWorkingDay)} />
              <DetailRow label="Exit reason" value={exit.exitReason} />
              <DetailRow
                label="Initiated"
                value={`${formatDateTime(exit.initiatedAt || detail.createdAt)}${
                  userLabel(exit.initiatedBy) ? ` · ${userLabel(exit.initiatedBy)}` : ""
                }`}
              />
              {!isEditable ? <DetailRow label="HR remarks" value={exit.hrRemarks} /> : null}
            </section>

            {/* Data flags */}
            {flags.length > 0 ? (
              <div className="alert alert-warn" role="status">
                <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
                <div>
                  <strong>Review required</strong>
                  <ul className="st-ff-flags">
                    {flags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {/* Calculation basis (read-only) */}
            <section className="card st-ff-section">
              <div className="st-ff-section-head">
                <h3>Calculation basis</h3>
              </div>
              <div className="st-pay-overview-grid">
                <div>
                  <span>Monthly CTC</span>
                  <strong>{money(calc.monthlyCtc)}</strong>
                </div>
                <div>
                  <span>Basic salary</span>
                  <strong>{money(calc.basicSalary)}</strong>
                </div>
                <div>
                  <span>Days worked</span>
                  <strong>
                    {calc.workedDaysInExitMonth ?? 0} / {calc.workingDaysInExitMonth ?? 0}
                  </strong>
                </div>
                <div>
                  <span>Earned leave</span>
                  <strong>{calc.earnedLeaveBalance ?? 0} days</strong>
                </div>
              </div>
            </section>

            {renderLines("earning", isEditable ? earnings : detail.financialBreakdown?.earnings || [])}
            {renderLines("deduction", isEditable ? deductions : detail.financialBreakdown?.deductions || [])}

            {/* Totals */}
            <section className="card st-ff-section st-ff-net">
              <div className="st-ff-total-row">
                <span>Total earnings</span>
                <strong className="is-earn">{money(totals.totalEarnings)}</strong>
              </div>
              <div className="st-ff-total-row">
                <span>Total deductions</span>
                <strong className="is-ded">− {money(totals.totalDeductions)}</strong>
              </div>
              <div className="st-ff-total-row st-ff-net-row">
                <span>Net settlement</span>
                <strong>{money(totals.net)}</strong>
              </div>
            </section>

            {/* Remarks (editable only in DRAFT / ON_HOLD) */}
            {isEditable ? (
              <section className="card st-ff-section">
                <div className="st-ff-section-head">
                  <h3>Remarks</h3>
                </div>
                <div className="form-grid">
                  <label>
                    HR offboarding remarks
                    <textarea
                      value={hrRemarks}
                      onChange={(event) => setHrRemarks(event.target.value)}
                      placeholder="Enter HR settlement notes..."
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Adjustment explanation (audit trail)
                    <input
                      type="text"
                      value={adjustmentRemarks}
                      onChange={(event) => setAdjustmentRemarks(event.target.value)}
                      placeholder="Why were amounts changed?"
                      disabled={busy}
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {/* Payment */}
            <section className="card st-ff-section">
              <div className="st-ff-section-head">
                <h3>Payment</h3>
                <StatusBadge
                  status={hasPayment ? "PAID" : "PENDING"}
                  label={hasPayment ? "Paid" : "Not paid"}
                />
              </div>
              {hasPayment ? (
                <>
                  <DetailRow label="Paid on" value={formatDate(pay.paymentDate)} />
                  <DetailRow label="Method" value={methodLabel(pay.paymentMethod)} />
                  <DetailRow label="Reference" value={pay.referenceNumber} />
                  <DetailRow label="Remarks" value={pay.remarks} />
                  <DetailRow
                    label="Recorded"
                    value={`${formatDateTime(pay.recordedAt)}${
                      userLabel(pay.recordedBy) ? ` · ${userLabel(pay.recordedBy)}` : ""
                    }`}
                  />
                </>
              ) : (
                <p className="st-ff-empty">
                  {status === "APPROVED"
                    ? "Approved and ready for payment."
                    : "Payment can be recorded once the settlement is approved."}
                </p>
              )}
            </section>

            {/* Status history */}
            <section className="card st-ff-section">
              <div className="st-ff-section-head">
                <h3>Status history</h3>
              </div>
              {history.length === 0 ? (
                <p className="st-ff-empty">No history yet.</p>
              ) : (
                <ol className="st-ff-history">
                  {history.map((entry, i) => (
                    <li key={`${entry.status}-${entry.changedAt}-${i}`}>
                      <div className="st-ff-history-head">
                        <StatusBadge status={entry.status} label={STATUS_LABELS[entry.status]} />
                        <span>{formatDateTime(entry.changedAt)}</span>
                      </div>
                      {entry.remarks ? <p>{entry.remarks}</p> : null}
                      {userLabel(entry.changedBy) ? <em>by {userLabel(entry.changedBy)}</em> : null}
                    </li>
                  ))}
                </ol>
              )}
              {adjustments.length > 0 ? (
                <>
                  <h4 className="st-ff-subhead">Manual adjustments</h4>
                  <ol className="st-ff-history">
                    {adjustments.map((adj, i) => (
                      <li key={`${adj.adjustedAt}-${i}`}>
                        <div className="st-ff-history-head">
                          <strong>
                            {money(adj.previousNet)} → {money(adj.newNet)}
                          </strong>
                          <span>{formatDateTime(adj.adjustedAt)}</span>
                        </div>
                        {adj.remarks ? <p>{adj.remarks}</p> : null}
                        {userLabel(adj.adjustedBy) ? <em>by {userLabel(adj.adjustedBy)}</em> : null}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
            </section>

            {/* Actions by status */}
            <section className="card st-ff-section st-ff-actions">
              <div className="st-ff-section-head">
                <h3>Actions</h3>
              </div>
              {needsSaveFirst ? (
                <p className="st-ff-hint">You have unsaved changes. Save them before moving the settlement forward.</p>
              ) : null}

              {status === "DRAFT" ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary btn-block"
                    onClick={saveDraft}
                    disabled={busy || !isDirty}
                  >
                    {busy ? "Saving..." : "Save draft"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-block"
                    disabled={busy || needsSaveFirst}
                    onClick={() =>
                      askConfirm({
                        status: "UNDER_REVIEW",
                        title: "Submit for review",
                        message: "Submit this settlement for review? Amounts will be locked until it is returned to draft or put on hold.",
                        confirmLabel: "Submit",
                      })
                    }
                  >
                    Submit for review
                  </button>
                </>
              ) : null}

              {status === "UNDER_REVIEW" ? (
                <>
                  <button
                    type="button"
                    className="btn-primary btn-block"
                    disabled={busy}
                    onClick={() =>
                      askConfirm({
                        status: "APPROVED",
                        title: "Approve settlement",
                        message: `Approve the full & final settlement of ${money(totals.net)} for ${name}?`,
                        confirmLabel: "Approve",
                      })
                    }
                  >
                    Approve settlement
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-block"
                    disabled={busy}
                    onClick={() =>
                      askConfirm({
                        status: "DRAFT",
                        remarks: "Returned to draft for amendments",
                        title: "Return to draft",
                        message: "Return this settlement to draft so amounts can be edited?",
                        confirmLabel: "Return to draft",
                      })
                    }
                  >
                    Return to draft
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-block st-ff-warn"
                    disabled={busy}
                    onClick={() => {
                      setHoldReason("");
                      setHoldError("");
                      setHoldOpen(true);
                    }}
                  >
                    Place on hold
                  </button>
                </>
              ) : null}

              {status === "ON_HOLD" ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary btn-block"
                    onClick={saveDraft}
                    disabled={busy || !isDirty}
                  >
                    {busy ? "Saving..." : "Save changes"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-block"
                    disabled={busy || needsSaveFirst}
                    onClick={() =>
                      askConfirm({
                        status: "UNDER_REVIEW",
                        remarks: "Hold resumed",
                        title: "Resume review",
                        message: "Resume review of this settlement?",
                        confirmLabel: "Resume review",
                      })
                    }
                  >
                    Resume review
                  </button>
                </>
              ) : null}

              {status === "APPROVED" ? (
                <>
                  <button type="button" className="btn-primary btn-block" disabled={busy} onClick={openPay}>
                    Record payment
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-block st-ff-warn"
                    disabled={busy}
                    onClick={() => {
                      setHoldReason("");
                      setHoldError("");
                      setHoldOpen(true);
                    }}
                  >
                    Place on hold
                  </button>
                </>
              ) : null}

              {status === "PAID" ? (
                <button
                  type="button"
                  className="btn-primary btn-block"
                  disabled={busy}
                  onClick={() =>
                    askConfirm({
                      complete: true,
                      title: "Complete & close",
                      message:
                        "Formally complete and close this settlement? This marks the F&F cycle as finished.",
                      confirmLabel: "Complete",
                    })
                  }
                >
                  Complete &amp; close settlement
                </button>
              ) : null}

              {status === "COMPLETED" ? (
                <p className="st-ff-closed">Settlement formally closed.</p>
              ) : null}
            </section>
          </>
        ) : null}

        {/* Line item modal */}
        <Modal
          open={Boolean(lineModal)}
          onClose={() => setLineModal(null)}
          title={
            lineModal
              ? `${lineModal.index != null ? "Edit" : "Add"} ${
                  lineModal.kind === "earning" ? "earning" : "deduction"
                }`
              : ""
          }
          footer={
            <>
              {lineModal?.index != null ? (
                <button type="button" className="btn-danger" onClick={removeLine}>
                  <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
                  Remove
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setLineModal(null)}>
                  Cancel
                </button>
              )}
              <button type="submit" form="ff-line-form" className="btn-primary">
                {lineModal?.index != null ? "Update" : "Add"}
              </button>
            </>
          }
        >
          {lineModal ? (
            <form id="ff-line-form" className="form-grid" onSubmit={submitLine}>
              {lineModal.error ? <div className="alert alert-error">{lineModal.error}</div> : null}
              <label>
                Title
                <input
                  value={lineModal.title}
                  onChange={(event) => setLineModal((m) => ({ ...m, title: event.target.value }))}
                  placeholder={lineModal.kind === "earning" ? "e.g. Incentive / Bonus" : "e.g. Notice recovery"}
                  autoFocus
                />
              </label>
              {lineModal.index == null ? (
                <label>
                  Category
                  <select
                    value={lineModal.category}
                    onChange={(event) => setLineModal((m) => ({ ...m, category: event.target.value }))}
                  >
                    {(lineModal.kind === "earning" ? EARNING_CATEGORIES : DEDUCTION_CATEGORIES).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Amount (₹)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={lineModal.amount}
                  onChange={(event) => setLineModal((m) => ({ ...m, amount: event.target.value }))}
                  placeholder="0.00"
                />
              </label>
            </form>
          ) : null}
        </Modal>

        {/* Hold modal */}
        <Modal
          open={holdOpen}
          onClose={() => (!busy ? setHoldOpen(false) : null)}
          title="Place on hold"
          footer={
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setHoldOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="ff-hold-form" className="btn-primary" disabled={busy}>
                {busy ? "Saving..." : "Place on hold"}
              </button>
            </>
          }
        >
          <form id="ff-hold-form" className="form-grid" onSubmit={submitHold}>
            {holdError ? <div className="alert alert-error">{holdError}</div> : null}
            <label>
              Reason
              <textarea
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                placeholder="Why is this settlement being held?"
              />
            </label>
          </form>
        </Modal>

        {/* Payment modal */}
        <Modal
          open={payOpen}
          onClose={() => (!busy ? setPayOpen(false) : null)}
          title="Record payment"
          footer={
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPayOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="ff-pay-form" className="btn-primary" disabled={busy}>
                {busy ? "Saving..." : "Record payment"}
              </button>
            </>
          }
        >
          <form id="ff-pay-form" className="form-grid" onSubmit={submitPay}>
            {payError ? <div className="alert alert-error">{payError}</div> : null}
            <p className="st-ff-hint">Net amount: <strong>{money(totals.net)}</strong></p>
            <label>
              Payment date
              <input
                type="date"
                value={payForm.paymentDate}
                onChange={(event) => setPayForm((f) => ({ ...f, paymentDate: event.target.value }))}
              />
            </label>
            <label>
              Payment method
              <select
                value={payForm.paymentMethod}
                onChange={(event) => setPayForm((f) => ({ ...f, paymentMethod: event.target.value }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reference number (optional)
              <input
                value={payForm.referenceNumber}
                onChange={(event) => setPayForm((f) => ({ ...f, referenceNumber: event.target.value }))}
                placeholder="UTR / cheque no."
              />
            </label>
            <label>
              Remarks (optional)
              <textarea
                value={payForm.remarks}
                onChange={(event) => setPayForm((f) => ({ ...f, remarks: event.target.value }))}
              />
            </label>
          </form>
        </Modal>

        <ConfirmDialog
          open={Boolean(confirm)}
          onClose={() => (!busy ? setConfirm(null) : null)}
          title={confirm?.title || "Confirm"}
          message={confirm?.message}
          confirmLabel={confirm?.confirmLabel || "Confirm"}
          busy={busy}
          onConfirm={runConfirm}
        />
      </div>
    );
  }

  // ---------------- list view ----------------
  return (
    <div className="st-ff">
      <div className="st-att-search">
        <Search size={18} strokeWidth={1.85} aria-hidden="true" />
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search name, ID or exit reason"
          aria-label="Search settlements"
        />
      </div>

      <div className="st-pill-row" role="tablist" aria-label="Settlement status filters">
        {STATUS_FILTERS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`st-pill${statusFilter === chip.value ? " is-active" : ""}`}
            onClick={() => {
              setStatusFilter(chip.value);
              setPage(1);
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="st-pay-list-head">
        <h2>Full &amp; final settlements</h2>
        <button
          type="button"
          className="st-ff-refresh"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={listLoading}
          aria-label="Refresh settlements"
        >
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {listError ? (
        <ErrorState message={listError} onRetry={() => setRefreshKey((k) => k + 1)} />
      ) : listLoading && rows.length === 0 ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            search || statusFilter !== "ALL"
              ? "No settlements match your filters."
              : "No settlements yet. Start one from an employee's profile."
          }
        />
      ) : (
        <>
          <div className="st-pay-list" aria-busy={listLoading}>
            {rows.map((row) => {
              const emp = employeeOf(row);
              const name = emp.fullName || "Employee";
              const net = row.financialBreakdown?.netSettlementAmount;
              return (
                <button
                  key={row._id}
                  type="button"
                  className="st-pay-card"
                  onClick={() => openSettlement(row._id)}
                >
                  <span className="st-pay-avatar-wrap">
                    <span className="st-pay-avatar">{initialsFrom(name)}</span>
                    <span className="st-pay-avatar-badge" aria-hidden="true">
                      <Handshake size={12} strokeWidth={2} />
                    </span>
                  </span>
                  <span className="st-pay-copy">
                    <strong>{name}</strong>
                    <span>
                      {emp.employeeCode ? `${emp.employeeCode} · ` : ""}
                      Last day {formatDate(row.exitDetails?.lastWorkingDay)}
                    </span>
                    <span>
                      Net {money(net)}
                      {row.exitDetails?.exitReason ? ` · ${row.exitDetails.exitReason}` : ""}
                    </span>
                  </span>
                  <span className="st-pay-side">
                    <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} />
                    <ChevronRight size={18} strokeWidth={1.85} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="settlements"
          />
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import Modal from "../../components/Modal";
import MonthNav, { monthYearLabel } from "../../components/MonthNav";
import Icon from "../../components/Icon";
import api from "../../services/api";
import { formatDisplayDate } from "../../utils/dateUtils";
import { usePayslipsQuery, useSettlementQuery } from "../../hooks/useEmployeeQueries";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isOfficialPayslip(item) {
  if (!item || item.isPersisted === false) return false;
  const status = String(item.status || "").toUpperCase();
  if (status === "DRAFT" || status === "CANCELLED") return false;
  return Boolean(item._id || item.id);
}

function slipId(item) {
  return item?._id || item?.id || "";
}

function currencySymbol(item) {
  return item?.currencySymbol || "₹";
}

function formatMoney(amount, item) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `${currencySymbol(item)}${n.toLocaleString("en-IN")}`;
}

function monthLabel(item) {
  const month = Number(item?.periodMonth);
  const year = Number(item?.periodYear);
  if (month >= 1 && month <= 12 && year) return `${MONTHS[month - 1]} ${year}`;
  return item?.payslipNumber || "Payslip";
}

function netAmount(item) {
  const n = Number(item?.netPayable ?? item?.netPay);
  return Number.isFinite(n) ? n : null;
}

function earningsAmount(item) {
  if (Number.isFinite(Number(item?.grossEarnings))) return Number(item.grossEarnings);
  if (Number.isFinite(Number(item?.totalEarnings))) return Number(item.totalEarnings);
  if (Array.isArray(item?.earnings) && item.earnings.length) {
    const sum = item.earnings.reduce((total, line) => total + Number(line.amount || 0), 0);
    return Number.isFinite(sum) ? sum : null;
  }
  return null;
}

function deductionsAmount(item) {
  if (Number.isFinite(Number(item?.totalDeductions))) return Number(item.totalDeductions);
  if (item?.deductions != null && !Array.isArray(item.deductions) && Number.isFinite(Number(item.deductions))) {
    return Number(item.deductions);
  }
  return null;
}

function paymentDateValue(item) {
  const payments = Array.isArray(item?.payments) ? item.payments : [];
  const dated = payments.filter((payment) => payment?.paymentDate);
  if (!dated.length) return "";
  return dated[dated.length - 1].paymentDate;
}

function shortDate(value) {
  const formatted = formatDisplayDate(value);
  if (!formatted || formatted === "—") return "";
  return formatted.replace(/\s+\d{4}$/, "");
}

function periodLabel(item) {
  if (item?.periodStartDate && item?.periodEndDate) {
    const start = shortDate(item.periodStartDate);
    const end = shortDate(item.periodEndDate);
    if (start && end) return `${start} – ${end}`;
  }
  const month = Number(item?.periodMonth);
  const year = Number(item?.periodYear);
  if (!(month >= 1 && month <= 12) || !year) return "";
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value) => String(value).padStart(2, "0");
  const start = shortDate(`${year}-${pad(month)}-01`);
  const end = shortDate(`${year}-${pad(month)}-${pad(lastDay)}`);
  return start && end ? `${start} – ${end}` : "";
}

function listCaption(item) {
  const paidOn = paymentDateValue(item);
  const isPaid = String(item?.paymentStatus || item?.status || "").toUpperCase() === "PAID";
  if (isPaid && paidOn) return `Disbursed on ${formatDisplayDate(paidOn)}`;
  const period = periodLabel(item);
  return period || item?.payslipNumber || "";
}

function MiniIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function EmployeePayslipsPage() {
  const payslipsQuery = usePayslipsQuery();
  const settlementQuery = useSettlementQuery();
  const items = useMemo(() => payslipsQuery.data || [], [payslipsQuery.data]);
  const settlement = settlementQuery.data || null;
  const loading = payslipsQuery.isLoading && items.length === 0;
  const [actionError, setActionError] = useState("");
  const error = actionError
    || payslipsQuery.error?.response?.data?.message
    || payslipsQuery.error?.message
    || "";
  const [selected, setSelected] = useState(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [monthReady, setMonthReady] = useState(false);

  const load = () => Promise.all([payslipsQuery.refetch(), settlementQuery.refetch()]);

  const official = useMemo(
    () => (Array.isArray(items) ? items.filter(isOfficialPayslip) : []),
    [items]
  );

  useEffect(() => {
    if (monthReady || !official.length) return;
    const first = official[0];
    if (first?.periodMonth && first?.periodYear) {
      setViewMonth(Number(first.periodMonth));
      setViewYear(Number(first.periodYear));
    }
    setMonthReady(true);
  }, [official, monthReady]);

  const monthSlips = useMemo(
    () =>
      official.filter(
        (item) =>
          Number(item.periodMonth) === Number(viewMonth) &&
          Number(item.periodYear) === Number(viewYear)
      ),
    [official, viewMonth, viewYear]
  );

  const latest = monthSlips[0] || null;
  const previous = official.filter((item) => slipId(item) !== slipId(latest));
  const net = latest ? netAmount(latest) : null;
  const earnings = latest ? earningsAmount(latest) : null;
  const deductions = latest ? deductionsAmount(latest) : null;
  const showSummary = latest && earnings != null && deductions != null && net != null;
  const takeHomePct = showSummary && earnings > 0 ? Math.min(100, Math.max(0, (net / earnings) * 100)) : null;

  const download = async (payslip) => {
    const id = slipId(payslip);
    if (!id || payslip?.isPersisted === false) {
      setActionError("This payslip cannot be downloaded.");
      return;
    }
    try {
      setDownloading(true);
      setActionError("");
      let response;
      try {
        response = await api.get(`/payroll/employee/payslips/${id}/download`, { responseType: "blob" });
      } catch {
        response = await api.get(`/employees/me/payslips/${id}/download`, { responseType: "blob" });
      }
      const contentType = String(response.headers?.["content-type"] || response.data?.type || "");
      if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
        throw new Error("Payslip PDF was not returned.");
      }
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payslip.payslipNumber || "payslip"}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err.response?.data?.message || err.message || "Could not download this payslip.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="My Payslips" back />
        <Skeleton rows={4} />
      </>
    );
  }

  if (error && official.length === 0) {
    return (
      <>
        <PageHeader title="My Payslips" back />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="My Payslips" back />
      {(payslipsQuery.isFetching || settlementQuery.isFetching) && items.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <MonthNav
        month={viewMonth}
        year={viewYear}
        onChange={({ month, year }) => {
          setViewMonth(month);
          setViewYear(year);
        }}
        label="Payslip month"
        className="ps-month-nav"
      />

      {settlement ? (
        <button type="button" className="card compact-card" style={{ width: "100%", textAlign: "left", marginBottom: 12 }} onClick={() => setSettlementOpen(true)}>
          <span className="summary-title">Full & final settlement</span>
          <span className="summary-sub" style={{ display: "block", marginTop: 4 }}>
            {settlement.settlementNumber || "Exit settlement"} · {settlement.status || "On file"}
          </span>
        </button>
      ) : null}

      {official.length === 0 ? (
        <EmptyState message="No payslips yet." />
      ) : !latest ? (
        <EmptyState message={`No payslip for ${monthYearLabel(viewMonth, viewYear)}.`} />
      ) : (
        <div className="ps-page">
          {latest ? (
            <section className="ps-featured">
              <div className="ps-featured-top">
                <span className="ps-month">{monthLabel(latest)}</span>
                <StatusBadge status={latest.paymentStatus || latest.status} />
              </div>
              {net != null ? (
                <div className="ps-net">
                  <p className="ps-kicker">Net Pay</p>
                  <p className="ps-net-value">
                    {formatMoney(net, latest)}
                    {latest.currency ? <span>{latest.currency}</span> : null}
                  </p>
                </div>
              ) : null}
              {paymentDateValue(latest) || periodLabel(latest) ? (
                <div className="ps-meta">
                  {paymentDateValue(latest) ? (
                    <div className="ps-meta-tile">
                      <span className="ps-meta-icon">
                        <MiniIcon>
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </MiniIcon>
                      </span>
                      <span>
                        <small>Pay Date</small>
                        <strong>{formatDisplayDate(paymentDateValue(latest))}</strong>
                      </span>
                    </div>
                  ) : null}
                  {periodLabel(latest) ? (
                    <div className="ps-meta-tile">
                      <span className="ps-meta-icon">
                        <MiniIcon>
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                          <path d="M8 14h.01M12 14h.01M16 14h.01" />
                        </MiniIcon>
                      </span>
                      <span>
                        <small>Pay Period</small>
                        <strong>{periodLabel(latest)}</strong>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button type="button" className="btn-primary btn-block" onClick={() => setSelected(latest)}>
                View Payslip
              </button>
            </section>
          ) : null}

          {showSummary ? (
            <section className="ps-summary">
              <div className="ps-summary-head">
                <span>Salary Summary</span>
                {String(latest.paymentStatus || "").toUpperCase() === "PAID" ? (
                  <em>Paid</em>
                ) : null}
              </div>
              <div className="ps-summary-grid">
                <div>
                  <small>Earnings</small>
                  <strong>{formatMoney(earnings, latest)}</strong>
                </div>
                <div>
                  <small>Deductions</small>
                  <strong className="is-deduction">-{formatMoney(deductions, latest)}</strong>
                </div>
                <div>
                  <small>Net Salary</small>
                  <strong className="is-net">{formatMoney(net, latest)}</strong>
                </div>
              </div>
              {takeHomePct != null ? (
                <>
                  <div className="mix-bar" aria-hidden="true">
                    <span style={{ flex: `${takeHomePct} 0 0`, background: "var(--g-700)" }} />
                    <span style={{ flex: `${100 - takeHomePct} 0 0`, background: "var(--rose)" }} />
                  </div>
                  <div className="ps-legend">
                    <span>Take-home ({takeHomePct.toFixed(1)}%)</span>
                    <span>Deductions ({(100 - takeHomePct).toFixed(1)}%)</span>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          {previous.length > 0 ? (
            <section>
              <div className="section-head">
                <h2 className="section-title">Other Payslips</h2>
              </div>
              <div className="ps-list">
                {previous.map((item) => (
                  <button
                    key={slipId(item)}
                    type="button"
                    className="ps-row"
                    onClick={() => {
                      if (item.periodMonth && item.periodYear) {
                        setViewMonth(Number(item.periodMonth));
                        setViewYear(Number(item.periodYear));
                      }
                      setSelected(item);
                    }}
                  >
                    <span className="ps-row-icon"><Icon name="payslips" size={18} /></span>
                    <span className="summary-body">
                      <span className="summary-title">{monthLabel(item)}</span>
                      <span className="summary-sub">{listCaption(item)}</span>
                    </span>
                    <span className="ps-row-end">
                      {netAmount(item) != null ? <strong>{formatMoney(netAmount(item), item)}</strong> : null}
                      <StatusBadge status={item.paymentStatus || item.status} />
                    </span>
                    <span className="chevron" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <Modal
        open={settlementOpen}
        onClose={() => setSettlementOpen(false)}
        title="Full & final settlement"
      >
        {settlement ? (
          <dl className="lv-detail">
            <div>
              <dt>Reference</dt>
              <dd>{settlement.settlementNumber || settlement._id}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusBadge status={settlement.status} /></dd>
            </div>
            <div>
              <dt>Gross earnings</dt>
              <dd>₹{Number(settlement.totalEarnings || 0).toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>Deductions</dt>
              <dd>₹{Number(settlement.totalDeductions || 0).toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>Net settlement</dt>
              <dd>₹{Number(settlement.netSettlementAmount || 0).toLocaleString("en-IN")}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? monthLabel(selected) : "Payslip"}
        footer={
          <button
            type="button"
            className="btn-primary"
            disabled={downloading || !selected || !slipId(selected)}
            onClick={() => download(selected)}
          >
            {downloading ? "Downloading..." : "Download payslip"}
          </button>
        }
      >
        {selected ? (
          <>
            {selected.payslipNumber ? <p className="caption">{selected.payslipNumber}</p> : null}
            {periodLabel(selected) ? <p className="caption" style={{ marginTop: 6 }}>{periodLabel(selected)}</p> : null}
            {netAmount(selected) != null ? (
              <p className="ps-sheet-net">{formatMoney(netAmount(selected), selected)}</p>
            ) : null}
            <div style={{ marginTop: 12 }}>
              <StatusBadge status={selected.paymentStatus || selected.status} />
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}

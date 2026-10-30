import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Download, MoreVertical } from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { formatDisplayDate } from "../../utils/dateUtils";
import {
  deductionLines,
  earningsLines,
  extractPayslips,
  formatMoney,
  paymentDate,
  payslipDepartment,
  payslipEmployeeCode,
  payslipEmployeeName,
  payslipJobTitle,
  payslipStatus,
  periodLabel,
} from "../../utils/payrollUtils";

function slipId(row) {
  return row?._id || row?.id || "";
}

export default function HrPayslipDetailPage() {
  const { payslipId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();

  const seeded = location.state?.payslip || null;
  const seededCycleId = location.state?.cycleId || "";

  const [payslip, setPayslip] = useState(seeded);
  const [loading, setLoading] = useState(!seeded);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      let found = null;

      if (seededCycleId) {
        const detail = await api.get(`/payroll/cycles/${seededCycleId}`);
        found = extractPayslips(detail.data).find((row) => String(slipId(row)) === String(payslipId));
      }

      if (!found) {
        const res = await api.get("/payroll/cycles");
        const cycles = Array.isArray(res.data?.cycles) ? res.data.cycles : [];
        for (const cycle of cycles) {
          const detail = await api.get(`/payroll/cycles/${cycle._id}`);
          found = extractPayslips(detail.data).find((row) => String(slipId(row)) === String(payslipId));
          if (found) break;
        }
      }

      if (!found) {
        setPayslip(null);
        setError("Payslip not found in available payroll cycles.");
      } else {
        setPayslip(found);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not load payslip details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (seeded && String(slipId(seeded)) === String(payslipId)) {
      setPayslip(seeded);
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payslipId]);

  const earnings = useMemo(() => earningsLines(payslip), [payslip]);
  const deductions = useMemo(() => deductionLines(payslip), [payslip]);
  const symbol = payslip?.currencySymbol || "₹";
  const paidOn = paymentDate(payslip);
  const canDownload =
    Boolean(slipId(payslip)) && String(payslip?.status || "").toUpperCase() !== "DRAFT";

  const download = async () => {
    const id = slipId(payslip);
    if (!id || !canDownload) {
      setError("This payslip cannot be downloaded until payroll is finalized.");
      return;
    }
    try {
      setDownloading(true);
      setError("");
      let response;
      try {
        response = await api.get(`/payroll/employee/payslips/${id}/download`, { responseType: "blob" });
      } catch {
        response = await api.get(`/payroll/payslips/${id}/download`, { responseType: "blob" });
      }
      const contentType = String(response.headers?.["content-type"] || response.data?.type || "");
      if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
        throw new Error("Payslip PDF was not returned.");
      }
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      const code = (payslipEmployeeCode(payslip) || "EMP").replace(/[^a-zA-Z0-9_-]/g, "");
      link.download =
        payslip.payslipNumber ||
        `Payslip_${code}_${payslip.periodYear}_${String(payslip.periodMonth).padStart(2, "0")}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast.push("Payslip PDF downloaded.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not download this payslip.");
    } finally {
      setDownloading(false);
    }
  };

  const openPreview = async () => {
    const id = slipId(payslip);
    if (!id || !canDownload) {
      setError("Preview is available after payroll is finalized.");
      return;
    }
    try {
      setDownloading(true);
      setError("");
      let response;
      try {
        response = await api.get(`/payroll/employee/payslips/${id}/download`, { responseType: "blob" });
      } catch {
        response = await api.get(`/payroll/payslips/${id}/download`, { responseType: "blob" });
      }
      const url = URL.createObjectURL(response.data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not open payslip preview.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="st-pay-detail">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Payslip Details</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  if (!payslip) {
    return (
      <div className="st-pay-detail">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Payslip Details</h1>
        </header>
        {error ? <ErrorState message={error} onRetry={load} /> : <EmptyState message="Payslip not found." />}
      </div>
    );
  }

  const name = payslipEmployeeName(payslip);
  const code = payslipEmployeeCode(payslip);
  const job = payslipJobTitle(payslip);
  const dept = payslipDepartment(payslip);
  const snap = payslip.employeeSnapshot || {};

  return (
    <div className="st-pay-detail">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Payslip Details</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="st-pay-summary card">
        <div className="st-pay-summary-top">
          <div>
            <span className="st-pay-kicker">Pay period</span>
            <strong>{periodLabel(payslip.periodMonth, payslip.periodYear)}</strong>
          </div>
          <StatusBadge status={payslipStatus(payslip)} />
        </div>
        <div className="st-pay-emp">
          <span className="st-pay-avatar">{initialsFrom(name)}</span>
          <div>
            <h2>{name}</h2>
            <p>
              {[code, job].filter(Boolean).join(" · ") || "Employee"}
            </p>
            {dept ? <em>{dept}</em> : null}
          </div>
        </div>
        {paidOn || payslip.payslipNumber ? (
          <div className="st-pay-meta-row">
            {paidOn ? (
              <span>
                Payment date <strong>{formatDisplayDate(paidOn)}</strong>
              </span>
            ) : null}
            {payslip.payslipNumber ? (
              <span>
                Ref <strong>{payslip.payslipNumber}</strong>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="st-pay-breakdown card">
        <div className="st-pay-gross">
          <div>
            <span className="st-pay-kicker">Gross earnings</span>
            <em>Total earnings component</em>
          </div>
          <strong>{formatMoney(payslip.grossEarnings, symbol)}</strong>
        </div>

        <h3>Earnings</h3>
        {earnings.length === 0 ? (
          <div className="st-pay-line">
            <span>Gross base salary</span>
            <strong>{formatMoney(payslip.grossEarnings, symbol)}</strong>
          </div>
        ) : (
          earnings.map((line, index) => (
            <div key={`${line.code || line.name}-${index}`} className="st-pay-line">
              <span>{line.name}</span>
              <strong>{formatMoney(line.amount, symbol)}</strong>
            </div>
          ))
        )}

        <h3>Deductions</h3>
        {deductions.length === 0 ? (
          <p className="caption">No statutory deductions recorded on this payslip.</p>
        ) : (
          deductions.map((line, index) => (
            <div key={`${line.code || line.name}-${index}`} className="st-pay-line is-deduct">
              <span>{line.name}</span>
              <strong>-{formatMoney(line.amount, symbol)}</strong>
            </div>
          ))
        )}

        <div className="st-pay-net">
          <div>
            <span>Net disbursed pay</span>
            {snap.bankName || snap.bankAccountNumber ? (
              <em>
                {[snap.bankName, snap.bankAccountNumber ? `•••• ${String(snap.bankAccountNumber).slice(-4)}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
            ) : (
              <em>Take-home for this period</em>
            )}
          </div>
          <strong>{formatMoney(payslip.netPayable ?? payslip.netPay, symbol)}</strong>
        </div>

        <div className="st-pay-totals">
          <div>
            <span>Gross</span>
            <strong>{formatMoney(payslip.grossEarnings, symbol)}</strong>
          </div>
          <div>
            <span>Deductions</span>
            <strong className="is-deduct">-{formatMoney(payslip.totalDeductions, symbol)}</strong>
          </div>
          <div>
            <span>Net</span>
            <strong>{formatMoney(payslip.netPayable ?? payslip.netPay, symbol)}</strong>
          </div>
        </div>
      </section>

      {(snap.panNumber || snap.bankIfsc) && (
        <section className="st-pay-verify card">
          <div className="st-pay-verify-head">
            <span>Payroll verification</span>
          </div>
          <div className="st-pay-verify-grid">
            {snap.panNumber ? (
              <div>
                <span>PAN</span>
                <strong>{snap.panNumber}</strong>
              </div>
            ) : null}
            {snap.bankIfsc ? (
              <div>
                <span>IFSC</span>
                <strong>{snap.bankIfsc}</strong>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <div className="st-pay-cta">
        <button
          type="button"
          className="btn-primary btn-block"
          disabled={downloading || !canDownload}
          onClick={download}
        >
          <Download size={18} strokeWidth={1.85} aria-hidden="true" />
          {downloading ? "Preparing PDF..." : "Download Payslip (PDF)"}
        </button>
        <button
          type="button"
          className="btn-secondary btn-block"
          disabled={downloading || !canDownload}
          onClick={openPreview}
        >
          Preview PDF
        </button>
        {!canDownload ? (
          <p className="caption">Draft payslips cannot be downloaded until the cycle is finalized.</p>
        ) : null}
        <p className="caption">Email delivery is not available from the current payroll API.</p>
      </div>
    </div>
  );
}

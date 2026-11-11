import { useEffect, useState, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import AppModal from "../components/AppModal";
import SoftRefresh from "../components/SoftRefresh";
import {
  IconClose,
  IconClock,
  IconCheck,
  IconAlertCircle,
  IconDownload,
  IconFileText,
} from "../components/EmployeeIcon";
import api from "../services/api";
import { usePayslipsQuery, useSettlementQuery } from "../hooks/useEmployeeQueries";
import Pagination from "../components/Pagination";
import ModuleToolbar from "../components/ModuleToolbar";
import "./EmployeePayslips.css";

export default function EmployeePayslips() {
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const payslipsQuery = usePayslipsQuery();
  const settlementQuery = useSettlementQuery();
  const payslips = payslipsQuery.data || [];
  const mySettlement = settlementQuery.data ?? null;
  const loading = payslipsQuery.isLoading && !payslipsQuery.data;
  const error =
    payslipsQuery.error?.response?.data?.message ||
    (payslipsQuery.error && !payslipsQuery.data ? "Failed to load payslips." : "");

  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [selectedYear, setSelectedYear] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettlementModal, setShowSettlementModal] = useState(false);

  const handleDownloadPayslip = async (payslipId, meta = null) => {
    try {
      setDownloadingId(payslipId);
      setActionError("");
      setActionSuccess("");

      let response;
      try {
        response = await api.get(`/payroll/employee/payslips/${payslipId}/download`, {
          params: { format: "pdf" },
          responseType: "blob",
        });
      } catch (primaryErr) {
        const status = primaryErr?.response?.status;
        if (status === 401 || status === 403) throw primaryErr;
        response = await api.get(`/employees/me/payslips/${payslipId}/download`, {
          params: { format: "pdf" },
          responseType: "blob",
        });
      }

      const contentType = response.headers["content-type"] || "application/pdf";
      if (contentType.includes("application/json")) {
        const text = await response.data.text();
        let message = "Unable to download payslip.";
        try {
          message = JSON.parse(text)?.message || message;
        } catch {
          /* keep default */
        }
        throw new Error(message);
      }

      const isPdf = contentType.includes("application/pdf") || response.data?.type?.includes("pdf");
      const ext = isPdf ? "pdf" : "txt";
      const periodLabel = meta
        ? `${meta.month || ""}_${meta.year || ""}`.replace(/^_|_$/g, "")
        : String(payslipId);
      const blob = new Blob([response.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payslip_${periodLabel || payslipId}.${ext}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setActionSuccess("Payslip PDF downloaded successfully.");
    } catch (err) {
      const msg =
        err.message ||
        err.response?.data?.message ||
        "Unable to download payslip. Please try again later.";
      setActionError(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePrintPayslip = () => {
    window.print();
  };

  const totalNetPaidYTD = useMemo(
    () => payslips.reduce((sum, p) => sum + (p.netPay || 0), 0),
    [payslips]
  );
  const latestPayslip = payslips[0];

  const availableYears = useMemo(
    () => Array.from(new Set(payslips.map((p) => String(p.year)))).sort((a, b) => b - a),
    [payslips]
  );

  const filteredPayslips = useMemo(() => {
    return payslips.filter((p) => {
      if (selectedYear !== "ALL" && String(p.year) !== selectedYear) return false;
      if (statusFilter === "PAID" && p.paymentStatus !== "PAID" && p.status !== "PAID") return false;
      if (statusFilter === "UNPAID" && (p.paymentStatus === "PAID" || p.status === "PAID")) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesMonth = (p.month || "").toLowerCase().includes(q);
        const matchesYear = String(p.year || "").includes(q);
        const matchesNum = (p.payslipNumber || "").toLowerCase().includes(q);
        if (!matchesMonth && !matchesYear && !matchesNum) return false;
      }
      return true;
    });
  }, [payslips, selectedYear, statusFilter, searchQuery]);

  const [payslipPage, setPayslipPage] = useState(1);
  const [payslipPageSize, setPayslipPageSize] = useState(10);

  useEffect(() => {
    setPayslipPage(1);
  }, [selectedYear, statusFilter, searchQuery]);

  const totalPayslipsCount = filteredPayslips.length;
  const totalPayslipPages = Math.ceil((totalPayslipsCount || 1) / payslipPageSize);
  const paginatedPayslips = useMemo(() => {
    const start = (payslipPage - 1) * payslipPageSize;
    return filteredPayslips.slice(start, start + payslipPageSize);
  }, [filteredPayslips, payslipPage, payslipPageSize]);

  const closePayslipModal = () => setSelectedPayslip(null);

  return (
    <div className="container-wide employee-payslips-container">
      <AppHeader title="Payslips">
        <SoftRefresh
          active={
            (payslipsQuery.isFetching && !!payslipsQuery.data) ||
            (settlementQuery.isFetching && settlementQuery.data !== undefined)
          }
        />
      </AppHeader>

      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconCheck size={16} />
            <span>{actionSuccess}</span>
          </div>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <IconAlertCircle size={16} />
            <span>{actionError}</span>
          </div>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {loading && (
        <div className="page-loading">
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p style={{ margin: 0 }}>Loading payslips…</p>
        </div>
      )}

      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center", marginBottom: 20 }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => payslipsQuery.refetch()}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="ep-metrics-strip" aria-label="Payslip summary">
            <span>
              Latest Net Pay: <strong>₹{(latestPayslip?.netPay || 0).toLocaleString("en-IN")}</strong>
            </span>
            <span className="ep-metrics-dot">•</span>
            <span>
              Period: <strong>{latestPayslip ? `${latestPayslip.month} ${latestPayslip.year}` : "—"}</strong>
            </span>
            <span className="ep-metrics-dot">•</span>
            <span>
              YTD Received: <strong>₹{totalNetPaidYTD.toLocaleString("en-IN")}</strong>
            </span>
            <span className="ep-metrics-dot">•</span>
            <span>
              Statements: <strong>{payslips.length}</strong>
            </span>
          </div>

          {mySettlement && (
            <div className="ep-settlement-banner">
              <div>
                <div className="ep-settlement-title">Full & Final Settlement Statement Available</div>
                <div className="ep-settlement-sub">
                  Your final separation statement has been prepared. Net Settlement Amount:{" "}
                  <strong>₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}</strong>
                </div>
              </div>
              <button type="button" className="btn-primary" onClick={() => setShowSettlementModal(true)}>
                View Settlement Details
              </button>
            </div>
          )}

          <ModuleToolbar
            searchValue={searchQuery}
            onSearchChange={(e) => setSearchQuery(e.target.value)}
            searchPlaceholder="Search by month or payslip #..."
            searchAriaLabel="Search payslips"
            filterCount={(statusFilter !== "ALL" ? 1 : 0) + (selectedYear !== "ALL" ? 1 : 0)}
            onFiltersClear={() => {
              setStatusFilter("ALL");
              setSelectedYear("ALL");
            }}
            filters={
              <>
                <label className="module-toolbar-filter-field">
                  Status
                  <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="ALL">All</option>
                    <option value="PAID">Paid</option>
                    <option value="UNPAID">Pending</option>
                  </select>
                </label>
                {availableYears.length > 0 && (
                  <label className="module-toolbar-filter-field">
                    Year
                    <select
                      className="filter-select"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                    >
                      <option value="ALL">All Years</option>
                      {availableYears.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            }
          />

          <div className="ep-list-panel">
            <div className="ep-list-header">
              <h3 className="ep-list-title">Salary History</h3>
              <span className="ep-list-count">{filteredPayslips.length} Statements</span>
            </div>

            {filteredPayslips.length === 0 ? (
              <div className="ep-empty">
                <IconFileText size={32} />
                <div>No statements found</div>
              </div>
            ) : (
              <>
                <div className="ep-table-wrap">
                  <table className="ep-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Gross</th>
                        <th>Deductions</th>
                        <th>Net Pay</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPayslips.map((ps) => {
                        const isPaid = ps.paymentStatus === "PAID" || ps.status === "PAID";
                        return (
                          <tr key={ps.id}>
                            <td>
                              <div className="ep-card-period">
                                {ps.month} {ps.year}
                              </div>
                              <div className="ep-card-ref">{ps.payslipNumber || ps.period || "—"}</div>
                            </td>
                            <td>₹{Number(ps.grossSalary || 0).toLocaleString("en-IN")}</td>
                            <td className="ep-deduct-cell">
                              -₹{Number(ps.deductions || 0).toLocaleString("en-IN")}
                            </td>
                            <td className="ep-net-cell">₹{Number(ps.netPay || 0).toLocaleString("en-IN")}</td>
                            <td>
                              <span className={`ep-status-pill ${isPaid ? "is-paid" : "is-open"}`}>
                                {isPaid ? <IconCheck size={11} /> : <IconClock size={11} />}
                                {isPaid ? "PAID" : "FINALIZED"}
                              </span>
                              {ps.disbursedDate ? (
                                <div className="ep-card-ref" style={{ marginTop: 4 }}>
                                  {isPaid ? `Paid: ${ps.disbursedDate}` : `Finalized: ${ps.disbursedDate}`}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <div className="ep-row-actions">
                                <button
                                  type="button"
                                  className="btn-sm btn-secondary"
                                  onClick={() => setSelectedPayslip(ps)}
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="btn-sm btn-primary"
                                  onClick={() => handleDownloadPayslip(ps.id, ps)}
                                  disabled={downloadingId === ps.id}
                                >
                                  <IconDownload size={13} />
                                  {downloadingId === ps.id ? "…" : "PDF"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPayslipsCount > 0 && (
                  <Pagination
                    currentPage={payslipPage}
                    totalPages={totalPayslipPages}
                    totalItems={totalPayslipsCount}
                    pageSize={payslipPageSize}
                    pageSizeOptions={[10, 20, 50]}
                    onPageChange={(p) => setPayslipPage(p)}
                    onPageSizeChange={(s) => {
                      setPayslipPageSize(s);
                      setPayslipPage(1);
                    }}
                    itemLabel="statements"
                  />
                )}
              </>
            )}
          </div>
        </>
      )}

      <AppModal
        open={Boolean(selectedPayslip)}
        onClose={closePayslipModal}
        size="lg"
        className="ep-payslip-modal"
        title={
          selectedPayslip
            ? `Payslip — ${selectedPayslip.month} ${selectedPayslip.year}`
            : "Payslip"
        }
        subtitle={
          selectedPayslip
            ? `Ref: ${selectedPayslip.payslipNumber || "—"} · Period: ${selectedPayslip.period || "—"}`
            : undefined
        }
        footer={
          selectedPayslip ? (
            <>
              <button type="button" className="btn-secondary" onClick={closePayslipModal}>
                Close
              </button>
              <button type="button" className="btn-secondary" onClick={handlePrintPayslip}>
                Print preview
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleDownloadPayslip(selectedPayslip.id, selectedPayslip)}
                disabled={downloadingId === selectedPayslip.id}
              >
                <IconDownload size={14} />
                {downloadingId === selectedPayslip.id ? "Downloading…" : "Download PDF"}
              </button>
            </>
          ) : null
        }
      >
        {selectedPayslip ? (
          <div className="ep-modal-body" id="ep-payslip-print-root">
            <section className="ep-modal-section">
              <h4 className="ep-modal-section-title">Employee & period</h4>
              <dl className="ep-meta-grid">
                <div>
                  <dt>Employee</dt>
                  <dd>
                    {selectedPayslip.employeeSnapshot?.name ||
                      selectedPayslip.employeeName ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>Employee ID</dt>
                  <dd>
                    {selectedPayslip.employeeSnapshot?.employeeCode ||
                      selectedPayslip.employeeId ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>
                    {selectedPayslip.employeeSnapshot?.department ||
                      selectedPayslip.department ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>Designation</dt>
                  <dd>
                    {selectedPayslip.employeeSnapshot?.designation ||
                      selectedPayslip.designation ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>Salary period</dt>
                  <dd>
                    {selectedPayslip.month} {selectedPayslip.year}
                  </dd>
                </div>
                <div>
                  <dt>Payslip #</dt>
                  <dd>{selectedPayslip.payslipNumber || "—"}</dd>
                </div>
              </dl>
            </section>

            {selectedPayslip.daysBreakdown && (
              <div className="ep-attendance-bar">
                <div className="ep-att-item">
                  <span className="ep-att-label">Working Days</span>
                  <span className="ep-att-val">{selectedPayslip.daysBreakdown.workingDays ?? "—"}</span>
                </div>
                <div className="ep-att-item">
                  <span className="ep-att-label">Present</span>
                  <span className="ep-att-val green">
                    {selectedPayslip.daysBreakdown.presentDays ?? "—"}
                  </span>
                </div>
                <div className="ep-att-item">
                  <span className="ep-att-label">Paid Leave</span>
                  <span className="ep-att-val" style={{ color: "#2563eb" }}>
                    {selectedPayslip.daysBreakdown.paidLeaveDays ?? 0}
                  </span>
                </div>
                <div className="ep-att-item">
                  <span className="ep-att-label">Loss of Pay</span>
                  <span className="ep-att-val red">
                    {selectedPayslip.daysBreakdown.lossOfPayDays ?? 0}
                  </span>
                </div>
                <div className="ep-att-item">
                  <span className="ep-att-label">Payable Days</span>
                  <span className="ep-att-val" style={{ fontWeight: 800 }}>
                    {selectedPayslip.daysBreakdown.payableDays ?? "—"}
                  </span>
                </div>
              </div>
            )}

            <div className="ep-breakdown-grid">
              <div className="ep-section-box">
                <div className="ep-section-title earnings">Earnings & Allowances</div>
                {!selectedPayslip.earnings || selectedPayslip.earnings.length === 0 ? (
                  <div className="ep-line-item">
                    <span className="ep-line-name">Gross Base Salary</span>
                    <span className="ep-line-amount">
                      ₹{Number(selectedPayslip.grossSalary || 0).toLocaleString("en-IN")}
                    </span>
                  </div>
                ) : (
                  selectedPayslip.earnings.map((e, idx) => (
                    <div key={idx} className="ep-line-item">
                      <span className="ep-line-name">{e.name}</span>
                      <span className="ep-line-amount">
                        ₹{Number(e.amount || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))
                )}
                <div className="ep-section-total">
                  <span>Total Gross Earnings</span>
                  <span style={{ color: "var(--g-800)" }}>
                    ₹{Number(selectedPayslip.grossSalary || 0).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              <div className="ep-section-box">
                <div className="ep-section-title deductions">Deductions</div>
                {!selectedPayslip.employeeDeductions ||
                selectedPayslip.employeeDeductions.length === 0 ? (
                  <div className="ep-empty-inline">No statutory deductions recorded</div>
                ) : (
                  selectedPayslip.employeeDeductions.map((d, idx) => (
                    <div key={idx} className="ep-line-item">
                      <span className="ep-line-name">{d.name}</span>
                      <span className="ep-line-amount deduct">
                        -₹{Number(d.amount || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))
                )}
                <div className="ep-section-total">
                  <span>Total Deductions</span>
                  <span style={{ color: "#b91c1c" }}>
                    -₹{Number(selectedPayslip.deductions || 0).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>

            {selectedPayslip.employerContributions?.length > 0 && (
              <section className="ep-modal-section">
                <h4 className="ep-modal-section-title">Employer contributions</h4>
                {selectedPayslip.employerContributions.map((item, idx) => (
                  <div key={idx} className="ep-line-item">
                    <span className="ep-line-name">{item.name}</span>
                    <span className="ep-line-amount">
                      ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </section>
            )}

            <div className="ep-hero-netpay">
              <div>
                <div className="ep-hero-netpay-label">Net Take-Home Salary</div>
                <div className="ep-hero-netpay-amount">
                  ₹{Number(selectedPayslip.netPay || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div className="ep-hero-netpay-badge">
                {selectedPayslip.paymentStatus === "PAID" ? (
                  <IconCheck size={14} />
                ) : (
                  <IconClock size={14} />
                )}
                <span>
                  {selectedPayslip.paymentStatus === "PAID"
                    ? "Disbursed via Bank"
                    : "Finalized Snapshot"}
                </span>
              </div>
            </div>

            <div className="ep-banking-footer">
              <div>
                <strong>Account:</strong>{" "}
                {selectedPayslip.employeeSnapshot?.bankDetails?.accountNumber
                  ? `•••• ${selectedPayslip.employeeSnapshot.bankDetails.accountNumber.slice(-4)} (${
                      selectedPayslip.employeeSnapshot.bankDetails.bankName || "Salary A/C"
                    })`
                  : "Bank Direct Deposit on file"}
              </div>
              {selectedPayslip.payments?.[0] ? (
                <div>
                  <strong>Payment:</strong>{" "}
                  {selectedPayslip.payments[0].paymentDate
                    ? new Date(selectedPayslip.payments[0].paymentDate).toLocaleDateString()
                    : "—"}
                  {selectedPayslip.payments[0].paymentMethod
                    ? ` · ${selectedPayslip.payments[0].paymentMethod}`
                    : ""}
                  {selectedPayslip.payments[0].referenceNumber
                    ? ` · Ref ${selectedPayslip.payments[0].referenceNumber}`
                    : ""}
                </div>
              ) : (
                <div>
                  <strong>Statement Status:</strong> Verified & Frozen Snapshot
                </div>
              )}
            </div>
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(showSettlementModal && mySettlement)}
        onClose={() => setShowSettlementModal(false)}
        size="md"
        title="Full & Final Settlement Summary"
        subtitle={
          mySettlement
            ? `Exit Reference: ${mySettlement.settlementNumber || mySettlement._id}`
            : undefined
        }
        footer={
          <button type="button" className="btn-secondary" onClick={() => setShowSettlementModal(false)}>
            Close
          </button>
        }
      >
        {mySettlement ? (
          <div className="ep-settlement-grid">
            <div>
              <span className="ep-att-label">Gross Earnings</span>
              <div className="ep-settlement-value green">
                ₹{(mySettlement.totalEarnings || 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div>
              <span className="ep-att-label">Total Deductions</span>
              <div className="ep-settlement-value red">
                -₹{(mySettlement.totalDeductions || 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div>
              <span className="ep-att-label">Net Settlement Pay</span>
              <div className="ep-settlement-value strong">
                ₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}
              </div>
            </div>
            <div>
              <span className="ep-att-label">Status</span>
              <div className="ep-settlement-status">{mySettlement.status}</div>
            </div>
          </div>
        ) : null}
      </AppModal>
    </div>
  );
}

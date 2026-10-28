import { useEffect, useState, useMemo } from "react";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconClock,
  IconCheck,
  IconAlertCircle,
  IconDownload,
  IconFileText,
  IconSearch,
} from "../components/Icons";
import api from "../services/api";
import Pagination from "../components/Pagination";
import "./EmployeePayslips.css";

export default function EmployeePayslips() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const [payslips, setPayslips] = useState([]);
  const [selectedPayslipId, setSelectedPayslipId] = useState(null);
  const [selectedYear, setSelectedYear] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [mySettlement, setMySettlement] = useState(null);
  const [showSettlementModal, setShowSettlementModal] = useState(false);

  const fetchPayslips = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");

      const [payrollRes, settlementRes] = await Promise.allSettled([
        api.get("/payroll/employee/payslips"),
        api.get("/settlements/my-settlement"),
      ]);

      let items = [];

      // Primary source: Dedicated finalized payslips collection
      if (payrollRes.status === "fulfilled" && payrollRes.value.data?.payslips) {
        items = payrollRes.value.data.payslips.map((p) => {
          const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          const mName = monthNames[p.periodMonth - 1] || `Month ${p.periodMonth}`;
          const startDateStr = p.periodStartDate ? new Date(p.periodStartDate).toLocaleDateString("en-IN") : "";
          const endDateStr = p.periodEndDate ? new Date(p.periodEndDate).toLocaleDateString("en-IN") : "";

          return {
            id: p._id?.toString() || p.id,
            payslipNumber: p.payslipNumber || `PS-${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
            month: mName,
            year: p.periodYear,
            periodMonth: p.periodMonth,
            period: startDateStr && endDateStr ? `${startDateStr} – ${endDateStr}` : `${mName} ${p.periodYear}`,
            grossSalary: p.grossEarnings || 0,
            deductions: p.totalDeductions || 0,
            netPay: p.netPayable || 0,
            status: p.paymentStatus === "PAID" ? "PAID" : p.status || "FINALIZED",
            paymentStatus: p.paymentStatus || "UNPAID",
            disbursedDate: p.payments?.[0]?.paymentDate
              ? new Date(p.payments[0].paymentDate).toLocaleDateString("en-IN")
              : p.finalizedAt
              ? new Date(p.finalizedAt).toLocaleDateString("en-IN")
              : null,
            isPersisted: true,
            isFinalizedPayroll: true,
            daysBreakdown: p.daysBreakdown,
            earnings: p.earnings || [],
            employeeDeductions: p.employeeDeductions || [],
            employerContributions: p.employerContributions || [],
            payments: p.payments || [],
            employeeSnapshot: p.employeeSnapshot,
          };
        });
      }

      // Fallback: Dashboard payslips (for preview/legacy)
      if (items.length === 0) {
        try {
          const dashboardRes = await api.get("/employees/me/dashboard");
          if (dashboardRes.data?.payslips) {
            const rawDashboardPayslips = dashboardRes.data.payslips;
            items = rawDashboardPayslips.map((ps) => ({
              ...ps,
              periodMonth: typeof ps.month === "string" ? getMonthNumber(ps.month) : ps.periodMonth || 1,
              isPersisted: ps.isPersisted !== false,
              isFinalizedPayroll: ps.isPersisted === true,
            }));
          }
        } catch {
          // ignore fallback error
        }
      }

      setPayslips(items);
      if (items.length > 0 && !selectedPayslipId) {
        setSelectedPayslipId(items[0].id);
      }

      if (settlementRes.status === "fulfilled" && settlementRes.value.data?.settlement) {
        setMySettlement(settlementRes.value.data.settlement);
      } else {
        setMySettlement(null);
      }
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.message || "Failed to load payslips.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  function getMonthNumber(name) {
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december"
    ];
    const idx = months.indexOf(String(name).toLowerCase().trim());
    return idx >= 0 ? idx + 1 : 1;
  }

  useEffect(() => {
    fetchPayslips();
  }, []);

  const handleDownloadPayslip = async (payslipId) => {
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
      } catch (err) {
        // Fallback to legacy endpoint if payroll endpoint 404s
        response = await api.get(`/employees/me/payslips/${payslipId}/download`, {
          params: { format: "pdf" },
          responseType: "blob",
        });
      }

      const contentType = response.headers["content-type"] || "application/pdf";
      const isPdf = contentType.includes("application/pdf") || response.data?.type?.includes("pdf");
      const ext = isPdf ? "pdf" : "txt";
      const blob = new Blob([response.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payslip_${payslipId}.${ext}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setActionSuccess("Payslip downloaded successfully.");
    } catch (err) {
      const msg = err.response?.data?.message || "Unable to download payslip. Please try again later.";
      setActionError(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  // Metrics calculation
  const totalNetPaidYTD = useMemo(
    () => payslips.reduce((sum, p) => sum + (p.netPay || 0), 0),
    [payslips]
  );
  const latestPayslip = payslips[0];

  // Unique years for filter
  const availableYears = useMemo(
    () => Array.from(new Set(payslips.map((p) => String(p.year)))).sort((a, b) => b - a),
    [payslips]
  );

  // Filtered payslips
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
  const [payslipPageSize, setPayslipPageSize] = useState(6);

  useEffect(() => {
    setPayslipPage(1);
  }, [selectedYear, statusFilter, searchQuery]);

  const totalPayslipsCount = filteredPayslips.length;
  const totalPayslipPages = Math.ceil((totalPayslipsCount || 1) / payslipPageSize);
  const paginatedPayslips = useMemo(() => {
    const start = (payslipPage - 1) * payslipPageSize;
    return filteredPayslips.slice(start, start + payslipPageSize);
  }, [filteredPayslips, payslipPage, payslipPageSize]);

  // Active selected payslip (defaults to first available in filtered list)
  const activePayslip = useMemo(() => {
    if (!filteredPayslips || filteredPayslips.length === 0) return null;
    const found = filteredPayslips.find((p) => p.id === selectedPayslipId);
    return found || filteredPayslips[0];
  }, [filteredPayslips, selectedPayslipId]);

  return (
    <div className="container-wide employee-payslips-container">
      <AppHeader title="Payslips" />

      {/* Alerts */}
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

      {/* Loading */}
      {loading && (
        <div className="page-loading">
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p style={{ margin: 0 }}>Loading payslips…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center", marginBottom: 20 }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => fetchPayslips()}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Compact Inline Payslip Metrics Strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              background: "var(--card, #ffffff)",
              border: "1px solid var(--hair, #e6ede8)",
              borderRadius: 8,
              padding: "8px 16px",
              marginBottom: 14,
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>
              Latest Net Pay: <strong style={{ color: "var(--g-800, #155a37)" }}>₹{(latestPayslip?.netPay || 0).toLocaleString("en-IN")}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              Period: <strong style={{ color: "var(--ink)" }}>{latestPayslip ? `${latestPayslip.month} ${latestPayslip.year}` : "—"}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              YTD Received: <strong style={{ color: "var(--g-800, #155a37)" }}>₹{totalNetPaidYTD.toLocaleString("en-IN")}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              Statements: <strong style={{ color: "var(--ink)" }}>{payslips.length}</strong>
            </span>
          </div>

          {/* Full & Final Settlement Alert Banner if eligible */}
          {mySettlement && (
            <div
              style={{
                background: "var(--g-100, #e3f2e9)",
                border: "1px solid rgba(29, 115, 71, 0.3)",
                borderRadius: 12,
                padding: "16px 20px",
                marginBottom: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--g-950)" }}>
                  Full & Final Settlement Statement Available
                </div>
                <div style={{ fontSize: 13, color: "var(--g-800)", marginTop: 2 }}>
                  Your final separation statement has been prepared. Net Settlement Amount:{" "}
                  <strong>₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowSettlementModal(true)}
                style={{ fontSize: 12.5, padding: "7px 14px" }}
              >
                View Settlement Details
              </button>
            </div>
          )}

          {/* Filter Toolbar */}
          <div className="ep-toolbar">
            <div className="ep-toolbar-left">
              <div className="ep-filter-pill-group">
                <button
                  type="button"
                  className={`ep-filter-pill ${statusFilter === "ALL" ? "active" : ""}`}
                  onClick={() => setStatusFilter("ALL")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`ep-filter-pill ${statusFilter === "PAID" ? "active" : ""}`}
                  onClick={() => setStatusFilter("PAID")}
                >
                  Paid
                </button>
                <button
                  type="button"
                  className={`ep-filter-pill ${statusFilter === "UNPAID" ? "active" : ""}`}
                  onClick={() => setStatusFilter("UNPAID")}
                >
                  Pending
                </button>
              </div>

              {availableYears.length > 0 && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="ep-select"
                  aria-label="Filter by Year"
                >
                  <option value="ALL">All Years</option>
                  {availableYears.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="search"
                placeholder="Search by month or payslip #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ep-search-input"
              />
            </div>
          </div>

          {/* Master-Detail Workspace Layout */}
          <div className="ep-workspace-grid">
            {/* Left Column: Monthly Payslip History List */}
            <div className="ep-list-panel">
              <div className="ep-list-header">
                <h3 className="ep-list-title">Salary History</h3>
                <span className="ep-list-count">{filteredPayslips.length} Statements</span>
              </div>

              {filteredPayslips.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  <IconFileText size={32} style={{ color: "#d4d4d8", margin: "0 auto 8px" }} />
                  <div>No statements found</div>
                </div>
              ) : (
                <>
                  {paginatedPayslips.map((ps) => {
                    const isSelected = activePayslip?.id === ps.id;
                    const isPaid = ps.paymentStatus === "PAID" || ps.status === "PAID";

                    return (
                      <div
                        key={ps.id}
                        className={`ep-card-item ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedPayslipId(ps.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedPayslipId(ps.id);
                        }}
                      >
                        <div className="ep-card-header">
                          <div>
                            <div className="ep-card-period">
                              {ps.month} {ps.year}
                            </div>
                            <div className="ep-card-ref">
                              {ps.payslipNumber}
                            </div>
                          </div>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "2px 8px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: isPaid ? "var(--g-100, #e3f2e9)" : "#eff6ff",
                              color: isPaid ? "var(--g-800, #155a37)" : "#1d4ed8",
                            }}
                          >
                            {isPaid ? <IconCheck size={11} /> : <IconClock size={11} />}
                            <span>{isPaid ? "PAID" : "FINALIZED"}</span>
                          </span>
                        </div>

                        <div className="ep-card-footer">
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            Net Disbursal
                          </span>
                          <div className="ep-card-amount">
                            ₹{Number(ps.netPay || 0).toLocaleString("en-IN")}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {totalPayslipsCount > 0 && (
                    <Pagination
                      currentPage={payslipPage}
                      totalPages={totalPayslipPages}
                      totalItems={totalPayslipsCount}
                      pageSize={payslipPageSize}
                      pageSizeOptions={[6, 12, 24]}
                      onPageChange={(p) => setPayslipPage(p)}
                      onPageSizeChange={(s) => {
                        setPayslipPageSize(s);
                        setPayslipPage(1);
                      }}
                      itemLabel="statements"
                      compact={true}
                    />
                  )}
                </>
              )}
            </div>

            {/* Right Column: Selected Payslip Deep-Dive */}
            <div className="ep-detail-panel">
              {activePayslip ? (
                <>
                  {/* Detail Header */}
                  <div className="ep-detail-header">
                    <div className="ep-detail-title-group">
                      <h2>
                        Payslip — {activePayslip.month} {activePayslip.year}
                      </h2>
                      <div className="ep-detail-meta">
                        <span><strong>Ref:</strong> {activePayslip.payslipNumber}</span>
                        <span>•</span>
                        <span><strong>Period:</strong> {activePayslip.period}</span>
                        {activePayslip.disbursedDate && (
                          <>
                            <span>•</span>
                            <span><strong>Date:</strong> {activePayslip.disbursedDate}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleDownloadPayslip(activePayslip.id)}
                        disabled={downloadingId === activePayslip.id}
                        style={{ fontSize: 12.5, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        <IconDownload size={14} />
                        <span>{downloadingId === activePayslip.id ? "Downloading..." : "Download PDF"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Attendance & Days Summary Bar */}
                  {activePayslip.daysBreakdown && (
                    <div className="ep-attendance-bar">
                      <div className="ep-att-item">
                        <span className="ep-att-label">Working Days</span>
                        <span className="ep-att-val">{activePayslip.daysBreakdown.workingDays ?? "—"}</span>
                      </div>
                      <div className="ep-att-item">
                        <span className="ep-att-label">Present</span>
                        <span className="ep-att-val green">{activePayslip.daysBreakdown.presentDays ?? "—"}</span>
                      </div>
                      <div className="ep-att-item">
                        <span className="ep-att-label">Paid Leave</span>
                        <span className="ep-att-val" style={{ color: "#2563eb" }}>{activePayslip.daysBreakdown.paidLeaveDays ?? 0}</span>
                      </div>
                      <div className="ep-att-item">
                        <span className="ep-att-label">Loss of Pay</span>
                        <span className="ep-att-val red">{activePayslip.daysBreakdown.lossOfPayDays ?? 0}</span>
                      </div>
                      <div className="ep-att-item">
                        <span className="ep-att-label">Payable Days</span>
                        <span className="ep-att-val" style={{ fontWeight: 800 }}>{activePayslip.daysBreakdown.payableDays ?? "—"}</span>
                      </div>
                    </div>
                  )}

                  {/* Itemized Financial Breakdown (2-Column) */}
                  <div className="ep-breakdown-grid">
                    {/* Left: Earnings */}
                    <div className="ep-section-box">
                      <div className="ep-section-title earnings">
                        Earnings & Allowances
                      </div>
                      {(!activePayslip.earnings || activePayslip.earnings.length === 0) ? (
                        <div className="ep-line-item">
                          <span className="ep-line-name">Gross Base Salary</span>
                          <span className="ep-line-amount">₹{Number(activePayslip.grossSalary || 0).toLocaleString("en-IN")}</span>
                        </div>
                      ) : (
                        activePayslip.earnings.map((e, idx) => (
                          <div key={idx} className="ep-line-item">
                            <span className="ep-line-name">{e.name}</span>
                            <span className="ep-line-amount">₹{Number(e.amount || 0).toLocaleString("en-IN")}</span>
                          </div>
                        ))
                      )}
                      <div className="ep-section-total">
                        <span>Total Gross Earnings</span>
                        <span style={{ color: "var(--g-800)" }}>₹{Number(activePayslip.grossSalary || 0).toLocaleString("en-IN")}</span>
                      </div>
                    </div>

                    {/* Right: Deductions */}
                    <div className="ep-section-box">
                      <div className="ep-section-title deductions">
                        Statutory & Voluntary Deductions
                      </div>
                      {(!activePayslip.employeeDeductions || activePayslip.employeeDeductions.length === 0) ? (
                        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "8px 0", fontStyle: "italic" }}>
                          No statutory deductions recorded
                        </div>
                      ) : (
                        activePayslip.employeeDeductions.map((d, idx) => (
                          <div key={idx} className="ep-line-item">
                            <span className="ep-line-name">{d.name}</span>
                            <span className="ep-line-amount deduct">-₹{Number(d.amount || 0).toLocaleString("en-IN")}</span>
                          </div>
                        ))
                      )}
                      <div className="ep-section-total">
                        <span>Total Deductions</span>
                        <span style={{ color: "#b91c1c" }}>-₹{Number(activePayslip.deductions || 0).toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Hero Net Take-Home Card */}
                  <div className="ep-hero-netpay">
                    <div>
                      <div className="ep-hero-netpay-label">Net Take-Home Salary</div>
                      <div className="ep-hero-netpay-amount">
                        ₹{Number(activePayslip.netPay || 0).toLocaleString("en-IN")}
                      </div>
                    </div>
                    <div className="ep-hero-netpay-badge">
                      {activePayslip.paymentStatus === "PAID" ? <IconCheck size={14} /> : <IconClock size={14} />}
                      <span>{activePayslip.paymentStatus === "PAID" ? "Disbursed via Bank" : "Finalized Snapshot"}</span>
                    </div>
                  </div>

                  {/* Banking & Disbursal Footprint */}
                  <div className="ep-banking-footer">
                    <div>
                      <strong>Account:</strong>{" "}
                      {activePayslip.employeeSnapshot?.bankDetails?.accountNumber
                        ? `•••• ${activePayslip.employeeSnapshot.bankDetails.accountNumber.slice(-4)} (${activePayslip.employeeSnapshot.bankDetails.bankName || "Salary A/C"})`
                        : "Bank Direct Deposit on file"}
                    </div>
                    {activePayslip.payments?.[0]?.referenceNumber ? (
                      <div>
                        <strong>Transaction Ref:</strong> {activePayslip.payments[0].referenceNumber}
                      </div>
                    ) : (
                      <div>
                        <strong>Statement Status:</strong> Verified & Frozen Snapshot
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
                  <IconFileText size={40} style={{ color: "#d4d4d8", margin: "0 auto 12px" }} />
                  <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>Select a salary statement</div>
                  <div>Choose a month from the left history to view detailed earnings and deductions.</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Full & Final Settlement Modal */}
      {showSettlementModal && mySettlement && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowSettlementModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 600,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
                  Full & Final Settlement Summary
                </h3>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  Exit Reference: {mySettlement.settlementNumber || mySettlement._id}
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowSettlementModal(false)}
                aria-label="Close"
              >
                <IconClose size={14} />
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 12,
                padding: "16px",
                background: "var(--panel, #f5f6f5)",
                borderRadius: 10,
                border: "1px solid var(--hair, #e3e7e4)",
                marginBottom: 18,
              }}
            >
              <div>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
                  Gross Earnings
                </span>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--g-800)", marginTop: 2 }}>
                  ₹{(mySettlement.totalEarnings || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
                  Total Deductions
                </span>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#b91c1c", marginTop: 2 }}>
                  -₹{(mySettlement.totalDeductions || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
                  Net Settlement Pay
                </span>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--g-950)", marginTop: 2 }}>
                  ₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
                  Status
                </span>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginTop: 4 }}>
                  {mySettlement.status}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSettlementModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

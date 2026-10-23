import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconClock,
  IconCheck,
  IconAlertCircle,
  IconInfo,
  IconDownload,
  IconFileText,
} from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";

export default function EmployeePayslips() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const [payslips, setPayslips] = useState([]);
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [selectedYear, setSelectedYear] = useState("ALL");
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
          const startDateStr = p.periodStartDate ? new Date(p.periodStartDate).toLocaleDateString() : "";
          const endDateStr = p.periodEndDate ? new Date(p.periodEndDate).toLocaleDateString() : "";

          return {
            id: p._id?.toString() || p.id,
            payslipNumber: p.payslipNumber || `PS-${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
            month: mName,
            year: p.periodYear,
            periodMonth: p.periodMonth,
            period: startDateStr && endDateStr ? `${startDateStr} to ${endDateStr}` : `${mName} ${p.periodYear}`,
            grossSalary: p.grossEarnings || 0,
            deductions: p.totalDeductions || 0,
            netPay: p.netPayable || 0,
            status: p.paymentStatus === "PAID" ? "PAID" : p.status || "FINALIZED",
            paymentStatus: p.paymentStatus || "UNPAID",
            disbursedDate: p.payments?.[0]?.paymentDate
              ? new Date(p.payments[0].paymentDate).toLocaleDateString()
              : p.finalizedAt
              ? new Date(p.finalizedAt).toLocaleDateString()
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

      // If no persisted payslips yet, inspect dashboard payslips (which may contain legacy fallback statements)
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
      setActionSuccess(`Payslip downloaded successfully.`);
    } catch (err) {
      const msg = err.response?.data?.message || "Unable to download payslip. Please try again later.";
      setActionError(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  // Metrics calculation
  const totalNetPaidYTD = payslips.reduce((sum, p) => sum + (p.netPay || 0), 0);
  const totalDeductionsYTD = payslips.reduce((sum, p) => sum + (p.deductions || 0), 0);
  const latestPayslip = payslips[0];

  // Unique years for filter
  const availableYears = Array.from(new Set(payslips.map((p) => String(p.year)))).sort((a, b) => b - a);

  const filteredPayslips = selectedYear === "ALL"
    ? payslips
    : payslips.filter((p) => String(p.year) === selectedYear);

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="Payslips" />

      {/* Alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "#71717a", fontSize: 15 }}>Loading salary statements...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => fetchPayslips()}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary Metric Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 12,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Latest Take-Home Pay
              </span>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#166534", marginTop: 8 }}>
                ₹{(latestPayslip?.netPay || 0).toLocaleString("en-IN")}
              </div>
              <span style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
                {latestPayslip ? `${latestPayslip.month} ${latestPayslip.year}` : "No statements yet"}
              </span>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 12,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Cumulative Net Received
              </span>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#1e40af", marginTop: 8 }}>
                ₹{totalNetPaidYTD.toLocaleString("en-IN")}
              </div>
              <span style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
                Across {payslips.length} monthly statement{payslips.length === 1 ? "" : "s"}
              </span>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 12,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Total Statutory Deductions
              </span>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#b91c1c", marginTop: 8 }}>
                -₹{totalDeductionsYTD.toLocaleString("en-IN")}
              </div>
              <span style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
                Provident Fund, PT & Income Tax
              </span>
            </div>

            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 12,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Finalized Records
              </span>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#09090b", marginTop: 8 }}>
                {payslips.filter((p) => p.isFinalizedPayroll).length}
              </div>
              <span style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>
                Immutable snapshots on file
              </span>
            </div>
          </div>

          {/* Full & Final Settlement Alert Banner if eligible */}
          {mySettlement && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 12,
                padding: "18px 22px",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#166534" }}>
                  Full & Final Settlement Statement Available
                </div>
                <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>
                  Your final separation statement has been prepared. Net Settlement Amount:{" "}
                  <strong>₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowSettlementModal(true)}
                style={{ fontSize: 13, padding: "8px 16px" }}
              >
                View Settlement Details
              </button>
            </div>
          )}

          {/* Payslips Table Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "22px 24px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            {/* Header & Filter Controls */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                  Monthly Salary Statements
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                  Historical snapshots frozen at finalization. Subsequent compensation revisions do not alter past statements.
                </p>
              </div>

              {availableYears.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label htmlFor="year-filter" style={{ fontSize: 13, fontWeight: 600, color: "#71717a" }}>
                    Year:
                  </label>
                  <select
                    id="year-filter"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #d4d4d8",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <option value="ALL">All Years</option>
                    {availableYears.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="table-wrapper-relative" style={{ overflowX: "auto" }}>
              {loading && payslips.length > 0 && <div className="table-progress-bar" />}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                    <th style={{ padding: "12px 14px" }}>Statement Period</th>
                    <th style={{ padding: "12px 14px" }}>Gross Earnings</th>
                    <th style={{ padding: "12px 14px" }}>Deductions</th>
                    <th style={{ padding: "12px 14px" }}>Net Take-Home</th>
                    <th style={{ padding: "12px 14px" }}>Status</th>
                    <th style={{ padding: "12px 14px" }}>Record Type</th>
                    <th style={{ padding: "12px 14px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody className={loading && payslips.length > 0 ? "table-refreshing-dim" : ""}>
                  {loading && payslips.length === 0 ? (
                    <TableSkeletonRows colCount={7} rowCount={4} />
                  ) : filteredPayslips.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", color: "#71717a", fontSize: 14 }}>
                        <IconFileText size={36} style={{ color: "#d4d4d8", marginBottom: 12, margin: "0 auto" }} />
                        <div style={{ fontWeight: 600, color: "#18181b", marginBottom: 6 }}>
                          No payslips found
                        </div>
                        Your official payslips will be available for review and download following HR payroll finalization.
                      </td>
                    </tr>
                  ) : filteredPayslips.map((ps) => {
                      const isPaid = ps.status === "PAID" || ps.paymentStatus === "PAID";
                      const isUnpaid = ps.paymentStatus === "UNPAID";

                      return (
                        <tr
                          key={ps.id}
                          style={{
                            borderBottom: "1px solid #f4f4f5",
                            transition: "background 0.15s ease",
                          }}
                        >
                          <td style={{ padding: "14px", fontWeight: 600, color: "#09090b" }}>
                            <div>
                              {ps.month} {ps.year}
                            </div>
                            <div style={{ fontSize: 11.5, color: "#71717a", fontWeight: 400, marginTop: 2 }}>
                              {ps.payslipNumber || ps.period}
                            </div>
                          </td>
                          <td style={{ padding: "14px", color: "#09090b" }}>
                            ₹{Number(ps.grossSalary || 0).toLocaleString("en-IN")}
                          </td>
                          <td style={{ padding: "14px", color: "#b91c1c", fontWeight: 500 }}>
                            -₹{Number(ps.deductions || 0).toLocaleString("en-IN")}
                          </td>
                          <td style={{ padding: "14px", fontWeight: 700, color: "#166534", fontSize: 14 }}>
                            ₹{Number(ps.netPay || 0).toLocaleString("en-IN")}
                          </td>
                          <td style={{ padding: "14px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "4px 8px",
                                borderRadius: 12,
                                fontSize: 11.5,
                                fontWeight: 600,
                                background: isPaid ? "#f0fdf4" : isUnpaid ? "#eff6ff" : "#fffbeb",
                                color: isPaid ? "#15803d" : isUnpaid ? "#1d4ed8" : "#b45309",
                              }}
                            >
                              {isPaid ? <IconCheck size={12} /> : <IconClock size={12} />}
                              <span>{isPaid ? "PAID" : isUnpaid ? "FINALIZED (UNPAID)" : ps.status}</span>
                            </span>
                            {ps.disbursedDate && (
                              <div style={{ fontSize: 11, color: "#71717a", marginTop: 3 }}>
                                {isPaid ? `Paid: ${ps.disbursedDate}` : `Finalized: ${ps.disbursedDate}`}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "14px" }}>
                            {ps.isFinalizedPayroll ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: "#0369a1",
                                  background: "#f0f9ff",
                                  padding: "3px 7px",
                                  borderRadius: 4,
                                  border: "1px solid #bae6fd",
                                }}
                              >
                                Finalized Payroll
                              </span>
                            ) : (
                              <span
                                title="Generated from employee compensation structure prior to formal payroll cycle finalization"
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: "#6b7280",
                                  background: "#f3f4f6",
                                  padding: "3px 7px",
                                  borderRadius: 4,
                                  border: "1px solid #e5e7eb",
                                }}
                              >
                                Legacy Preview
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "14px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                              <button
                                type="button"
                                className="btn-sm btn-secondary"
                                onClick={() => setSelectedPayslip(ps)}
                                style={{ fontSize: 12 }}
                              >
                                Breakdown
                              </button>
                              <button
                                type="button"
                                className="btn-sm btn-primary"
                                onClick={() => handleDownloadPayslip(ps.id)}
                                disabled={downloadingId === ps.id}
                                style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
                              >
                                <IconDownload size={13} />
                                <span>{downloadingId === ps.id ? "Downloading..." : "PDF"}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </div>
        </>
      )}

      {/* DETAILED SALARY BREAKDOWN MODAL */}
      {selectedPayslip && (
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
          onClick={() => setSelectedPayslip(null)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 640,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, borderBottom: "1px solid #e4e4e7", paddingBottom: 14 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Payslip Breakdown — {selectedPayslip.month} {selectedPayslip.year}
                </h3>
                <div style={{ fontSize: 12.5, color: "#71717a" }}>
                  Reference: <strong>{selectedPayslip.payslipNumber}</strong> • Period: {selectedPayslip.period}
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setSelectedPayslip(null)}
                aria-label="Close"
              >
                <IconClose size={16} />
              </button>
            </div>

            {/* Attendance & Days Summary */}
            {selectedPayslip.daysBreakdown && (
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "12px 16px",
                  marginBottom: 18,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <div>
                  <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                    Working Days
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                    {selectedPayslip.daysBreakdown.workingDays ?? "-"}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                    Present Days
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#166534" }}>
                    {selectedPayslip.daysBreakdown.presentDays ?? "-"}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                    Paid Leave
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#0284c7" }}>
                    {selectedPayslip.daysBreakdown.paidLeaveDays ?? "-"}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                    Loss of Pay
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626" }}>
                    {selectedPayslip.daysBreakdown.lossOfPayDays ?? 0}
                  </div>
                </div>
                <div>
                  <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                    Payable Days
                  </span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#1e3a8a" }}>
                    {selectedPayslip.daysBreakdown.payableDays ?? "-"}
                  </div>
                </div>
              </div>
            )}

            {/* Earnings & Deductions Tables */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
              {/* Earnings */}
              <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: "#166534", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Earnings
                </div>
                <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                  {(selectedPayslip.earnings?.length > 0 ? selectedPayslip.earnings : [
                    { name: "Basic Salary", amount: selectedPayslip.basicSalary || Math.round(selectedPayslip.grossSalary * 0.5) },
                    { name: "House Rent Allowance (HRA)", amount: selectedPayslip.houseRentAllowance || Math.round(selectedPayslip.grossSalary * 0.3) },
                    { name: "Special Allowance", amount: selectedPayslip.specialAllowance || Math.max(0, selectedPayslip.grossSalary - (selectedPayslip.basicSalary || 0) - (selectedPayslip.houseRentAllowance || 0)) },
                  ]).map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#52525b" }}>{item.name}</span>
                      <span style={{ fontWeight: 600, color: "#09090b" }}>
                        ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px dashed #d4d4d8", paddingTop: 8, marginTop: 4, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>Gross Earnings</span>
                    <span style={{ color: "#166534" }}>₹{Number(selectedPayslip.grossSalary || 0).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: "#b91c1c", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Deductions
                </div>
                <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                  {(selectedPayslip.employeeDeductions?.length > 0 ? selectedPayslip.employeeDeductions : [
                    { name: "Provident Fund (EPF)", amount: selectedPayslip.deductions || 0 },
                  ]).map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#52525b" }}>{item.name}</span>
                      <span style={{ fontWeight: 600, color: "#b91c1c" }}>
                        ₹{Number(item.amount || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px dashed #d4d4d8", paddingTop: 8, marginTop: 4, display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>Total Deductions</span>
                    <span style={{ color: "#b91c1c" }}>-₹{Number(selectedPayslip.deductions || 0).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Employer Contributions if present */}
            {selectedPayslip.employerContributions?.length > 0 && (
              <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, padding: "12px 16px", marginBottom: 18, background: "#fafafa" }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: "#52525b", marginBottom: 8, textTransform: "uppercase" }}>
                  Employer Contributions (Non-Taxable Benefits)
                </div>
                <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                  {selectedPayslip.employerContributions.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#71717a" }}>{item.name}</span>
                      <span style={{ fontWeight: 600, color: "#09090b" }}>₹{Number(item.amount || 0).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Net Pay Banner */}
            <div
              style={{
                background: "#f0fdf4",
                border: "1.5px solid #86efac",
                borderRadius: 10,
                padding: "16px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#166534" }}>
                  Net Take-Home Pay
                </span>
                <div style={{ fontSize: 12, color: "#15803d", marginTop: 2 }}>
                  Gross Earnings minus Total Employee Deductions
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#166534" }}>
                ₹{Number(selectedPayslip.netPay || 0).toLocaleString("en-IN")}
              </div>
            </div>

            {/* Payment Record info */}
            {selectedPayslip.payments?.length > 0 && (
              <div
                style={{
                  fontSize: 12.5,
                  color: "#166534",
                  background: "#f0fdf4",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #bbf7d0",
                  marginBottom: 18,
                }}
              >
                Payment recorded on{" "}
                <strong>{new Date(selectedPayslip.payments[0].paymentDate).toLocaleDateString()}</strong> via{" "}
                <strong>{selectedPayslip.payments[0].paymentMethod}</strong>
                {selectedPayslip.payments[0].referenceNumber
                  ? ` (Ref: ${selectedPayslip.payments[0].referenceNumber})`
                  : ""}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedPayslip(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleDownloadPayslip(selectedPayslip.id)}
                disabled={downloadingId === selectedPayslip.id}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <IconDownload size={14} />
                <span>{downloadingId === selectedPayslip.id ? "Downloading..." : "Download PDF"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL & FINAL SETTLEMENT MODAL */}
      {showSettlementModal && mySettlement && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 16,
          }}
          onClick={() => setShowSettlementModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              maxWidth: 760,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Full & Final Settlement Statement
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowSettlementModal(false)}
              >
                <IconClose size={14} />
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 12,
                padding: "16px 20px",
                background: "#f8fafc",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                marginBottom: 18,
              }}
            >
              <div>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                  Gross Earnings
                </span>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#166534", marginTop: 2 }}>
                  ₹{(mySettlement.totalEarnings || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                  Total Deductions
                </span>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#b91c1c", marginTop: 2 }}>
                  -₹{(mySettlement.totalDeductions || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                  Net Settlement Pay
                </span>
                <div style={{ fontSize: 19, fontWeight: 800, color: "#1d4ed8", marginTop: 2 }}>
                  ₹{(mySettlement.netSettlementAmount || 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                  Status
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginTop: 4 }}>
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

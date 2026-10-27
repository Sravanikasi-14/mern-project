import { useEffect, useState, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import {
  IconClose,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconArrowLeft,
  IconDocument,
  IconRefresh,
  IconDownload,
  IconFileText,
  IconClock,
} from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import Pagination from "../components/Pagination";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import AppHeader from "../components/AppHeader";
import "./AdminPayroll.css";

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminPayroll() {
  const { user, company } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Active top tab: "payroll_registers" or "ff_settlements"
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("settlementId") || params.get("tab") === "ff_settlements") return "ff_settlements";
    return "payroll_registers";
  });

  // Settlements List State
  const [settlements, setSettlements] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [refreshKey, setRefreshKey] = useState(0);
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementPageSize, setSettlementPageSize] = useState(10);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setSettlementPage(1);
  }, [debouncedSearchTerm, statusFilter]);

  const totalSettlements = settlements.length;
  const totalSettlementPages = Math.ceil((totalSettlements || 1) / settlementPageSize);
  const paginatedSettlements = useMemo(() => {
    const start = (settlementPage - 1) * settlementPageSize;
    return settlements.slice(start, start + settlementPageSize);
  }, [settlements, settlementPage, settlementPageSize]);

  // Selected Settlement Details State
  const [selectedSettlementId, setSelectedSettlementId] = useState(null);
  const [activeSettlement, setActiveSettlement] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  // Settlement Editing State
  const [editingEarnings, setEditingEarnings] = useState([]);
  const [editingDeductions, setEditingDeductions] = useState([]);
  const [hrRemarks, setHrRemarks] = useState("");
  const [adjustmentRemarks, setAdjustmentRemarks] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Add Item States
  const [newEarnItem, setNewEarnItem] = useState({ title: "", category: "OTHER", amount: "" });
  const [newDedItem, setNewDedItem] = useState({ title: "", category: "OTHER", amount: "" });
  const [showAddEarnForm, setShowAddEarnForm] = useState(false);
  const [showAddDedForm, setShowAddDedForm] = useState(false);

  // Modals State
  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState({
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "NEFT_RTGS",
    referenceNumber: "",
    remarks: "",
  });
  const [submittingPay, setSubmittingPay] = useState(false);

  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [submittingHold, setSubmittingHold] = useState(false);

  const [showStatementModal, setShowStatementModal] = useState(false);

  // Monthly Payroll Cycles & Registers State
  const [payrollCycles, setPayrollCycles] = useState([]);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [cyclePayslips, setCyclePayslips] = useState([]);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingCycleDetails, setLoadingCycleDetails] = useState(false);
  const [cyclesError, setCyclesError] = useState("");
  const [cycleActionLoading, setCycleActionLoading] = useState(false);
  const [payrollActionSuccess, setPayrollActionSuccess] = useState("");
  const [payrollActionError, setPayrollActionError] = useState("");
  const [payrollSearch, setPayrollSearch] = useState("");
  const [payrollStatusFilter, setPayrollStatusFilter] = useState("ALL");
  const [payrollDeptFilter, setPayrollDeptFilter] = useState("ALL");

  // Modals for Monthly Payroll
  const [showNewCycleModal, setShowNewCycleModal] = useState(false);
  const [newCycleForm, setNewCycleForm] = useState({
    periodMonth: new Date().getMonth() + 1,
    periodYear: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    notes: "",
  });
  const [showCyclePayModal, setShowCyclePayModal] = useState(false);
  const [cyclePayForm, setCyclePayForm] = useState({
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "NEFT_RTGS",
    referenceNumber: "",
    amount: "",
    remarks: "",
  });
  const [selectedBreakdownPayslip, setSelectedBreakdownPayslip] = useState(null);

  // Read URL query parameter for settlementId or tab
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sid = params.get("settlementId");
    const tab = params.get("tab");
    if (sid) {
      setSelectedSettlementId(sid);
      setActiveTab("ff_settlements");
    } else if (tab === "payroll_registers" || tab === "registers" || tab === "cycles") {
      setActiveTab("payroll_registers");
      setSelectedSettlementId(null);
    }
  }, [location.search]);

  // Fetch list of settlements only when settlements tab is active
  useEffect(() => {
    if (activeTab !== "ff_settlements") return;

    let cancelled = false;
    const fetchList = async () => {
      setLoadingList(true);
      setListError("");
      try {
        const queryParams = new URLSearchParams();
        if (debouncedSearchTerm.trim()) queryParams.set("search", debouncedSearchTerm.trim());
        if (statusFilter !== "ALL") queryParams.set("status", statusFilter);

        const res = await api.get(`/settlements?${queryParams.toString()}`);
        if (!cancelled) {
          setSettlements(res.data?.settlements || []);
        }
      } catch (err) {
        if (!cancelled) {
          setListError(err.response?.data?.message || "Failed to load settlements.");
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };

    fetchList();
    return () => {
      cancelled = true;
    };
  }, [activeTab, debouncedSearchTerm, statusFilter, refreshKey]);

  // Fetch selected settlement details
  useEffect(() => {
    if (!selectedSettlementId) {
      setActiveSettlement(null);
      return;
    }

    let cancelled = false;
    const fetchDetails = async () => {
      setLoadingDetails(true);
      setDetailsError("");
      setActionError("");
      setActionSuccess("");
      try {
        const res = await api.get(`/settlements/${selectedSettlementId}`);
        if (!cancelled) {
          const s = res.data?.settlement;
          setActiveSettlement(s);
          setEditingEarnings(s?.financialBreakdown?.earnings || []);
          setEditingDeductions(s?.financialBreakdown?.deductions || []);
          setHrRemarks(s?.exitDetails?.hrRemarks || "");
          setAdjustmentRemarks("");
        }
      } catch (err) {
        if (!cancelled) {
          setDetailsError(err.response?.data?.message || "Failed to load settlement details.");
        }
      } finally {
        if (!cancelled) setLoadingDetails(false);
      }
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedSettlementId]);

  // Totals preview
  const previewTotals = useMemo(() => {
    const totalEarnings = editingEarnings.reduce((acc, it) => acc + (parseFloat(it.amount) || 0), 0);
    const totalDeductions = editingDeductions.reduce((acc, it) => acc + (parseFloat(it.amount) || 0), 0);
    const net = Math.max(0, totalEarnings - totalDeductions);
    return { totalEarnings, totalDeductions, net };
  }, [editingEarnings, editingDeductions]);

  // Save draft changes
  const handleSaveDraft = async () => {
    if (!activeSettlement) return;
    setIsSavingDraft(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await api.patch(`/settlements/${activeSettlement._id}`, {
        earnings: editingEarnings,
        deductions: editingDeductions,
        hrRemarks,
        manualAdjustmentRemarks: adjustmentRemarks,
      });
      setActiveSettlement(res.data?.settlement);
      setActionSuccess("Settlement draft saved successfully.");
      setAdjustmentRemarks("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to update settlement draft.");
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Status transitions
  const handleTransitionStatus = async (targetStatus, reason = "") => {
    if (!activeSettlement) return;
    setActionError("");
    setActionSuccess("");
    try {
      const res = await api.post(`/settlements/${activeSettlement._id}/status`, {
        status: targetStatus,
        reason,
        remarks: reason,
      });
      setActiveSettlement(res.data?.settlement);
      setActionSuccess(`Settlement status moved to ${targetStatus.replace("_", " ")}.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.response?.data?.message || `Failed to transition status to ${targetStatus}.`);
    }
  };

  // Record payment
  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!activeSettlement) return;
    setSubmittingPay(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await api.post(`/settlements/${activeSettlement._id}/pay`, payForm);
      setActiveSettlement(res.data?.settlement);
      setShowPayModal(false);
      setActionSuccess("Settlement payment recorded successfully.");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to record payment.");
    } finally {
      setSubmittingPay(false);
    }
  };

  // Place on hold
  const handleConfirmHold = async (e) => {
    e.preventDefault();
    if (!activeSettlement || !holdReason.trim()) return;
    setSubmittingHold(true);
    try {
      await handleTransitionStatus("ON_HOLD", holdReason.trim());
      setShowHoldModal(false);
      setHoldReason("");
    } finally {
      setSubmittingHold(false);
    }
  };

  // Complete settlement
  const handleCompleteSettlement = async () => {
    if (!activeSettlement) return;
    if (!window.confirm("Are you sure you want to formally complete and close this settlement? This marks the F&F cycle as finished.")) {
      return;
    }
    setActionError("");
    setActionSuccess("");
    try {
      const res = await api.post(`/settlements/${activeSettlement._id}/complete`);
      setActiveSettlement(res.data?.settlement);
      setActionSuccess("Settlement formally completed.");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to complete settlement.");
    }
  };

  // Add Earning line item
  const handleAddEarning = (e) => {
    e.preventDefault();
    if (!newEarnItem.title.trim() || !newEarnItem.amount) return;
    const amt = parseFloat(newEarnItem.amount) || 0;
    setEditingEarnings((prev) => [
      ...prev,
      {
        id: `custom_earn_${Date.now()}`,
        title: newEarnItem.title.trim(),
        category: newEarnItem.category,
        amount: amt,
        isSystemCalculated: false,
        remarks: "Manually added by HR Admin",
      },
    ]);
    setNewEarnItem({ title: "", category: "OTHER", amount: "" });
    setShowAddEarnForm(false);
  };

  // Add Deduction line item
  const handleAddDeduction = (e) => {
    e.preventDefault();
    if (!newDedItem.title.trim() || !newDedItem.amount) return;
    const amt = parseFloat(newDedItem.amount) || 0;
    setEditingDeductions((prev) => [
      ...prev,
      {
        id: `custom_ded_${Date.now()}`,
        title: newDedItem.title.trim(),
        category: newDedItem.category,
        amount: amt,
        isSystemCalculated: false,
        remarks: "Manually added by HR Admin",
      },
    ]);
    setNewDedItem({ title: "", category: "OTHER", amount: "" });
    setShowAddDedForm(false);
  };

  const isEditable =
    activeSettlement?.status === "DRAFT" || activeSettlement?.status === "ON_HOLD";

  // ==========================================
  // Monthly Payroll Registers Logic & Handlers
  // ==========================================

  const monthNamesList = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const fetchPayrollCycles = async (preferCycleId = null) => {
    setLoadingCycles(true);
    setCyclesError("");
    try {
      const res = await api.get("/payroll/cycles");
      const list = res.data?.cycles || [];
      setPayrollCycles(list);

      if (list.length > 0) {
        const targetId = preferCycleId || (list.some((c) => c._id === selectedCycleId) ? selectedCycleId : list[0]._id);
        setSelectedCycleId(targetId);
      } else {
        setSelectedCycleId("");
        setSelectedCycle(null);
        setCyclePayslips([]);
      }
    } catch (err) {
      setCyclesError(err.response?.data?.message || "Failed to load payroll cycles.");
    } finally {
      setLoadingCycles(false);
    }
  };

  const fetchCycleDetails = async (cycleId) => {
    if (!cycleId) return;
    setLoadingCycleDetails(true);
    try {
      const res = await api.get(`/payroll/cycles/${cycleId}`);
      setSelectedCycle(res.data?.cycle || null);
      const fetchedPayslips = res.data?.payslips || [];
      setCyclePayslips(fetchedPayslips);
      if (fetchedPayslips.length > 0) {
        setSelectedBreakdownPayslip(fetchedPayslips[0]);
      } else {
        setSelectedBreakdownPayslip(null);
      }
    } catch (err) {
      setPayrollActionError(err.response?.data?.message || "Failed to load cycle details.");
    } finally {
      setLoadingCycleDetails(false);
    }
  };

  // Fetch cycles when switching to payroll_registers tab
  useEffect(() => {
    if (activeTab === "payroll_registers") {
      fetchPayrollCycles();
    }
  }, [activeTab]);

  // Fetch cycle details when selected cycle changes
  useEffect(() => {
    if (activeTab === "payroll_registers" && selectedCycleId) {
      fetchCycleDetails(selectedCycleId);
    }
  }, [selectedCycleId, activeTab]);

  const handleCreateNewCycle = async (e) => {
    e.preventDefault();
    setCycleActionLoading(true);
    setPayrollActionError("");
    setPayrollActionSuccess("");

    // Explicitly parse and normalize month (1-12) and year (e.g. 2026)
    let monthNum = parseInt(newCycleForm.periodMonth ?? newCycleForm.month, 10);
    let yearNum = parseInt(newCycleForm.periodYear ?? newCycleForm.year, 10);

    // If period is supplied as a date or YYYY-MM string
    if (typeof newCycleForm.period === "string" && newCycleForm.period.includes("-")) {
      const parts = newCycleForm.period.split("-");
      yearNum = parseInt(parts[0], 10);
      monthNum = parseInt(parts[1], 10);
    } else if (newCycleForm.period instanceof Date) {
      yearNum = newCycleForm.period.getFullYear();
      monthNum = newCycleForm.period.getMonth() + 1;
    }

    try {
      const payload = {
        periodMonth: monthNum,
        periodYear: yearNum,
        month: monthNum,
        year: yearNum,
        notes: (newCycleForm.notes || "").trim(),
      };

      const res = await api.post("/payroll/cycles", payload);
      setPayrollActionSuccess(res.data?.message || "Payroll cycle created successfully.");
      setShowNewCycleModal(false);
      await fetchPayrollCycles(res.data?.cycle?._id || res.data?.data?._id);
    } catch (err) {
      setPayrollActionError(err.response?.data?.message || "Failed to create payroll cycle.");
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleRecalculateCycle = async () => {
    if (!selectedCycleId) return;
    setCycleActionLoading(true);
    setPayrollActionError("");
    setPayrollActionSuccess("");
    try {
      const res = await api.post(`/payroll/cycles/${selectedCycleId}/calculate`);
      setSelectedCycle(res.data?.cycle);
      setCyclePayslips(res.data?.payslips || []);
      setPayrollActionSuccess("Payroll draft recalculated successfully.");
      fetchPayrollCycles(selectedCycleId);
    } catch (err) {
      setPayrollActionError(err.response?.data?.message || "Failed to recalculate payroll draft.");
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleFinalizeCycle = async () => {
    if (!selectedCycleId || !selectedCycle) return;
    const confirmMsg = `Are you sure you want to finalize payroll for ${monthNamesList[selectedCycle.periodMonth - 1]} ${selectedCycle.periodYear}?\n\nThis will lock all employee records and make finalized payslips accessible to employees.`;
    if (!window.confirm(confirmMsg)) return;

    setCycleActionLoading(true);
    setPayrollActionError("");
    setPayrollActionSuccess("");
    try {
      const res = await api.post(`/payroll/cycles/${selectedCycleId}/finalize`);
      setSelectedCycle(res.data?.cycle);
      setPayrollActionSuccess(res.data?.message || "Payroll finalized successfully.");
      fetchCycleDetails(selectedCycleId);
      fetchPayrollCycles(selectedCycleId);
    } catch (err) {
      setPayrollActionError(err.response?.data?.message || "Failed to finalize payroll cycle.");
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleOpenCyclePayModal = () => {
    if (!selectedCycle) return;
    const remaining = Math.max(0, (selectedCycle.totalNetPayable || 0) - (selectedCycle.totalPaidAmount || 0));
    setCyclePayForm({
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "NEFT_RTGS",
      referenceNumber: "",
      amount: remaining > 0 ? remaining : selectedCycle.totalNetPayable || "",
      remarks: `Disbursement for ${monthNamesList[selectedCycle.periodMonth - 1]} ${selectedCycle.periodYear}`,
    });
    setShowCyclePayModal(true);
  };

  const handleRecordCyclePaymentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCycleId) return;
    setCycleActionLoading(true);
    setPayrollActionError("");
    setPayrollActionSuccess("");
    try {
      const res = await api.post(`/payroll/cycles/${selectedCycleId}/pay`, cyclePayForm);
      setPayrollActionSuccess(res.data?.message || "Payment recorded successfully.");
      setShowCyclePayModal(false);
      fetchCycleDetails(selectedCycleId);
      fetchPayrollCycles(selectedCycleId);
    } catch (err) {
      setPayrollActionError(err.response?.data?.message || "Failed to record payment.");
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleDownloadPayslipPdf = async (payslip) => {
    try {
      setPayrollActionError("");
      const res = await api.get(`/payroll/employee/payslips/${payslip._id}/download`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Payslip_${payslip.employeeSnapshot?.employeeCode || 'EMP'}_${payslip.periodYear}_${payslip.periodMonth}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setPayrollActionSuccess(`Payslip for ${payslip.employeeSnapshot?.fullName} downloaded.`);
    } catch (err) {
      setPayrollActionError("Unable to download payslip PDF. Please try again.");
    }
  };

  const handleExportRegisterCsv = () => {
    if (!selectedCycle || cyclePayslips.length === 0) return;

    const headers = [
      "Payslip Number",
      "Employee Code",
      "Employee Name",
      "Department",
      "Designation",
      "Working Days",
      "Present Days",
      "Paid Leave Days",
      "Loss of Pay Days",
      "Payable Days",
      "Gross Earnings (INR)",
      "Total Deductions (INR)",
      "Net Payable (INR)",
      "Status",
      "Payment Status",
    ];

    const rows = cyclePayslips.map((p) => [
      `"${p.payslipNumber || ""}"`,
      `"${p.employeeSnapshot?.employeeCode || ""}"`,
      `"${p.employeeSnapshot?.fullName || ""}"`,
      `"${p.employeeSnapshot?.department || ""}"`,
      `"${p.employeeSnapshot?.jobTitle || ""}"`,
      p.daysBreakdown?.workingDays ?? 0,
      p.daysBreakdown?.presentDays ?? 0,
      p.daysBreakdown?.paidLeaveDays ?? 0,
      p.daysBreakdown?.lossOfPayDays ?? 0,
      p.daysBreakdown?.payableDays ?? 0,
      p.grossEarnings ?? 0,
      p.totalDeductions ?? 0,
      p.netPayable ?? 0,
      `"${p.status || ""}"`,
      `"${p.paymentStatus || ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Payroll_Register_${selectedCycle.periodYear}_${selectedCycle.periodMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setPayrollActionSuccess("Payroll register CSV exported successfully.");
  };

  const departmentsList = useMemo(() => {
    const set = new Set();
    cyclePayslips.forEach((p) => {
      if (p.employeeSnapshot?.department) set.add(p.employeeSnapshot.department);
    });
    return Array.from(set).sort();
  }, [cyclePayslips]);

  const filteredPayslips = useMemo(() => {
    return cyclePayslips.filter((p) => {
      if (payrollStatusFilter === "PAID" && p.paymentStatus !== "PAID" && p.status !== "PAID") return false;
      if (payrollStatusFilter === "UNPAID" && (p.paymentStatus === "PAID" || p.status === "PAID")) return false;
      if (payrollDeptFilter !== "ALL" && p.employeeSnapshot?.department !== payrollDeptFilter) return false;
      if (payrollSearch.trim()) {
        const q = payrollSearch.toLowerCase().trim();
        const name = (p.employeeSnapshot?.fullName || "").toLowerCase();
        const code = (p.employeeSnapshot?.employeeCode || "").toLowerCase();
        const dept = (p.employeeSnapshot?.department || "").toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !dept.includes(q)) return false;
      }
      return true;
    });
  }, [cyclePayslips, payrollSearch, payrollStatusFilter, payrollDeptFilter]);

  const activeBreakdownPayslip = useMemo(() => {
    if (!filteredPayslips || filteredPayslips.length === 0) return null;
    const found = filteredPayslips.find((p) => p._id === selectedBreakdownPayslip?._id);
    return found || filteredPayslips[0];
  }, [filteredPayslips, selectedBreakdownPayslip]);

  return (
    <main className="container-wide admin-payroll-container">
      <AppHeader
        title="Payroll"
        actions={
          selectedSettlementId ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSelectedSettlementId(null);
                navigate("/admin/payroll");
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, height: 32 }}
            >
              <IconArrowLeft size={14} />
              <span>Back to Settlements</span>
            </button>
          ) : null
        }
      />

      {/* Top Module Tabs */}
      <div
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "1px solid var(--hair)",
          marginBottom: 14,
          paddingBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab("payroll_registers");
            setSelectedSettlementId(null);
          }}
          style={{
            background: activeTab === "payroll_registers" ? "var(--g-800)" : "transparent",
            color: activeTab === "payroll_registers" ? "#ffffff" : "var(--text-muted)",
            border: activeTab === "payroll_registers" ? "1px solid var(--g-800)" : "1px solid transparent",
            borderRadius: 8,
            padding: "8px 18px",
            fontSize: 13.5,
            fontWeight: activeTab === "payroll_registers" ? 600 : 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
            boxShadow: activeTab === "payroll_registers" ? "0 2px 4px rgba(21, 90, 55, 0.2)" : "none",
          }}
        >
          Payroll Registers & Payslips
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("ff_settlements");
          }}
          style={{
            background: activeTab === "ff_settlements" ? "var(--g-800)" : "transparent",
            color: activeTab === "ff_settlements" ? "#ffffff" : "var(--text-muted)",
            border: activeTab === "ff_settlements" ? "1px solid var(--g-800)" : "1px solid transparent",
            borderRadius: 8,
            padding: "8px 18px",
            fontSize: 13.5,
            fontWeight: activeTab === "ff_settlements" ? 600 : 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
            boxShadow: activeTab === "ff_settlements" ? "0 2px 4px rgba(21, 90, 55, 0.2)" : "none",
          }}
        >
          Final Settlements (F&F)
        </button>
      </div>

      {/* TAB 1: FULL & FINAL SETTLEMENTS */}
      {activeTab === "ff_settlements" && (
        <>
          {/* VIEW A: SETTLEMENT DETAILS VIEW */}
          {selectedSettlementId && activeSettlement ? (
            <div style={{ display: "grid", gap: 20 }}>
              {/* Status Alert Banners */}
              {actionSuccess && (
                <div role="status" style={{ padding: "12px 16px", background: "#f0fdf4", color: "#166534", borderRadius: 8, border: "1px solid #bbf7d0", fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <IconCheck size={16} />
                  <span>{actionSuccess}</span>
                </div>
              )}
              {actionError && (
                <div role="alert" className="error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconAlertCircle size={16} />
                  <span>{actionError}</span>
                </div>
              )}
              {detailsError && (
                <div role="alert" className="error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconAlertCircle size={16} />
                  <span>{detailsError}</span>
                </div>
              )}

              {/* Settlement Overview Header Card */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  padding: 24,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#09090b" }}>
                        {activeSettlement.employeeId?.fullName}
                      </h2>
                      <StatusBadge status={activeSettlement.status} />
                      {activeSettlement.status === "ON_HOLD" && (
                        <span style={{ fontSize: 12, padding: "2px 8px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontWeight: 600 }}>
                          Hold: {activeSettlement.holdReason || "Processing Paused"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13, color: "#71717a" }}>
                      <span><strong>Code:</strong> {activeSettlement.employeeId?.employeeCode || "—"}</span>
                      <span>•</span>
                      <span><strong>Job Title:</strong> {activeSettlement.employeeId?.job?.jobTitle || "—"}</span>
                      <span>•</span>
                      <span><strong>Last Day:</strong> {formatDate(activeSettlement.exitDetails?.lastWorkingDay)}</span>
                      <span>•</span>
                      <span><strong>Reason:</strong> {activeSettlement.exitDetails?.exitReason}</span>
                    </div>
                  </div>

                  {/* Top Print/Statement Button */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowStatementModal(true)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
                    >
                      <IconDocument size={14} />
                      <span>View Statement</span>
                    </button>
                  </div>
                </div>

                {/* Workflow Stepper */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 24,
                    padding: "14px 18px",
                    background: "#f9fafb",
                    borderRadius: 10,
                    border: "1px solid #f3f4f6",
                    overflowX: "auto",
                  }}
                >
                  {[
                    { key: "DRAFT", label: "1. Draft" },
                    { key: "UNDER_REVIEW", label: "2. Under Review" },
                    { key: "APPROVED", label: "3. Approved" },
                    { key: "PAID", label: "4. Paid" },
                    { key: "COMPLETED", label: "5. Completed" },
                  ].map((step, idx) => {
                    const stepOrder = ["DRAFT", "UNDER_REVIEW", "APPROVED", "PAID", "COMPLETED"];
                    const currentIdx = stepOrder.indexOf(activeSettlement.status === "ON_HOLD" ? "UNDER_REVIEW" : activeSettlement.status);
                    const isDone = currentIdx > idx;
                    const isCurrent = currentIdx === idx;

                    return (
                      <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            padding: "6px 12px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 600,
                            background: isCurrent ? "#18181b" : isDone ? "#dcfce7" : "#e4e4e7",
                            color: isCurrent ? "#ffffff" : isDone ? "#15803d" : "#71717a",
                          }}
                        >
                          {step.label}
                        </div>
                        {idx < 4 && <span style={{ color: "#d4d4d8", fontSize: 12 }}>→</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Missing Data Warnings */}
              {activeSettlement.calculationInputs?.missingDataFlags &&
                activeSettlement.calculationInputs.missingDataFlags.length > 0 && (
                  <div
                    style={{
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: 10,
                      padding: "14px 18px",
                      color: "#92400e",
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <IconAlertTriangle size={16} />
                      <span>Missing Information</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {activeSettlement.calculationInputs.missingDataFlags.map((flag, idx) => (
                        <li key={idx}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Calculation Baseline Snapshot Box */}
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  padding: "18px 22px",
                }}
              >
                <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "#09090b" }}>
                  Calculation Summary
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, fontSize: 13 }}>
                  <div>
                    <span style={{ color: "#71717a", fontSize: 12 }}>Monthly Salary</span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{formatCurrency(activeSettlement.calculationInputs?.monthlyCtc)}</div>
                  </div>
                  <div>
                    <span style={{ color: "#71717a", fontSize: 12 }}>Basic Salary</span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{formatCurrency(activeSettlement.calculationInputs?.basicSalary)}</div>
                  </div>
                  <div>
                    <span style={{ color: "#71717a", fontSize: 12 }}>Days Worked</span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>
                      {activeSettlement.calculationInputs?.workedDaysInExitMonth} / {activeSettlement.calculationInputs?.workingDaysInExitMonth} Days
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "#71717a", fontSize: 12 }}>Leave Balance</span>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>
                      {activeSettlement.calculationInputs?.earnedLeaveBalance || 0} Days
                    </div>
                  </div>
                </div>
              </div>

              {/* Itemized Financial Breakdown Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* 1. EARNINGS COLUMN */}
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: 12,
                    border: "1px solid #e4e4e7",
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#166534" }}>
                      Earnings
                    </h3>
                    {isEditable && (
                      <button
                        type="button"
                        className="btn-sm btn-secondary"
                        onClick={() => setShowAddEarnForm((v) => !v)}
                        style={{ fontSize: 12 }}
                      >
                        + Add Earning
                      </button>
                    )}
                  </div>

                  {/* Add Earning Form */}
                  {showAddEarnForm && isEditable && (
                    <form
                      onSubmit={handleAddEarning}
                      style={{
                        padding: 12,
                        background: "#f0fdf4",
                        borderRadius: 8,
                        marginBottom: 14,
                        border: "1px solid #bbf7d0",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <input
                        placeholder="Item Title (e.g. Incentive / Bonus)"
                        value={newEarnItem.title}
                        onChange={(e) => setNewEarnItem({ ...newEarnItem, title: e.target.value })}
                        required
                        style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <select
                          value={newEarnItem.category}
                          onChange={(e) => setNewEarnItem({ ...newEarnItem, category: e.target.value })}
                          style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                        >
                          <option value="SALARY">Salary</option>
                          <option value="BONUS">Bonus</option>
                          <option value="GRATUITY">Gratuity</option>
                          <option value="REIMBURSEMENT">Reimbursement</option>
                          <option value="OTHER">Other</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Amount (₹)"
                          min="0"
                          value={newEarnItem.amount}
                          onChange={(e) => setNewEarnItem({ ...newEarnItem, amount: e.target.value })}
                          required
                          style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
                        <button type="button" className="btn-sm btn-secondary" onClick={() => setShowAddEarnForm(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-sm btn-primary">
                          Add Item
                        </button>
                      </div>
                    </form>
                  )}

                  {editingEarnings.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "#71717a", fontSize: 13 }}>
                      No earnings items specified.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {editingEarnings.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            background: "#f9fafb",
                            borderRadius: 8,
                            border: "1px solid #f3f4f6",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13.5, color: "#09090b" }}>{item.title}</div>
                            {item.remarks && (
                              <div style={{ fontSize: 11.5, color: "#71717a", marginTop: 2 }}>{item.remarks}</div>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {isEditable ? (
                              <input
                                type="number"
                                min="0"
                                value={item.amount}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditingEarnings((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, amount: val } : it))
                                  );
                                }}
                                style={{
                                  width: 100,
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: "1px solid #d4d4d8",
                                  textAlign: "right",
                                }}
                              />
                            ) : (
                              <span style={{ fontWeight: 700, fontSize: 14, color: "#166534" }}>
                                {formatCurrency(item.amount)}
                              </span>
                            )}
                            {isEditable && (
                              <button
                                type="button"
                                onClick={() => setEditingEarnings((prev) => prev.filter((_, i) => i !== idx))}
                                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 4 }}
                                title="Remove item"
                              >
                                <IconClose size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e4e4e7", display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
                    <span>Total Earnings</span>
                    <span style={{ color: "#166534" }}>{formatCurrency(previewTotals.totalEarnings)}</span>
                  </div>
                </div>

                {/* 2. DEDUCTIONS COLUMN */}
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: 12,
                    border: "1px solid #e4e4e7",
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#b91c1c" }}>
                      Deductions
                    </h3>
                    {isEditable && (
                      <button
                        type="button"
                        className="btn-sm btn-secondary"
                        onClick={() => setShowAddDedForm((v) => !v)}
                        style={{ fontSize: 12 }}
                      >
                        + Add Deduction
                      </button>
                    )}
                  </div>

                  {/* Add Deduction Form */}
                  {showAddDedForm && isEditable && (
                    <form
                      onSubmit={handleAddDeduction}
                      style={{
                        padding: 12,
                        background: "#fef2f2",
                        borderRadius: 8,
                        marginBottom: 14,
                        border: "1px solid #fecaca",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <input
                        placeholder="Item Title (e.g. Asset Recovery / Notice Shortfall)"
                        value={newDedItem.title}
                        onChange={(e) => setNewDedItem({ ...newDedItem, title: e.target.value })}
                        required
                        style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <select
                          value={newDedItem.category}
                          onChange={(e) => setNewDedItem({ ...newDedItem, category: e.target.value })}
                          style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                        >
                          <option value="STATUTORY">Statutory</option>
                          <option value="ADVANCE_RECOVERY">Advance Recovery</option>
                          <option value="NOTICE_RECOVERY">Notice Period Recovery</option>
                          <option value="ASSET_RECOVERY">Asset Recovery</option>
                          <option value="TAX">Tax Deduction</option>
                          <option value="OTHER">Other</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Amount (₹)"
                          min="0"
                          value={newDedItem.amount}
                          onChange={(e) => setNewDedItem({ ...newDedItem, amount: e.target.value })}
                          required
                          style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #d4d4d8" }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
                        <button type="button" className="btn-sm btn-secondary" onClick={() => setShowAddDedForm(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="btn-sm btn-primary">
                          Add Item
                        </button>
                      </div>
                    </form>
                  )}

                  {editingDeductions.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "#71717a", fontSize: 13 }}>
                      No deductions entered.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {editingDeductions.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            background: "#f9fafb",
                            borderRadius: 8,
                            border: "1px solid #f3f4f6",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13.5, color: "#09090b" }}>{item.title}</div>
                            {item.remarks && (
                              <div style={{ fontSize: 11.5, color: "#71717a", marginTop: 2 }}>{item.remarks}</div>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {isEditable ? (
                              <input
                                type="number"
                                min="0"
                                value={item.amount}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setEditingDeductions((prev) =>
                                    prev.map((it, i) => (i === idx ? { ...it, amount: val } : it))
                                  );
                                }}
                                style={{
                                  width: 100,
                                  padding: "4px 8px",
                                  fontSize: 13,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: "1px solid #d4d4d8",
                                  textAlign: "right",
                                }}
                              />
                            ) : (
                              <span style={{ fontWeight: 700, fontSize: 14, color: "#b91c1c" }}>
                                {formatCurrency(item.amount)}
                              </span>
                            )}
                            {isEditable && (
                              <button
                                type="button"
                                onClick={() => setEditingDeductions((prev) => prev.filter((_, i) => i !== idx))}
                                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 4 }}
                                title="Remove item"
                              >
                                <IconClose size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e4e4e7", display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
                    <span>Total Deductions</span>
                    <span style={{ color: "#b91c1c" }}>{formatCurrency(previewTotals.totalDeductions)}</span>
                  </div>
                </div>
              </div>

              {/* NET SETTLEMENT SUMMARY BOX */}
              <div
                style={{
                  background: "#18181b",
                  borderRadius: 12,
                  padding: "20px 24px",
                  color: "#ffffff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.5px", color: "#a1a1aa" }}>
                    Net Settlement
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>
                    {formatCurrency(previewTotals.net)}
                  </div>
                  <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 2 }}>
                    Earnings ({formatCurrency(previewTotals.totalEarnings)}) − Deductions ({formatCurrency(previewTotals.totalDeductions)})
                  </div>
                </div>

                {/* Payment Details badge if Paid/Completed */}
                {activeSettlement.paymentDetails?.paymentDate && (
                  <div style={{ textAlign: "right", fontSize: 12.5, color: "#e4e4e7" }}>
                    <div><strong>Paid on:</strong> {formatDate(activeSettlement.paymentDetails.paymentDate)}</div>
                    <div><strong>Method:</strong> {activeSettlement.paymentDetails.paymentMethod?.replace("_", " ")}</div>
                    {activeSettlement.paymentDetails.referenceNumber && (
                      <div><strong>Ref:</strong> {activeSettlement.paymentDetails.referenceNumber}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Remarks and Adjustments Section (Editable in DRAFT/ON_HOLD) */}
              {isEditable && (
                <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #e4e4e7", padding: 20 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#09090b", marginBottom: 6 }}>
                    HR Offboarding Remarks
                  </label>
                  <textarea
                    rows="2"
                    value={hrRemarks}
                    onChange={(e) => setHrRemarks(e.target.value)}
                    placeholder="Enter HR settlement notes..."
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit", marginBottom: 12 }}
                  />

                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#09090b", marginBottom: 6 }}>
                    Adjustment Explanation (Audit Trail)
                  </label>
                  <input
                    type="text"
                    value={adjustmentRemarks}
                    onChange={(e) => setAdjustmentRemarks(e.target.value)}
                    placeholder="Brief explanation if manual adjustments were made..."
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
              )}

              {/* ACTION BAR BASED ON SETTLEMENT STATUS */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px 20px",
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <span style={{ fontSize: 13, color: "#71717a" }}>
                    Current Status: <strong>{activeSettlement.status?.replace("_", " ")}</strong>
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {activeSettlement.status === "DRAFT" && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleSaveDraft}
                        disabled={isSavingDraft}
                      >
                        {isSavingDraft ? "Saving..." : "Save Draft"}
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleTransitionStatus("UNDER_REVIEW")}
                      >
                        Submit for Review
                      </button>
                    </>
                  )}

                  {activeSettlement.status === "UNDER_REVIEW" && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleTransitionStatus("DRAFT", "Returned to draft for amendments")}
                      >
                        Return to Draft
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowHoldModal(true)}
                        style={{ color: "#b45309" }}
                      >
                        Place On Hold
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleTransitionStatus("APPROVED")}
                      >
                        Approve Settlement
                      </button>
                    </>
                  )}

                  {activeSettlement.status === "ON_HOLD" && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleSaveDraft}
                        disabled={isSavingDraft}
                      >
                        {isSavingDraft ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleTransitionStatus("UNDER_REVIEW", "Hold resumed")}
                      >
                        Resume Review
                      </button>
                    </>
                  )}

                  {activeSettlement.status === "APPROVED" && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setShowHoldModal(true)}
                      >
                        Place On Hold
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setShowPayModal(true)}
                      >
                        Record Payment
                      </button>
                    </>
                  )}

                  {activeSettlement.status === "PAID" && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCompleteSettlement}
                    >
                      Complete & Close Settlement
                    </button>
                  )}

                  {activeSettlement.status === "COMPLETED" && (
                    <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>
                      Settlement Formally Closed
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* VIEW B: SETTLEMENTS LIST TABLE */
            <div style={{ display: "grid", gap: 16 }}>
              {/* Search and Filters */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  background: "#ffffff",
                  padding: "16px 20px",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                }}
              >
                <div style={{ display: "flex", gap: 10, flex: 1, minWidth: 260 }}>
                  <input
                    type="search"
                    placeholder="Search by employee name, ID, or exit reason..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: "100%",
                      maxWidth: 360,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #d4d4d8",
                      fontSize: 13.5,
                    }}
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #d4d4d8",
                      fontSize: 13.5,
                    }}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="DRAFT">Draft</option>
                    <option value="UNDER_REVIEW">Under Review</option>
                    <option value="APPROVED">Approved</option>
                    <option value="ON_HOLD">On Hold</option>
                    <option value="PAID">Paid</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setRefreshKey((k) => k + 1)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <IconRefresh size={14} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {listError && (
                <div role="alert" className="error">
                  {listError}
                </div>
              )}

              {/* Settlements Table */}
              <div
                className="table-wrapper-relative"
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #e4e4e7",
                  overflow: "hidden",
                }}
              >
                {loadingList && <div className="table-progress-bar" />}
                {loadingList && settlements.length === 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                      <thead>
                        <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                          <th style={{ padding: "12px 16px" }}>Employee</th>
                          <th style={{ padding: "12px 16px" }}>Last Day</th>
                          <th style={{ padding: "12px 16px" }}>Reason</th>
                          <th style={{ padding: "12px 16px" }}>Initiated</th>
                          <th style={{ padding: "12px 16px" }}>Net Amount</th>
                          <th style={{ padding: "12px 16px" }}>Status</th>
                          <th style={{ padding: "12px 16px", textAlign: "right" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        <TableSkeletonRows rows={5} cols={7} />
                      </tbody>
                    </table>
                  </div>
                ) : settlements.length === 0 ? (
                  <div style={{ padding: 48, textAlign: "center" }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "#09090b" }}>
                      No settlements found
                    </h3>
                    <p style={{ color: "#71717a", fontSize: 13.5, maxWidth: 420, margin: "0 auto" }}>
                      Settlements are created from the Employees page when an employee departs.
                    </p>
                  </div>
                ) : (
                  <>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                        <thead>
                          <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                            <th style={{ padding: "12px 16px" }}>Employee</th>
                            <th style={{ padding: "12px 16px" }}>Last Day</th>
                            <th style={{ padding: "12px 16px" }}>Reason</th>
                            <th style={{ padding: "12px 16px" }}>Initiated</th>
                            <th style={{ padding: "12px 16px" }}>Net Amount</th>
                            <th style={{ padding: "12px 16px" }}>Status</th>
                            <th style={{ padding: "12px 16px", textAlign: "right" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody className={loadingList ? "table-refreshing-dim" : ""}>
                          {paginatedSettlements.map((s) => (
                            <tr key={s._id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                              <td style={{ padding: "14px 16px" }}>
                                <div style={{ fontWeight: 600, color: "#09090b" }}>
                                  {s.employeeId?.fullName || "Employee"}
                                </div>
                                <div style={{ fontSize: 12, color: "#71717a" }}>
                                  {s.employeeId?.employeeCode} • {s.employeeId?.job?.department || "General"}
                                </div>
                              </td>
                              <td style={{ padding: "14px 16px", color: "#09090b" }}>
                                {formatDate(s.exitDetails?.lastWorkingDay)}
                              </td>
                              <td style={{ padding: "14px 16px", color: "#52525b" }}>
                                {s.exitDetails?.exitReason || "—"}
                              </td>
                              <td style={{ padding: "14px 16px", color: "#71717a", fontSize: 12.5 }}>
                                {formatDate(s.exitDetails?.initiatedAt || s.createdAt)}
                              </td>
                              <td style={{ padding: "14px 16px", fontWeight: 700, color: "#09090b" }}>
                                {formatCurrency(s.financialBreakdown?.netSettlementAmount)}
                              </td>
                              <td style={{ padding: "14px 16px" }}>
                                <StatusBadge status={s.status} />
                              </td>
                              <td style={{ padding: "14px 16px", textAlign: "right" }}>
                                <button
                                  type="button"
                                  className="btn-sm btn-secondary"
                                  onClick={() => {
                                    setSelectedSettlementId(s._id);
                                    navigate(`/admin/payroll?settlementId=${s._id}`);
                                  }}
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalSettlements > 0 && (
                      <Pagination
                        currentPage={settlementPage}
                        totalPages={totalSettlementPages}
                        totalItems={totalSettlements}
                        pageSize={settlementPageSize}
                        pageSizeOptions={[10, 25, 50]}
                        onPageChange={(p) => setSettlementPage(p)}
                        onPageSizeChange={(s) => {
                          setSettlementPageSize(s);
                          setSettlementPage(1);
                        }}
                        itemLabel="settlements"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: MONTHLY PAYROLL REGISTERS */}
      {activeTab === "payroll_registers" && (
        <div style={{ display: "grid", gap: 14 }}>
          {/* Action Alerts */}
          {payrollActionSuccess && (
            <div role="status" style={{ padding: "12px 16px", background: "#f0fdf4", color: "#166534", borderRadius: 8, border: "1px solid #bbf7d0", fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={16} />
              <span>{payrollActionSuccess}</span>
            </div>
          )}
          {payrollActionError && (
            <div role="alert" className="error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconAlertCircle size={16} />
              <span>{payrollActionError}</span>
            </div>
          )}
          {cyclesError && (
            <div role="alert" className="error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconAlertCircle size={16} />
              <span>{cyclesError}</span>
            </div>
          )}

          {/* Validation Issues Alert Banner */}
          {selectedCycle?.validationIssues?.length > 0 && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 10,
                padding: "12px 16px",
                color: "#92400e",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, marginBottom: 4 }}>
                <IconAlertTriangle size={16} />
                <span>Validation Notices ({selectedCycle.validationIssues.length} employees skipped from calculation)</span>
              </div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {selectedCycle.validationIssues.map((v, i) => (
                  <li key={i}>
                    <strong>{v.fullName} ({v.employeeCode}):</strong> {v.issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Compact Inline Payroll Metrics Strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              background: "var(--card, #ffffff)",
              border: "1px solid var(--hair, #e6ede8)",
              borderRadius: 8,
              padding: "8px 16px",
              marginBottom: 12,
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>
              Net Payable: <strong style={{ color: "var(--g-800, #155a37)" }}>{selectedCycle ? formatCurrency(selectedCycle.totalNetPayable) : "₹0"}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              Payslips: <strong style={{ color: "var(--ink)" }}>{cyclePayslips.length}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              Pending Disbursals: <strong style={{ color: "#b45309" }}>{cyclePayslips.filter((p) => p.paymentStatus !== "PAID").length}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted)" }}>
              Total Disbursed: <strong style={{ color: selectedCycle?.totalPaidAmount > 0 ? "var(--g-800)" : "var(--muted)" }}>{selectedCycle ? formatCurrency(selectedCycle.totalPaidAmount || 0) : "₹0"}</strong>
            </span>
          </div>

          {/* Payroll Control & Filter Toolbar */}
          <div className="ap-toolbar">
            <div className="ap-toolbar-left">
              <label htmlFor="payrollCycleSelect" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                Period:
              </label>
              <select
                id="payrollCycleSelect"
                value={selectedCycleId}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                className="ap-select"
                style={{ fontWeight: 600, minWidth: 210 }}
              >
                {payrollCycles.length === 0 ? (
                  <option value="">No cycles available</option>
                ) : (
                  payrollCycles.map((c) => (
                    <option key={c._id} value={c._id}>
                      {monthNamesList[c.periodMonth - 1]} {c.periodYear} ({c.status})
                    </option>
                  ))
                )}
              </select>

              <div className="ap-filter-pill-group">
                <button
                  type="button"
                  className={`ap-filter-pill ${payrollStatusFilter === "ALL" ? "active" : ""}`}
                  onClick={() => setPayrollStatusFilter("ALL")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`ap-filter-pill ${payrollStatusFilter === "PAID" ? "active" : ""}`}
                  onClick={() => setPayrollStatusFilter("PAID")}
                >
                  Paid
                </button>
                <button
                  type="button"
                  className={`ap-filter-pill ${payrollStatusFilter === "UNPAID" ? "active" : ""}`}
                  onClick={() => setPayrollStatusFilter("UNPAID")}
                >
                  Pending
                </button>
              </div>

              {departmentsList.length > 0 && (
                <select
                  value={payrollDeptFilter}
                  onChange={(e) => setPayrollDeptFilter(e.target.value)}
                  className="ap-select"
                  aria-label="Filter by department"
                >
                  <option value="ALL">All Departments</option>
                  {departmentsList.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="ap-toolbar-right">
              <input
                type="search"
                placeholder="Search employee or code..."
                value={payrollSearch}
                onChange={(e) => setPayrollSearch(e.target.value)}
                className="ap-search-input"
              />

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowNewCycleModal(true)}
                style={{ fontSize: 12.5 }}
              >
                + New Cycle
              </button>

              {selectedCycle && (
                <>
                  {selectedCycle.status !== "FINALIZED" && selectedCycle.status !== "PAID" && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleRecalculateCycle}
                      disabled={cycleActionLoading}
                      title="Recalculate earnings and attendance for this period"
                      style={{ fontSize: 12.5 }}
                    >
                      Recalculate
                    </button>
                  )}

                  {selectedCycle.status !== "FINALIZED" && selectedCycle.status !== "PAID" && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleFinalizeCycle}
                      disabled={cycleActionLoading}
                      style={{ fontSize: 12.5, background: "var(--g-800)", borderColor: "var(--g-950)" }}
                      title="Finalize payroll and unlock payslips for employees"
                    >
                      Finalize Payroll
                    </button>
                  )}

                  {(selectedCycle.status === "FINALIZED" || selectedCycle.status === "PARTIALLY_PAID") && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleOpenCyclePayModal}
                      disabled={cycleActionLoading}
                      style={{ fontSize: 12.5, background: "var(--g-800)", borderColor: "var(--g-950)" }}
                    >
                      Record Payment
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleExportRegisterCsv}
                    disabled={cyclePayslips.length === 0}
                    title="Download register as CSV spreadsheet"
                    style={{ fontSize: 12.5 }}
                  >
                    Export CSV
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Master-Detail Payslip Workspace (Stitch Screen A) */}
          <div className="ap-workspace-grid">
            {/* Left Column: Employee Register List */}
            <div className="ap-list-panel">
              <div className="ap-list-header">
                <h3 className="ap-list-title">Employee Register</h3>
                <span className="ap-list-count">{filteredPayslips.length} Employees</span>
              </div>

              {loadingCycleDetails && cyclePayslips.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  <div className="spinner" style={{ margin: "0 auto 10px" }} />
                  <div style={{ fontSize: 13 }}>Loading register...</div>
                </div>
              ) : filteredPayslips.length === 0 ? (
                <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  <IconFileText size={32} style={{ color: "#d4d4d8", margin: "0 auto 8px" }} />
                  <div>No employee records found in this cycle.</div>
                </div>
              ) : (
                filteredPayslips.map((p) => {
                  const isSelected = activeBreakdownPayslip?._id === p._id;
                  const isPaid = p.paymentStatus === "PAID" || p.status === "PAID";

                  return (
                    <div
                      key={p._id}
                      className={`ap-card-item ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedBreakdownPayslip(p)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedBreakdownPayslip(p);
                      }}
                    >
                      <div className="ap-card-header">
                        <div>
                          <div className="ap-card-name">
                            {p.employeeSnapshot?.fullName || "Employee"}
                          </div>
                          <div className="ap-card-sub">
                            {p.employeeSnapshot?.employeeCode || "—"} • {p.employeeSnapshot?.department || "General"}
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
                          <span>{isPaid ? "PAID" : p.status || "FINALIZED"}</span>
                        </span>
                      </div>

                      <div className="ap-card-footer">
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          Payable Days: {p.daysBreakdown?.payableDays ?? "—"}d
                        </span>
                        <div className="ap-card-amount">
                          {formatCurrency(p.netPayable)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Column: Selected Employee Payslip Deep-Dive */}
            <div className="ap-detail-panel">
              {activeBreakdownPayslip ? (
                <>
                  {/* Detail Header */}
                  <div className="ap-detail-header">
                    <div className="ap-detail-title-group">
                      <h2>
                        {activeBreakdownPayslip.employeeSnapshot?.fullName}
                      </h2>
                      <div className="ap-detail-meta">
                        <span><strong>Code:</strong> {activeBreakdownPayslip.employeeSnapshot?.employeeCode || "—"}</span>
                        <span>•</span>
                        <span><strong>Designation:</strong> {activeBreakdownPayslip.employeeSnapshot?.jobTitle || "—"}</span>
                        <span>•</span>
                        <span><strong>Department:</strong> {activeBreakdownPayslip.employeeSnapshot?.department || "—"}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {(selectedCycle?.status === "FINALIZED" || selectedCycle?.status === "PAID") && (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleDownloadPayslipPdf(activeBreakdownPayslip)}
                          style={{ fontSize: 12.5, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                        >
                          <IconDownload size={14} />
                          <span>Download PDF</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Attendance & Days Summary Bar */}
                  {activeBreakdownPayslip.daysBreakdown && (
                    <div className="ap-attendance-bar">
                      <div className="ap-att-item">
                        <span className="ap-att-label">Total Days</span>
                        <span className="ap-att-val">{activeBreakdownPayslip.daysBreakdown.totalDaysInMonth ?? "—"}</span>
                      </div>
                      <div className="ap-att-item">
                        <span className="ap-att-label">Working Days</span>
                        <span className="ap-att-val">{activeBreakdownPayslip.daysBreakdown.workingDays ?? "—"}</span>
                      </div>
                      <div className="ap-att-item">
                        <span className="ap-att-label">Present</span>
                        <span className="ap-att-val green">{activeBreakdownPayslip.daysBreakdown.presentDays ?? "—"}</span>
                      </div>
                      <div className="ap-att-item">
                        <span className="ap-att-label">Paid Leave</span>
                        <span className="ap-att-val" style={{ color: "#2563eb" }}>{activeBreakdownPayslip.daysBreakdown.paidLeaveDays ?? 0}</span>
                      </div>
                      <div className="ap-att-item">
                        <span className="ap-att-label">Loss of Pay</span>
                        <span className="ap-att-val red">{activeBreakdownPayslip.daysBreakdown.lossOfPayDays ?? 0}</span>
                      </div>
                      <div className="ap-att-item">
                        <span className="ap-att-label">Payable Days</span>
                        <span className="ap-att-val" style={{ fontWeight: 800 }}>{activeBreakdownPayslip.daysBreakdown.payableDays ?? "—"}</span>
                      </div>
                    </div>
                  )}

                  {/* Itemized Financial Breakdown (2-Column) */}
                  <div className="ap-breakdown-grid">
                    {/* Left: Earnings */}
                    <div className="ap-section-box">
                      <div className="ap-section-title earnings">
                        Earnings & Allowances
                      </div>
                      {(!activeBreakdownPayslip.earnings || activeBreakdownPayslip.earnings.length === 0) ? (
                        <div className="ap-line-item">
                          <span className="ap-line-name">Gross Base Salary</span>
                          <span className="ap-line-amount">{formatCurrency(activeBreakdownPayslip.grossEarnings)}</span>
                        </div>
                      ) : (
                        activeBreakdownPayslip.earnings.map((e, idx) => (
                          <div key={idx} className="ap-line-item">
                            <span className="ap-line-name">{e.name}</span>
                            <span className="ap-line-amount">{formatCurrency(e.amount)}</span>
                          </div>
                        ))
                      )}
                      <div className="ap-section-total">
                        <span>Total Gross Earnings</span>
                        <span style={{ color: "var(--g-800)" }}>{formatCurrency(activeBreakdownPayslip.grossEarnings)}</span>
                      </div>
                    </div>

                    {/* Right: Deductions */}
                    <div className="ap-section-box">
                      <div className="ap-section-title deductions">
                        Statutory Deductions
                      </div>
                      {(!activeBreakdownPayslip.employeeDeductions || activeBreakdownPayslip.employeeDeductions.length === 0) ? (
                        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "8px 0", fontStyle: "italic" }}>
                          No statutory deductions recorded
                        </div>
                      ) : (
                        activeBreakdownPayslip.employeeDeductions.map((d, idx) => (
                          <div key={idx} className="ap-line-item">
                            <span className="ap-line-name">{d.name}</span>
                            <span className="ap-line-amount deduct">-{formatCurrency(d.amount)}</span>
                          </div>
                        ))
                      )}
                      <div className="ap-section-total">
                        <span>Total Deductions</span>
                        <span style={{ color: "#b91c1c" }}>-{formatCurrency(activeBreakdownPayslip.totalDeductions)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Hero Net Take-Home Card */}
                  <div className="ap-hero-netpay">
                    <div>
                      <div className="ap-hero-netpay-label">Net Take-Home Salary</div>
                      <div className="ap-hero-netpay-amount">
                        {formatCurrency(activeBreakdownPayslip.netPayable)}
                      </div>
                    </div>
                    <div className="ap-hero-netpay-badge">
                      {activeBreakdownPayslip.paymentStatus === "PAID" ? <IconCheck size={14} /> : <IconClock size={14} />}
                      <span>{activeBreakdownPayslip.paymentStatus === "PAID" ? "Disbursed" : activeBreakdownPayslip.status || "Finalized"}</span>
                    </div>
                  </div>

                  {/* Banking & Disbursal Footprint */}
                  <div className="ap-banking-footer">
                    <div>
                      <strong>Account:</strong>{" "}
                      {activeBreakdownPayslip.employeeSnapshot?.bankDetails?.accountNumber
                        ? `•••• ${activeBreakdownPayslip.employeeSnapshot.bankDetails.accountNumber.slice(-4)} (${activeBreakdownPayslip.employeeSnapshot.bankDetails.bankName || "Salary A/C"})`
                        : "Direct Bank Transfer on file"}
                    </div>
                    {activeBreakdownPayslip.payments?.[0]?.referenceNumber ? (
                      <div>
                        <strong>Transaction Ref (UTR):</strong> {activeBreakdownPayslip.payments[0].referenceNumber}
                      </div>
                    ) : (
                      <div>
                        <strong>Statement Reference:</strong> {activeBreakdownPayslip.payslipNumber || `PS-${selectedCycle?.periodYear || 2026}-${String(selectedCycle?.periodMonth || 10).padStart(2, "0")}`}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
                  <IconFileText size={40} style={{ color: "#d4d4d8", margin: "0 auto 12px" }} />
                  <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>Select an employee record</div>
                  <div>Choose an employee from the left register to inspect itemized allowances, deductions, and banking details.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW PAYROLL CYCLE MODAL */}
      {showNewCycleModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !cycleActionLoading && setShowNewCycleModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Initiate New Payroll Cycle
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowNewCycleModal(false)}
                disabled={cycleActionLoading}
              >
                <IconClose size={14} />
              </button>
            </div>

            <form onSubmit={handleCreateNewCycle} style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="newCycleMonthSelect" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Payroll Month <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    id="newCycleMonthSelect"
                    value={newCycleForm.periodMonth ?? newCycleForm.month}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setNewCycleForm((prev) => ({ ...prev, periodMonth: val, month: val }));
                    }}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                  >
                    {monthNamesList.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="newCycleYearSelect" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Payroll Year <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    id="newCycleYearSelect"
                    value={newCycleForm.periodYear ?? newCycleForm.year}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setNewCycleForm((prev) => ({ ...prev, periodYear: val, year: val }));
                    }}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                  >
                    {[2024, 2025, 2026, 2027, 2028].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="newCycleNotesInput" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Cycle Notes (Optional)
                </label>
                <textarea
                  id="newCycleNotesInput"
                  rows="2"
                  placeholder="e.g. Regular monthly disbursement..."
                  value={newCycleForm.notes}
                  onChange={(e) => setNewCycleForm({ ...newCycleForm, notes: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowNewCycleModal(false)}
                  disabled={cycleActionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={cycleActionLoading}
                >
                  {cycleActionLoading ? "Calculating..." : "Create & Calculate Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD CYCLE PAYMENT MODAL */}
      {showCyclePayModal && selectedCycle && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !cycleActionLoading && setShowCyclePayModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Record Payroll Disbursement
                </h3>
                <span style={{ fontSize: 12.5, color: "#71717a" }}>
                  {monthNamesList[selectedCycle.periodMonth - 1]} {selectedCycle.periodYear} · Net Payable: {formatCurrency(selectedCycle.totalNetPayable)}
                </span>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowCyclePayModal(false)}
                disabled={cycleActionLoading}
              >
                <IconClose size={14} />
              </button>
            </div>

            <form onSubmit={handleRecordCyclePaymentSubmit} style={{ display: "grid", gap: 14 }}>
              <div>
                <label htmlFor="cyclePayDateInput" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Payment / Disbursal Date <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="cyclePayDateInput"
                  type="date"
                  required
                  value={cyclePayForm.paymentDate}
                  onChange={(e) => setCyclePayForm({ ...cyclePayForm, paymentDate: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                />
              </div>

              <div>
                <label htmlFor="cyclePayMethodSelect" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Payment Method <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  id="cyclePayMethodSelect"
                  value={cyclePayForm.paymentMethod}
                  onChange={(e) => setCyclePayForm({ ...cyclePayForm, paymentMethod: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                >
                  <option value="NEFT_RTGS">Bank Transfer (NEFT/RTGS)</option>
                  <option value="BANK_TRANSFER">Direct Transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="UPI">UPI</option>
                  <option value="DIRECT_DEPOSIT">Direct Deposit</option>
                </select>
              </div>

              <div>
                <label htmlFor="cyclePayRefInput" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Transaction / Reference Number (UTR)
                </label>
                <input
                  id="cyclePayRefInput"
                  type="text"
                  placeholder="e.g. UTR20261023000987"
                  value={cyclePayForm.referenceNumber}
                  onChange={(e) => setCyclePayForm({ ...cyclePayForm, referenceNumber: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                />
              </div>

              <div>
                <label htmlFor="cyclePayAmountInput" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Total Amount Disbursed (INR) <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="cyclePayAmountInput"
                  type="number"
                  required
                  min="1"
                  value={cyclePayForm.amount}
                  onChange={(e) => setCyclePayForm({ ...cyclePayForm, amount: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                />
              </div>

              <div>
                <label htmlFor="cyclePayRemarksInput" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Disbursement Remarks
                </label>
                <textarea
                  id="cyclePayRemarksInput"
                  rows="2"
                  value={cyclePayForm.remarks}
                  onChange={(e) => setCyclePayForm({ ...cyclePayForm, remarks: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCyclePayModal(false)}
                  disabled={cycleActionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={cycleActionLoading}
                  style={{ background: "#15803d", borderColor: "#166534" }}
                >
                  {cycleActionLoading ? "Recording..." : "Confirm Disbursement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* RECORD PAYMENT MODAL */}
      {showPayModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingPay && setShowPayModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                Record Payment
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowPayModal(false)}
                disabled={submittingPay}
              >
                <IconClose size={14} />
              </button>
            </div>

            <form onSubmit={handleRecordPayment} style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Payment Date <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="date"
                  required
                  value={payForm.paymentDate}
                  onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Payment Method <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={payForm.paymentMethod}
                  onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                >
                  <option value="NEFT_RTGS">Bank Transfer (NEFT/RTGS)</option>
                  <option value="BANK_TRANSFER">Direct Transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="UPI">UPI</option>
                  <option value="DIRECT_DEPOSIT">Direct Deposit</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Reference Number (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR number or Cheque number"
                  value={payForm.referenceNumber}
                  onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Remarks (Optional)
                </label>
                <textarea
                  rows="2"
                  placeholder="Add payment notes..."
                  value={payForm.remarks}
                  onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPayModal(false)}
                  disabled={submittingPay}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submittingPay}
                >
                  {submittingPay ? "Saving..." : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PLACE ON HOLD MODAL */}
      {showHoldModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingHold && setShowHoldModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
              Place On Hold
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#71717a" }}>
              Enter the reason for pausing this settlement.
            </p>

            <form onSubmit={handleConfirmHold} style={{ display: "grid", gap: 14 }}>
              <div>
                <textarea
                  rows="3"
                  required
                  placeholder="Reason for hold..."
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13.5, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowHoldModal(false)}
                  disabled={submittingHold}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submittingHold || !holdReason.trim()}
                  style={{ background: "#d97706", borderColor: "#d97706" }}
                >
                  {submittingHold ? "Saving..." : "Place On Hold"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINTABLE FINAL SETTLEMENT STATEMENT MODAL */}
      {showStatementModal && activeSettlement && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 16,
          }}
          onClick={() => setShowStatementModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 32,
              width: "100%",
              maxWidth: 760,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => window.print()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                <span>Print Statement</span>
              </button>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowStatementModal(false)}
              >
                <IconClose size={16} />
              </button>
            </div>

            {/* Printable Statement Container */}
            <div
              id="fnf-printable-statement"
              style={{
                border: "1px solid #e4e4e7",
                borderRadius: 10,
                padding: "28px 32px",
                background: "#ffffff",
                color: "#09090b",
                fontFamily: "inherit",
              }}
            >
              {/* Company Letterhead */}
              <div style={{ borderBottom: "2px solid #18181b", paddingBottom: 16, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#09090b" }}>
                    {company?.companyName || "COMPANY HRMS"}
                  </h2>
                  <div style={{ fontSize: 12.5, color: "#52525b" }}>Human Resources & Payroll Division</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "#71717a" }}>
                  <div><strong>Settlement ID:</strong> {activeSettlement._id}</div>
                  <div><strong>Generated:</strong> {formatDate(new Date())}</div>
                  <div><strong>Status:</strong> {activeSettlement.status}</div>
                </div>
              </div>

              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 16, textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}>
                  Full & Final Settlement Statement
                </h3>
              </div>

              {/* Employee Summary Box */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "14px 18px", background: "#f9fafb", borderRadius: 8, border: "1px solid #f3f4f6", fontSize: 13, marginBottom: 20 }}>
                <div><strong>Employee Name:</strong> {activeSettlement.employeeId?.fullName}</div>
                <div><strong>Employee ID:</strong> {activeSettlement.employeeId?.employeeCode}</div>
                <div><strong>Designation:</strong> {activeSettlement.employeeId?.job?.jobTitle || "—"}</div>
                <div><strong>Department:</strong> {activeSettlement.employeeId?.job?.department || "—"}</div>
                <div><strong>Last Working Day:</strong> {formatDate(activeSettlement.exitDetails?.lastWorkingDay)}</div>
                <div><strong>Exit Reason:</strong> {activeSettlement.exitDetails?.exitReason}</div>
              </div>

              {/* Itemized Financials Table */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                {/* Earnings Table */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#166534", borderBottom: "1px solid #e4e4e7", paddingBottom: 6, marginBottom: 8 }}>
                    A. Earnings & Payable Allowances
                  </div>
                  {activeSettlement.financialBreakdown?.earnings?.map((e, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderBottom: "1px dashed #f4f4f5" }}>
                      <span>{e.title}</span>
                      <span style={{ fontWeight: 600 }}>{formatCurrency(e.amount)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 8, paddingTop: 6, borderTop: "1px solid #d4d4d8" }}>
                    <span>Total Earnings (A)</span>
                    <span style={{ color: "#166534" }}>{formatCurrency(activeSettlement.financialBreakdown?.totalEarnings)}</span>
                  </div>
                </div>

                {/* Deductions Table */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#b91c1c", borderBottom: "1px solid #e4e4e7", paddingBottom: 6, marginBottom: 8 }}>
                    B. Deductions & Recoveries
                  </div>
                  {(!activeSettlement.financialBreakdown?.deductions || activeSettlement.financialBreakdown.deductions.length === 0) ? (
                    <div style={{ fontSize: 12, color: "#71717a", fontStyle: "italic", padding: "6px 0" }}>No deductions applicable.</div>
                  ) : (
                    activeSettlement.financialBreakdown.deductions.map((d, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderBottom: "1px dashed #f4f4f5" }}>
                        <span>{d.title}</span>
                        <span style={{ fontWeight: 600, color: "#b91c1c" }}>-{formatCurrency(d.amount)}</span>
                      </div>
                    ))
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 8, paddingTop: 6, borderTop: "1px solid #d4d4d8" }}>
                    <span>Total Deductions (B)</span>
                    <span style={{ color: "#b91c1c" }}>{formatCurrency(activeSettlement.financialBreakdown?.totalDeductions)}</span>
                  </div>
                </div>
              </div>

              {/* Net Settlement Banner */}
              <div
                style={{
                  padding: "14px 18px",
                  background: "#18181b",
                  color: "#ffffff",
                  borderRadius: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", color: "#a1a1aa" }}>Net Settlement Payable (A − B)</div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{formatCurrency(activeSettlement.financialBreakdown?.netSettlementAmount)}</div>
                </div>
                {activeSettlement.paymentDetails?.paymentDate && (
                  <div style={{ textAlign: "right", fontSize: 12, color: "#e4e4e7" }}>
                    <div>Paid via {activeSettlement.paymentDetails.paymentMethod?.replace("_", " ")}</div>
                    <div>Ref: {activeSettlement.paymentDetails.referenceNumber || "Confirmed"}</div>
                  </div>
                )}
              </div>

              {/* Signature Block */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 40, paddingTop: 20, borderTop: "1px solid #e4e4e7", fontSize: 12, color: "#52525b" }}>
                <div>
                  <div style={{ borderBottom: "1px solid #a1a1aa", width: "70%", height: 32, marginBottom: 6 }} />
                  <div>Authorized Signatory</div>
                  <div>Human Resources & Finance</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ borderBottom: "1px solid #a1a1aa", width: "70%", height: 32, marginBottom: 6, marginLeft: "auto" }} />
                  <div>Employee Signature & Date</div>
                  <div>Full & Final Settlement Acceptance</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import {
  IconClose,
  IconCheck,
  IconDocument,
  IconSearch,
  IconUser,
  IconBriefcase,
  IconCurrency,
  IconScroll,
  IconChevronUp,
  IconChevronDown,
  IconClock,
  IconDownload,
} from "../components/Icons";
import api from "../services/api";

const STATUS_CONFIG = {
  DRAFT: {
    label: "Draft",
    bg: "#f4f4f5",
    color: "#52525b",
    border: "#e4e4e7",
  },
  SENT: {
    label: "Sent / Issued",
    bg: "#eff6ff",
    color: "#1d4ed8",
    border: "#bfdbfe",
  },
  ACCEPTED: {
    label: "Accepted",
    bg: "#f0fdf4",
    color: "#15803d",
    border: "#bbf7d0",
  },
  REJECTED: {
    label: "Rejected",
    bg: "#fef2f2",
    color: "#b91c1c",
    border: "#fecaca",
  },
};

const DEFAULT_CLAUSES_PRESET = [
  {
    clauseId: "probation",
    title: "1. Probation Period",
    body: "You will be on probation for an initial period of three (3) months from your date of joining. Upon satisfactory completion of the probation period, your employment will be confirmed in writing by the Company.",
    isRequired: false,
    order: 0,
    enabled: true,
  },
  {
    clauseId: "notice_period",
    title: "2. Notice Period & Separation",
    body: "During the probation period, either party may terminate this agreement by providing fifteen (15) calendar days of written notice. Following confirmation, the required notice period for voluntary resignation or termination shall be thirty (30) calendar days, or payment of gross salary in lieu thereof, subject to mutual management agreement.",
    isRequired: false,
    order: 1,
    enabled: true,
  },
  {
    clauseId: "working_hours",
    title: "3. Working Days & Working Hours",
    body: "Your regular working hours shall be Monday through Friday, 9:30 AM to 6:30 PM (or as scheduled by your department), including an allotted one-hour break. You may be expected to accommodate reasonable business requirements depending on project milestones and organizational exigencies.",
    isRequired: false,
    order: 2,
    enabled: true,
  },
  {
    clauseId: "compensation_terms",
    title: "4. Compensation & Statutory Deductions",
    body: "Your monthly compensation is subject to standard statutory deductions, including Provident Fund (PF), Professional Tax, and Income Tax deducted at source (TDS) as applicable under Indian taxation laws. Salary disbursements will be credited directly to your registered bank account on or before the last working day of each calendar month.",
    isRequired: false,
    order: 3,
    enabled: true,
  },
  {
    clauseId: "leave_policy",
    title: "5. Leave & Holiday Policy",
    body: "You will be entitled to annual leave allowances comprising Casual Leave, Sick Leave, and Earned Leave in accordance with the Company HR Leave Policy. Leave accruals, requests, and approvals must be logged through the official HRMS portal.",
    isRequired: false,
    order: 4,
    enabled: true,
  },
  {
    clauseId: "confidentiality",
    title: "6. Non-Disclosure & Confidentiality",
    body: "You agree that throughout your tenure and thereafter, you shall keep strictly confidential and not disclose, reproduce, or disseminate any proprietary data, intellectual assets, customer records, technical source code, or internal business operations of the Company to any third party without explicit prior written authorization.",
    isRequired: false,
    order: 5,
    enabled: true,
  },
  {
    clauseId: "ip_ownership",
    title: "7. Intellectual Property & Work Product Ownership",
    body: "All intellectual property, inventions, works of authorship, source code, designs, and innovations developed or created by you during your employment, whether individually or jointly, shall belong exclusively to and remain the sole property of the Company.",
    isRequired: false,
    order: 6,
    enabled: true,
  },
  {
    clauseId: "asset_return",
    title: "8. Company Property & Asset Return",
    body: "All equipment, laptops, digital credentials, documents, and company materials entrusted to your care remain company property and must be maintained responsibly and surrendered immediately upon separation or upon request by management.",
    isRequired: false,
    order: 7,
    enabled: true,
  },
  {
    clauseId: "background_verification",
    title: "9. Background Verification & Document Authenticity",
    body: "This offer of employment is contingent upon the successful completion of comprehensive background checks, credential verifications, and submission of authentic educational certificates, previous employment release letters, and identity proof.",
    isRequired: false,
    order: 8,
    enabled: true,
  },
  {
    clauseId: "code_of_conduct",
    title: "10. Code of Conduct & Workplace Ethics",
    body: "You agree to conduct yourself with integrity, professionalism, and adherence to company policies, anti-harassment standards, data protection rules, and statutory regulations governing workplace conduct.",
    isRequired: false,
    order: 9,
    enabled: true,
  },
  {
    clauseId: "joining_instructions",
    title: "11. Joining Formalities & Reporting",
    body: "Please report to the assigned work location or virtual onboarding briefing on your scheduled Date of Joining at 9:30 AM. Kindly present your original identity documentation, academic transcripts, and previous employment service certificates to the HR department.",
    isRequired: false,
    order: 10,
    enabled: true,
  },
  {
    clauseId: "acceptance_instructions",
    title: "12. Offer Validity & Acceptance Instructions",
    body: "This offer remains valid for seven (7) business days from the date of issuance. Please sign and return the duplicate copy of this letter or provide written acceptance via authorized correspondence to confirm your commitment.",
    isRequired: false,
    order: 11,
    enabled: true,
  },
];

export default function OfferLettersManagement() {
  const navigate = useNavigate();

  // Data states
  const [offers, setOffers] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Filters & Search
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalOffers: 0,
    totalPages: 1,
  });

  // Action states
  const [downloadingId, setDownloadingId] = useState(null);
  const [sendingOfferId, setSendingOfferId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'DELETE' | 'SEND_EMAIL', offer: obj, notes: '' }
  const [modalError, setModalError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // View / Preview Modal state
  const [previewModalOffer, setPreviewModalOffer] = useState(null);
  const [previewModalLoading, setPreviewModalLoading] = useState(false);

  // Create / Edit Form Modal state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editorMode, setEditorMode] = useState("create"); // 'create' | 'edit'
  const [editingOfferId, setEditingOfferId] = useState(null);
  const [editorTab, setEditorTab] = useState("split"); // 'form' | 'preview' | 'split'
  const [savingOffer, setSavingOffer] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Recipient directory state
  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [selectedRecipientId, setSelectedRecipientId] = useState("");

  // Request sequencing refs to prevent out-of-order responses overwriting newer data
  const previewRequestIdRef = useRef(0);
  const fetchOffersRequestIdRef = useRef(0);

  // Editor Form Fields
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    position: "",
    department: "",
    employmentType: "Full-time",
    workLocation: "",
    joiningDate: "",
    reportingManager: "",
    monthlySalary: "",
    clauses: DEFAULT_CLAUSES_PRESET,
  });

  // Live preview HTML state
  const [livePreviewHtml, setLivePreviewHtml] = useState("");

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load recipient directory
  const fetchRecipients = async () => {
    try {
      setLoadingRecipients(true);
      const res = await api.get("/offer-letters/recipients");
      if (res.data?.success) {
        setRecipients(res.data.recipients || []);
      }
    } catch (err) {
      console.warn("[OfferLetters] Could not load recipients list:", err.message);
    } finally {
      setLoadingRecipients(false);
    }
  };

  // Load summary KPI counters
  const fetchSummary = async () => {
    try {
      const res = await api.get("/offer-letters/summary");
      if (res.data?.success) {
        setSummary(res.data.summary);
      }
    } catch {
      // Graceful fallback
    }
  };

  // Fetch recipients and summary on mount
  useEffect(() => {
    fetchRecipients();
    fetchSummary();
  }, []);

  // Load offer letters with request sequence guarding
  const fetchOffers = async () => {
    const requestId = ++fetchOffersRequestIdRef.current;
    try {
      setLoading(true);
      setError("");

      const queryParams = new URLSearchParams({
        page: String(currentPage),
        limit: "10",
      });

      if (debouncedSearch.trim()) {
        queryParams.set("search", debouncedSearch.trim());
      }
      if (statusFilter !== "ALL") {
        queryParams.set("status", statusFilter);
      }

      const listRes = await api.get(`/offer-letters?${queryParams.toString()}`);

      if (requestId === fetchOffersRequestIdRef.current && listRes.data?.success) {
        setOffers(listRes.data.offerLetters || []);
        if (listRes.data.pagination) {
          setPagination(listRes.data.pagination);
        }
      }
    } catch (err) {
      if (requestId === fetchOffersRequestIdRef.current) {
        setError(err.response?.data?.message || "Failed to load offer letters.");
      }
    } finally {
      if (requestId === fetchOffersRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchOffers();
  }, [currentPage, debouncedSearch, statusFilter]);

  // Compute live preview HTML safely using sequence tracking
  useEffect(() => {
    if (!showEditorModal) return;

    const timer = setTimeout(async () => {
      const requestId = ++previewRequestIdRef.current;
      try {
        const payload = {
          candidate: {
            fullName: formData.fullName,
            email: formData.email,
          },
          position: formData.position,
          department: formData.department,
          employmentType: formData.employmentType,
          workLocation: formData.workLocation,
          joiningDate: formData.joiningDate,
          reportingManager: formData.reportingManager,
          monthlySalary: parseFloat(formData.monthlySalary) || 0,
          clauses: formData.clauses.map((c, i) => ({
            ...c,
            isIncluded: c.enabled !== false && c.isIncluded !== false,
            enabled: c.enabled !== false && c.isIncluded !== false,
            order: typeof c.order === "number" ? c.order : i,
          })),
        };

        const res = await api.post("/offer-letters/preview", payload);
        if (requestId === previewRequestIdRef.current && res.data?.success && res.data.html) {
          setLivePreviewHtml(res.data.html);
        }
      } catch {
        // Fallback: don't crash preview on transient incomplete inputs
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [
    formData.fullName,
    formData.email,
    formData.position,
    formData.department,
    formData.employmentType,
    formData.workLocation,
    formData.joiningDate,
    formData.reportingManager,
    formData.monthlySalary,
    formData.clauses,
    showEditorModal,
  ]);

  // Annualized salary calculation
  const annualizedSalary = useMemo(() => {
    const monthly = parseFloat(formData.monthlySalary);
    if (isNaN(monthly) || monthly <= 0) return 0;
    return monthly * 12;
  }, [formData.monthlySalary]);

  // Currency Formatter
  const formatINR = (val) => {
    if (val == null || isNaN(val)) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Date Formatter
  const formatDate = (dateString) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Handle Recipient Dropdown Selection
  const handleRecipientSelect = (eOrValue) => {
    const empId = (eOrValue && typeof eOrValue === "object" && "target" in eOrValue)
      ? eOrValue.target?.value
      : (typeof eOrValue === "string" ? eOrValue : "");

    setSelectedRecipientId(empId || "");
    if (!empId) {
      // Prospective candidate selected: clear employee reference and allow manual entry
      return;
    }

    const emp = recipients.find((r) => String(r._id) === String(empId));
    if (emp) {
      setFormData((prev) => ({
        ...prev,
        fullName: emp.fullName || "",
        email: emp.email || "",
        position: emp.position || "",
        department: emp.department || "",
        workLocation: emp.workLocation || "",
        employmentType: emp.employmentType || "Full-time",
        reportingManager: emp.reportingManager || "",
        monthlySalary: emp.monthlySalary != null && emp.monthlySalary !== "" ? String(emp.monthlySalary) : prev.monthlySalary,
        joiningDate: emp.joiningDate
          ? new Date(emp.joiningDate).toISOString().slice(0, 10)
          : prev.joiningDate,
      }));
      setFormErrors({});
    }
  };

  // Handle Opening Create Modal
  const handleOpenCreate = () => {
    setEditorMode("create");
    setEditingOfferId(null);
    setSelectedRecipientId("");
    setFormErrors({});
    setFormData({
      fullName: "",
      email: "",
      position: "",
      department: "",
      employmentType: "Full-time",
      workLocation: "",
      joiningDate: "",
      reportingManager: "",
      monthlySalary: "",
      clauses: JSON.parse(JSON.stringify(DEFAULT_CLAUSES_PRESET)),
    });
    setLivePreviewHtml("");
    setShowEditorModal(true);
    fetchRecipients();
  };

  // Handle Opening Edit Modal (DRAFT only)
  const handleOpenEdit = async (offer) => {
    if (offer.status !== "DRAFT") {
      setError("Only DRAFT offers can be edited.");
      return;
    }
    setEditorMode("edit");
    setEditingOfferId(offer._id);
    setSelectedRecipientId(offer.employeeId?._id || offer.employeeId || "");
    setFormErrors({});

    try {
      const res = await api.get(`/offer-letters/${offer._id}`);
      const freshOffer = res.data?.offerLetter || offer;

      setSelectedRecipientId(freshOffer.employeeId?._id || freshOffer.employeeId || "");
      setFormData({
        fullName: freshOffer.candidate?.fullName || "",
        email: freshOffer.candidate?.email || "",
        position: freshOffer.position || "",
        department: freshOffer.department || "",
        employmentType: freshOffer.employmentType || "Full-time",
        workLocation: freshOffer.workLocation || "",
        joiningDate: freshOffer.joiningDate
          ? new Date(freshOffer.joiningDate).toISOString().slice(0, 10)
          : "",
        reportingManager: freshOffer.reportingManager || "",
        monthlySalary: freshOffer.monthlySalary ? String(freshOffer.monthlySalary) : "",
        clauses: freshOffer.clauses && freshOffer.clauses.length > 0
          ? freshOffer.clauses.map((c, idx) => ({
              ...c,
              enabled: c.isIncluded !== false && c.enabled !== false,
              isIncluded: c.isIncluded !== false && c.enabled !== false,
              order: typeof c.order === "number" ? c.order : idx,
            }))
          : JSON.parse(JSON.stringify(DEFAULT_CLAUSES_PRESET)),
      });
      setShowEditorModal(true);
      fetchRecipients();
    } catch {
      setError("Failed to fetch offer details for editing.");
    }
  };

  // Clause manipulation helpers
  const handleToggleClause = (index) => {
    const updated = [...formData.clauses];
    const newEnabled = !updated[index].enabled;
    updated[index].enabled = newEnabled;
    updated[index].isIncluded = newEnabled;
    setFormData({ ...formData, clauses: updated });
  };

  const handleClauseChange = (index, field, value) => {
    const updated = [...formData.clauses];
    updated[index][field] = value;
    setFormData({ ...formData, clauses: updated });
  };

  const handleMoveClause = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= formData.clauses.length) return;

    const updated = [...formData.clauses];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    // Re-index orders
    updated.forEach((c, idx) => {
      c.order = idx;
    });

    setFormData({ ...formData, clauses: updated });
  };

  const handleAddCustomClause = () => {
    const newClause = {
      clauseId: `custom_${Date.now()}`,
      title: `${formData.clauses.length + 1}. Additional Special Terms`,
      body: "Enter the custom terms and obligations agreed upon between the Company and the Candidate.",
      isRequired: false,
      order: formData.clauses.length,
      enabled: true,
      isIncluded: true,
      isCustom: true,
    };
    setFormData({
      ...formData,
      clauses: [...formData.clauses, newClause],
    });
  };

  const handleResetClauses = () => {
    if (window.confirm("Reset all clauses back to the default library standard?")) {
      setFormData({
        ...formData,
        clauses: JSON.parse(JSON.stringify(DEFAULT_CLAUSES_PRESET)),
      });
    }
  };

  // Form Validation
  const validateForm = () => {
    const errors = {};
    if (!formData.fullName.trim()) {
      errors.fullName = "Candidate full name is required.";
    }
    if (!formData.email.trim()) {
      errors.email = "Candidate email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = "Please enter a valid email address.";
    }
    if (!formData.position.trim()) {
      errors.position = "Job position/title is required.";
    }
    if (!formData.joiningDate) {
      errors.joiningDate = "Joining date is required.";
    }
    const numSalary = parseFloat(formData.monthlySalary);
    if (!formData.monthlySalary || isNaN(numSalary) || numSalary <= 0) {
      errors.monthlySalary = "Monthly salary must be a valid positive amount.";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save Offer: Draft, Download, or Send
  const handleSaveOffer = async (mode = "draft") => {
    if (!validateForm()) return;

    setSavingOffer(true);
    setError("");

    try {
      const payload = {
        employeeId: selectedRecipientId || null,
        candidate: {
          fullName: formData.fullName.trim(),
          email: formData.email.trim().toLowerCase(),
        },
        position: formData.position.trim(),
        department: formData.department.trim(),
        employmentType: formData.employmentType,
        workLocation: formData.workLocation.trim(),
        joiningDate: formData.joiningDate,
        reportingManager: formData.reportingManager.trim(),
        monthlySalary: parseFloat(formData.monthlySalary),
        clauses: formData.clauses.map((c, i) => ({
          ...c,
          isIncluded: c.enabled !== false && c.isIncluded !== false,
          enabled: c.enabled !== false && c.isIncluded !== false,
          order: typeof c.order === "number" ? c.order : i,
        })),
      };

      let savedOffer;
      if (editorMode === "create") {
        const res = await api.post("/offer-letters", payload);
        savedOffer = res.data?.offerLetter;
      } else {
        const res = await api.put(`/offer-letters/${editingOfferId}`, payload);
        savedOffer = res.data?.offerLetter;
      }

      if (mode === "send" && savedOffer?._id) {
        try {
          const sendRes = await api.post(`/offer-letters/${savedOffer._id}/send`);
          setSuccessMsg(sendRes.data?.message || `Offer letter sent to ${savedOffer.candidate?.email}.`);
        } catch (sendErr) {
          const sendErrMsg = sendErr.response?.data?.message || "Offer saved as draft, but email delivery failed.";
          setError(sendErrMsg);
        }
      } else if (mode === "download" && savedOffer?._id) {
        setSuccessMsg(editorMode === "create" ? "Offer letter created." : "Offer letter updated.");
        await handleDownloadPdf(savedOffer._id, savedOffer.candidate?.fullName);
      } else {
        setSuccessMsg(editorMode === "create" ? "Offer letter draft created." : "Offer letter draft updated.");
      }

      setShowEditorModal(false);
      await Promise.all([fetchOffers(), fetchSummary()]);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err) {
      const msg = err.response?.data?.message || "Couldn't save offer letter. Please try again.";
      const backendErrors = err.response?.data?.errors || {};
      setError(msg);
      if (Object.keys(backendErrors).length > 0) {
        setFormErrors(backendErrors);
      }
    } finally {
      setSavingOffer(false);
    }
  };

  // Download PDF Action
  const handleDownloadPdf = async (offerId, candidateName) => {
    try {
      setDownloadingId(offerId);
      const response = await api.get(`/offer-letters/${offerId}/pdf`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = (candidateName || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.href = downloadUrl;
      link.download = `Offer_Letter_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccessMsg("Offer letter downloaded.");
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch {
      setError("Couldn't download offer letter. Please try again.");
      setTimeout(() => setError(""), 5000);
    } finally {
      setDownloadingId(null);
    }
  };

  // Open Full Preview Modal
  const handleViewPreview = async (offer) => {
    try {
      setPreviewModalLoading(true);
      setPreviewModalOffer(offer);

      const res = await api.get(`/offer-letters/${offer._id}`);
      if (res.data?.offerLetter) {
        setPreviewModalOffer(res.data.offerLetter);
      }
    } catch {
      setError("Couldn't load preview. Please try again.");
    } finally {
      setPreviewModalLoading(false);
    }
  };

  // Status Transition Executer
  const handleExecuteStatusChange = async () => {
    if (!confirmModal) return;

    setActionLoading(true);
    setModalError("");
    try {
      const { type, offer, notes } = confirmModal;

      if (type === "DELETE") {
        await api.delete(`/offer-letters/${offer._id}`);
        setSuccessMsg("Draft offer letter deleted successfully.");
      } else if (type === "SEND_EMAIL") {
        setSendingOfferId(offer._id);
        const sendRes = await api.post(`/offer-letters/${offer._id}/send`);
        setSuccessMsg(sendRes.data?.message || `Offer letter sent to ${offer.candidate?.email}.`);
      } else {
        await api.patch(`/offer-letters/${offer._id}/status`, {
          status: type,
          notes,
        });
        const statusVerb = type === "SENT" ? "marked as Sent / Issued" : type === "ACCEPTED" ? "recorded as Accepted" : "recorded as Rejected";
        setSuccessMsg(`Offer letter successfully ${statusVerb}!`);
      }

      setConfirmModal(null);
      setModalError("");
      if (previewModalOffer && previewModalOffer._id === confirmModal.offer._id) {
        setPreviewModalOffer(null);
      }
      await Promise.all([fetchOffers(), fetchSummary()]);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err) {
      const errText = err.response?.data?.message || err.message || "Failed to update offer letter status.";
      setModalError(errText);
      setError(errText);
      setTimeout(() => setError(""), 8000);
    } finally {
      setActionLoading(false);
      setSendingOfferId(null);
    }
  };

  return (
    <main className="container-wide" style={{ maxWidth: "1320px", padding: "28px" }}>
      <AppHeader title="Offer Letter Management" />

      {/* Top Banner Alert / Messages */}
      {error && (
        <div style={{
          marginBottom: "16px",
          padding: "12px 16px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          color: "#991b1b",
          fontSize: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            style={{ background: "none", border: "none", color: "#991b1b", padding: "0 4px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
            aria-label="Dismiss error"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {successMsg && (
        <div style={{
          marginBottom: "16px",
          padding: "12px 16px",
          background: "#ecfdf5",
          border: "1px solid #a7f3d0",
          borderRadius: "8px",
          color: "#065f46",
          fontSize: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            style={{ background: "none", border: "none", color: "#065f46", padding: "0 4px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
            aria-label="Dismiss message"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="stats-grid" style={{ marginBottom: "28px" }}>
        <div className="stat-card">
          <span className="stat-label">Total</span>
          <span className="stat-value">{summary.total}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Draft</span>
          <span className="stat-value" style={{ color: "#71717a" }}>{summary.draft}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Sent</span>
          <span className="stat-value" style={{ color: "#2563eb" }}>{summary.sent}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Accepted</span>
          <span className="stat-value" style={{ color: "#059669" }}>{summary.accepted}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Rejected</span>
          <span className="stat-value" style={{ color: "#dc2626" }}>{summary.rejected}</span>
        </div>
      </div>

      {/* Control Bar: Search, Filter, and Create Button */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "14px",
        marginBottom: "20px",
        background: "#ffffff",
        padding: "16px 20px",
        borderRadius: "12px",
        border: "1px solid #e4e4e7",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flex: 1 }}>
          <div style={{ position: "relative", minWidth: "260px" }}>
            <input
              type="text"
              placeholder="Search candidate name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 34px",
                borderRadius: "8px",
                border: "1px solid #d4d4d8",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#a1a1aa", display: "flex", alignItems: "center" }}>
              <IconSearch size={14} />
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "#71717a", fontWeight: "500" }}>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #d4d4d8",
                fontSize: "14px",
                background: "#ffffff",
                color: "#18181b",
                cursor: "pointer",
              }}
            >
              <option value="ALL">All ({summary.total})</option>
              <option value="DRAFT">Draft ({summary.draft})</option>
              <option value="SENT">Sent ({summary.sent})</option>
              <option value="ACCEPTED">Accepted ({summary.accepted})</option>
              <option value="REJECTED">Rejected ({summary.rejected})</option>
            </select>
          </div>

          {(search || statusFilter !== "ALL") && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
                setCurrentPage(1);
              }}
              style={{ padding: "7px 12px", fontSize: "13px" }}
            >
              Clear Filters
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          style={{
            background: "#09090b",
            color: "#ffffff",
            padding: "9px 18px",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "500",
            border: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
          }}
        >
          <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span> New Offer Letter
        </button>
      </div>

      {/* Offers Table */}
      <div style={{
        background: "#ffffff",
        borderRadius: "12px",
        border: "1px solid #e4e4e7",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      }}>
        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#71717a" }}>
            <div style={{ fontSize: "14px" }}>Loading offers...</div>
          </div>
        ) : offers.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center" }}>
            <div style={{ marginBottom: "12px", color: "#a1a1aa" }}>
              <IconDocument size={40} />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: "16px", color: "#18181b" }}>No offers found</h3>
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#71717a" }}>
              {search || statusFilter !== "ALL"
                ? "No offers match your search or filter."
                : "Create your first offer letter to get started."}
            </p>
            {search || statusFilter !== "ALL" ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                }}
              >
                Reset Filters
              </button>
            ) : (
              <button type="button" onClick={handleOpenCreate}>
                + New Offer Letter
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Candidate</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Job & Dept</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Start Date</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Salary</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase" }}>Created</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "600", fontSize: "12px", textTransform: "uppercase", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => {
                  const statusStyle = STATUS_CONFIG[offer.status] || STATUS_CONFIG.DRAFT;
                  const isDraft = offer.status === "DRAFT";
                  const isSent = offer.status === "SENT";
                  const isAccepted = offer.status === "ACCEPTED";
                  const isLinked = Boolean(offer.employeeId);

                  return (
                    <tr
                      key={offer._id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fcfcfc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                    >
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: "600", color: "#09090b" }}>{offer.candidate?.fullName || "—"}</div>
                        <div style={{ fontSize: "12px", color: "#71717a" }}>{offer.candidate?.email || "—"}</div>
                        {offer.employee && (
                          <div style={{ marginTop: "4px" }}>
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: "600",
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              border: "1px solid #bfdbfe",
                            }}>
                              Emp: {offer.employee.employeeCode || offer.employee.fullName}
                            </span>
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ color: "#18181b", fontWeight: "500" }}>{offer.position || "—"}</div>
                        <div style={{ fontSize: "12px", color: "#71717a" }}>{offer.department || offer.employmentType || "General"}</div>
                      </td>

                      <td style={{ padding: "14px 16px", color: "#3f3f46" }}>
                        {formatDate(offer.joiningDate)}
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: "600", color: "#09090b" }}>{formatINR(offer.monthlySalary)} / mo</div>
                        <div style={{ fontSize: "11px", color: "#71717a" }}>
                          Annualized: {formatINR(offer.monthlySalary * 12)}
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <StatusBadge
                          status={offer.status}
                          label={statusStyle.label}
                        />
                        {offer.emailDelivery?.status === "DELIVERY_FAILED" && (
                          <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "4px", fontWeight: "600" }} title={offer.emailDelivery?.error || "Delivery failed"}>
                            Delivery Failed
                          </div>
                        )}
                        {offer.emailedAt && (
                          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                            Emailed {formatDate(offer.emailedAt)}
                          </div>
                        )}
                        {isAccepted && isLinked && (
                          <div style={{ fontSize: "11px", color: "#15803d", marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                            <IconCheck size={12} />
                            <span>Onboarded</span>
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "14px 16px", fontSize: "12px", color: "#71717a" }}>
                        {formatDate(offer.createdAt)}
                      </td>

                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {/* View Preview Button */}
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleViewPreview(offer)}
                            style={{ padding: "5px 10px", fontSize: "12px" }}
                            title="View Preview"
                          >
                            Preview
                          </button>

                          {/* Download PDF Button */}
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleDownloadPdf(offer._id, offer.candidate?.fullName)}
                            disabled={downloadingId === offer._id}
                            style={{ padding: "5px 10px", fontSize: "12px" }}
                            title="Download PDF"
                          >
                            {downloadingId === offer._id ? "Generating..." : "PDF"}
                          </button>

                          {/* DRAFT Actions */}
                          {isDraft && (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ type: "SEND_EMAIL", offer, notes: "" })}
                                disabled={sendingOfferId === offer._id}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: "12px",
                                  background: "#2563eb",
                                  borderColor: "#2563eb",
                                  color: "#ffffff",
                                  fontWeight: "600",
                                }}
                                title="Send official offer letter email with attached PDF to candidate"
                              >
                                {sendingOfferId === offer._id ? "Sending..." : "Send Email"}
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleOpenEdit(offer)}
                                style={{ padding: "5px 10px", fontSize: "12px" }}
                                title="Edit Draft"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setConfirmModal({ type: "SENT", offer, notes: "" })}
                                style={{
                                  padding: "5px 8px",
                                  fontSize: "12px",
                                }}
                                title="Mark as Issued / Sent without emailing"
                              >
                                Mark Sent
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ type: "DELETE", offer, notes: "" })}
                                style={{
                                  padding: "5px 8px",
                                  fontSize: "12px",
                                  background: "#ffffff",
                                  borderColor: "#fca5a5",
                                  color: "#dc2626",
                                }}
                                title="Delete Draft"
                              >
                                Delete
                              </button>
                            </>
                          )}

                          {/* SENT Actions */}
                          {isSent && (
                            <>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setConfirmModal({ type: "SEND_EMAIL", offer, notes: "" })}
                                disabled={sendingOfferId === offer._id}
                                style={{ padding: "5px 10px", fontSize: "12px" }}
                                title="Resend official offer letter email with attached PDF"
                              >
                                {sendingOfferId === offer._id ? "Sending..." : "Resend"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ type: "ACCEPTED", offer, notes: "" })}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: "12px",
                                  background: "#059669",
                                  borderColor: "#059669",
                                  color: "#ffffff",
                                }}
                                title="Record Candidate Acceptance"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmModal({ type: "REJECTED", offer, notes: "" })}
                                style={{
                                  padding: "5px 10px",
                                  fontSize: "12px",
                                  background: "#dc2626",
                                  borderColor: "#dc2626",
                                  color: "#ffffff",
                                }}
                                title="Record Candidate Rejection"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {/* ACCEPTED Action: Onboard as Employee */}
                          {isAccepted && !isLinked && (
                            <button
                              type="button"
                              onClick={() => navigate(`/admin?onboardOfferId=${offer._id}`)}
                              style={{
                                padding: "5px 10px",
                                fontSize: "12px",
                                background: "#09090b",
                                borderColor: "#09090b",
                                color: "#ffffff",
                              }}
                              title="Onboard candidate using standard HRMS workflow"
                            >
                              Onboard
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {pagination.totalPages > 1 && (
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 20px",
            borderTop: "1px solid #e4e4e7",
            background: "#fcfcfc",
            fontSize: "13px",
            color: "#71717a",
          }}>
            <div>
              Showing {((currentPage - 1) * pagination.limit) + 1} to {Math.min(currentPage * pagination.limit, pagination.totalOffers)} of {pagination.totalOffers} offers
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: "4px 10px", fontSize: "12px" }}
              >
                Previous
              </button>
              <span style={{ display: "flex", alignItems: "center", padding: "0 6px", fontWeight: "600", color: "#18181b" }}>
                {currentPage} / {pagination.totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={currentPage >= pagination.totalPages}
                onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                style={{ padding: "4px 10px", fontSize: "12px" }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* CREATE / EDIT OFFER LETTER MODAL (SPLIT SCREEN) */}
      {showEditorModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.65)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000,
          padding: "20px",
          backdropFilter: "blur(2px)",
        }}>
          <div style={{
            background: "#f4f4f5",
            width: "100%",
            maxWidth: "1400px",
            height: "92vh",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            border: "1px solid #e4e4e7",
          }}>
            {/* Modal Header */}
            <div style={{
              padding: "16px 24px",
              background: "#ffffff",
              borderBottom: "1px solid #e4e4e7",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#09090b" }}>
                  {editorMode === "create" ? "New Offer Letter" : "Edit Offer Letter"}
                </h2>
              </div>

              {/* View Toggle on smaller displays */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ display: "inline-flex", background: "#f4f4f5", padding: "3px", borderRadius: "8px", border: "1px solid #e4e4e7" }}>
                  <button
                    type="button"
                    onClick={() => setEditorTab("form")}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      background: editorTab === "form" ? "#ffffff" : "transparent",
                      color: editorTab === "form" ? "#09090b" : "#71717a",
                      border: "none",
                      boxShadow: editorTab === "form" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    }}
                  >
                    Form
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorTab("split")}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      background: editorTab === "split" ? "#ffffff" : "transparent",
                      color: editorTab === "split" ? "#09090b" : "#71717a",
                      border: "none",
                      boxShadow: editorTab === "split" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    }}
                  >
                    Split
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorTab("preview")}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      background: editorTab === "preview" ? "#ffffff" : "transparent",
                      color: editorTab === "preview" ? "#09090b" : "#71717a",
                      border: "none",
                      boxShadow: editorTab === "preview" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    }}
                  >
                    Preview
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#71717a",
                    cursor: "pointer",
                    padding: "4px 8px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  aria-label="Close modal"
                >
                  <IconClose size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body: Split Panels */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Left Panel: Form & Clause Editor */}
              {(editorTab === "form" || editorTab === "split") && (
                <div style={{
                  flex: editorTab === "split" ? 1 : 1,
                  maxWidth: editorTab === "split" ? "52%" : "100%",
                  overflowY: "auto",
                  padding: "24px",
                  background: "#ffffff",
                  borderRight: editorTab === "split" ? "1px solid #e4e4e7" : "none",
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* Recipient Source Selection */}
                    <div style={{
                      background: "#f0fdf4",
                      padding: "14px 16px",
                      borderRadius: "8px",
                      border: "1px solid #bbf7d0",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <label style={{ fontSize: "13px", fontWeight: "600", color: "#166534", display: "flex", alignItems: "center", gap: "6px" }}>
                          <IconUser size={15} /> Select Recipient
                        </label>
                        {loadingRecipients && <span style={{ fontSize: "11px", color: "#16a34a" }}>Loading...</span>}
                      </div>
                      <select
                        value={selectedRecipientId}
                        onChange={handleRecipientSelect}
                        disabled={editorMode === "edit"}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid #86efac",
                          background: editorMode === "edit" ? "#f4f4f5" : "#ffffff",
                          fontSize: "13px",
                          fontWeight: "500",
                          color: "#14532d",
                          cursor: editorMode === "edit" ? "not-allowed" : "pointer",
                        }}
                      >
                        <option value="">New Candidate (Manual Entry)</option>
                        {recipients.map((emp) => (
                          <option key={emp._id} value={emp._id}>
                            {emp.fullName} - {emp.employeeCode} ({emp.position || "Staff"})
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: "11px", color: "#15803d", marginTop: "5px" }}>
                        {selectedRecipientId
                          ? "Details loaded from employee directory."
                          : "Enter candidate details below."}
                      </div>
                    </div>

                    {/* Candidate Information Section */}
                    <div style={{ background: "#fbfbfc", padding: "16px", borderRadius: "8px", border: "1px solid #ebecee" }}>
                      <h4 style={{ margin: "0 0 12px", fontSize: "13.5px", fontWeight: "600", color: "#18181b", display: "flex", alignItems: "center", gap: "6px" }}>
                        <IconUser size={15} /> Candidate Details
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Full Name *
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Maya Rao"
                            value={formData.fullName}
                            onChange={(e) => {
                              setFormData({ ...formData, fullName: e.target.value });
                              if (formErrors.fullName) setFormErrors({ ...formErrors, fullName: "" });
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: `1px solid ${formErrors.fullName ? "#ef4444" : "#d4d4d8"}`,
                              fontSize: "13.5px",
                            }}
                          />
                          {formErrors.fullName && <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{formErrors.fullName}</div>}
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Email *
                          </label>
                          <input
                            type="email"
                            placeholder="e.g. maya.rao@example.com"
                            value={formData.email}
                            onChange={(e) => {
                              setFormData({ ...formData, email: e.target.value });
                              if (formErrors.email) setFormErrors({ ...formErrors, email: "" });
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: `1px solid ${formErrors.email ? "#ef4444" : "#d4d4d8"}`,
                              fontSize: "13.5px",
                            }}
                          />
                          {formErrors.email && <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{formErrors.email}</div>}
                        </div>
                      </div>
                    </div>

                    {/* Employment Terms Section */}
                    <div style={{ background: "#fbfbfc", padding: "16px", borderRadius: "8px", border: "1px solid #ebecee" }}>
                      <h4 style={{ margin: "0 0 12px", fontSize: "13.5px", fontWeight: "600", color: "#18181b", display: "flex", alignItems: "center", gap: "6px" }}>
                        <IconBriefcase size={15} /> Job & Terms
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Job Title *
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Senior Software Engineer"
                            value={formData.position}
                            onChange={(e) => {
                              setFormData({ ...formData, position: e.target.value });
                              if (formErrors.position) setFormErrors({ ...formErrors, position: "" });
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: `1px solid ${formErrors.position ? "#ef4444" : "#d4d4d8"}`,
                              fontSize: "13.5px",
                            }}
                          />
                          {formErrors.position && <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{formErrors.position}</div>}
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Department
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Engineering"
                            value={formData.department}
                            onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: "1px solid #d4d4d8",
                              fontSize: "13.5px",
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Employment Type
                          </label>
                          <select
                            value={formData.employmentType}
                            onChange={(e) => setFormData({ ...formData, employmentType: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: "1px solid #d4d4d8",
                              fontSize: "13.5px",
                              background: "#ffffff",
                            }}
                          >
                            <option value="Full-time">Full-time</option>
                            <option value="Part-time">Part-time</option>
                            <option value="Contract">Contract</option>
                            <option value="Internship">Internship</option>
                          </select>
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Start Date *
                          </label>
                          <input
                            type="date"
                            value={formData.joiningDate}
                            onChange={(e) => {
                              setFormData({ ...formData, joiningDate: e.target.value });
                              if (formErrors.joiningDate) setFormErrors({ ...formErrors, joiningDate: "" });
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: `1px solid ${formErrors.joiningDate ? "#ef4444" : "#d4d4d8"}`,
                              fontSize: "13.5px",
                            }}
                          />
                          {formErrors.joiningDate && <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{formErrors.joiningDate}</div>}
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Location
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Bengaluru / Remote"
                            value={formData.workLocation}
                            onChange={(e) => setFormData({ ...formData, workLocation: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: "1px solid #d4d4d8",
                              fontSize: "13.5px",
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Reporting Manager
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Engineering Director"
                            value={formData.reportingManager}
                            onChange={(e) => setFormData({ ...formData, reportingManager: e.target.value })}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: "1px solid #d4d4d8",
                              fontSize: "13.5px",
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Compensation Section */}
                    <div style={{ background: "#fbfbfc", padding: "16px", borderRadius: "8px", border: "1px solid #ebecee" }}>
                      <h4 style={{ margin: "0 0 12px", fontSize: "13.5px", fontWeight: "600", color: "#18181b", display: "flex", alignItems: "center", gap: "6px" }}>
                        <IconCurrency size={15} /> Compensation
                      </h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "14px", alignItems: "flex-start" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "13px", fontWeight: "500", marginBottom: "4px", color: "#27272a" }}>
                            Monthly Salary (₹) *
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="e.g. 75000"
                            value={formData.monthlySalary}
                            onChange={(e) => {
                              setFormData({ ...formData, monthlySalary: e.target.value });
                              if (formErrors.monthlySalary) setFormErrors({ ...formErrors, monthlySalary: "" });
                            }}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              border: `1px solid ${formErrors.monthlySalary ? "#ef4444" : "#d4d4d8"}`,
                              fontSize: "13.5px",
                            }}
                          />
                          {formErrors.monthlySalary && <div style={{ color: "#ef4444", fontSize: "11px", marginTop: "3px" }}>{formErrors.monthlySalary}</div>}
                        </div>

                        <div style={{
                          background: "#f4f4f5",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #e4e4e7",
                        }}>
                          <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#71717a", fontWeight: "600" }}>
                            Annual Reference
                          </div>
                          <div style={{ fontSize: "17px", fontWeight: "700", color: "#09090b", marginTop: "2px" }}>
                            {formatINR(annualizedSalary)}
                          </div>
                          <div style={{ fontSize: "11px", color: "#a1a1aa", marginTop: "2px" }}>
                            12 months annualized
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Predefined Reusable Clause Library Section */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                        <div>
                          <h4 style={{ margin: "0", fontSize: "13.5px", fontWeight: "600", color: "#18181b", display: "flex", alignItems: "center", gap: "6px" }}>
                            <IconScroll size={15} />
                            <span>Offer Letter Clauses</span>
                          </h4>
                          <span style={{ fontSize: "12px", color: "#71717a" }}>
                            Select and customize clauses included in this letter.
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleResetClauses}
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                          >
                            Reset Clauses
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleAddCustomClause}
                            style={{ padding: "4px 10px", fontSize: "11.5px" }}
                          >
                            + Add Clause
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {formData.clauses.map((clause, idx) => (
                          <div
                            key={clause.clauseId || idx}
                            style={{
                              background: clause.enabled ? "#ffffff" : "#fbfbfc",
                              border: `1px solid ${clause.enabled ? "#cbd5e1" : "#e2e8f0"}`,
                              borderRadius: "8px",
                              padding: "12px 14px",
                              opacity: clause.enabled ? 1 : 0.65,
                              transition: "all 0.15s ease",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", color: "#0f172a", flex: 1, minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={clause.enabled}
                                  onChange={() => handleToggleClause(idx)}
                                  style={{ cursor: "pointer", flexShrink: 0 }}
                                />
                                <input
                                  type="text"
                                  value={clause.title}
                                  disabled={!clause.enabled}
                                  onChange={(e) => handleClauseChange(idx, "title", e.target.value)}
                                  style={{
                                    fontWeight: "600",
                                    fontSize: "13px",
                                    color: "#0f172a",
                                    border: "none",
                                    background: "transparent",
                                    outline: "none",
                                    flex: 1,
                                    minWidth: 0,
                                    padding: "2px 4px",
                                  }}
                                />
                              </label>

                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveClause(idx, -1)}
                                  style={{
                                    padding: "3px 6px",
                                    background: "#f1f5f9",
                                    border: "1px solid #cbd5e1",
                                    color: "#334155",
                                    borderRadius: "4px",
                                    cursor: idx === 0 ? "not-allowed" : "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
                                  title="Move Up"
                                  aria-label="Move Up"
                                >
                                  <IconChevronUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === formData.clauses.length - 1}
                                  onClick={() => handleMoveClause(idx, 1)}
                                  style={{
                                    padding: "3px 6px",
                                    background: "#f1f5f9",
                                    border: "1px solid #cbd5e1",
                                    color: "#334155",
                                    borderRadius: "4px",
                                    cursor: idx === formData.clauses.length - 1 ? "not-allowed" : "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                  }}
                                  title="Move Down"
                                  aria-label="Move Down"
                                >
                                  <IconChevronDown size={12} />
                                </button>
                              </div>
                            </div>

                            {clause.enabled && (
                              <textarea
                                rows={3}
                                value={clause.body}
                                onChange={(e) => handleClauseChange(idx, "body", e.target.value)}
                                style={{
                                  width: "100%",
                                  padding: "8px 10px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "12px",
                                  lineHeight: "1.5",
                                  fontFamily: "inherit",
                                  color: "#334155",
                                  resize: "vertical",
                                }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Right Panel: Live Document Preview */}
              {(editorTab === "preview" || editorTab === "split") && (
                <div style={{
                  flex: 1,
                  background: "#52525b",
                  padding: "24px",
                  overflowY: "auto",
                  display: "flex",
                  justifyContent: "center",
                }}>
                  <div style={{
                    width: "100%",
                    maxWidth: "850px",
                    background: "#ffffff",
                    borderRadius: "6px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
                    minHeight: "1000px",
                    color: "#18181b",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}>
                    {livePreviewHtml ? (
                      <iframe
                        srcDoc={livePreviewHtml}
                        title="Offer Document Preview"
                        style={{
                          width: "100%",
                          height: "100%",
                          minHeight: "1000px",
                          border: "none",
                          display: "block",
                          background: "#ffffff",
                        }}
                      />
                    ) : (
                      <div style={{ textAlign: "center", padding: "100px 20px", color: "#a1a1aa" }}>
                        <div style={{ marginBottom: "8px", display: "flex", justifyContent: "center" }}>
                          <IconClock size={32} />
                        </div>
                        <div>Generating live offer document preview...</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div style={{
              padding: "16px 24px",
              background: "#ffffff",
              borderTop: "1px solid #e4e4e7",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div style={{ fontSize: "12px", color: "#71717a" }}>
                Preview updates automatically.
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowEditorModal(false)}
                  disabled={savingOffer}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSaveOffer("download")}
                  disabled={savingOffer}
                >
                  {savingOffer ? "Saving..." : "Save & Download PDF"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSaveOffer("draft")}
                  disabled={savingOffer}
                >
                  {savingOffer ? "Saving..." : "Save Draft"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveOffer("send")}
                  disabled={savingOffer}
                  style={{
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    padding: "9px 20px",
                    borderRadius: "8px",
                    fontWeight: "600",
                  }}
                >
                  {savingOffer ? "Processing..." : "Save & Send Offer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL VIEW PREVIEW MODAL */}
      {previewModalOffer && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.75)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000,
          padding: "20px",
        }}>
          <div style={{
            background: "#27272a",
            width: "100%",
            maxWidth: "960px",
            height: "94vh",
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
          }}>
            {/* Preview Modal Header */}
            <div style={{
              padding: "14px 20px",
              background: "#18181b",
              borderBottom: "1px solid #3f3f46",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              color: "#ffffff",
            }}>
              <div>
                <span style={{ fontWeight: "600", fontSize: "15px" }}>
                  Offer Letter Preview: {previewModalOffer.candidate?.fullName}
                </span>
                <span style={{
                  marginLeft: "10px",
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  background: STATUS_CONFIG[previewModalOffer.status]?.bg || "#3f3f46",
                  color: STATUS_CONFIG[previewModalOffer.status]?.color || "#ffffff",
                  fontWeight: "bold",
                }}>
                  {STATUS_CONFIG[previewModalOffer.status]?.label || previewModalOffer.status}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(previewModalOffer._id, previewModalOffer.candidate?.fullName)}
                  disabled={downloadingId === previewModalOffer._id}
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    background: "#ffffff",
                    color: "#18181b",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: "600",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <IconDownload size={14} />
                  <span>{downloadingId === previewModalOffer._id ? "Downloading..." : "Download PDF"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewModalOffer(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#a1a1aa",
                    cursor: "pointer",
                    padding: "0 4px",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                  aria-label="Close modal"
                >
                  <IconClose size={18} />
                </button>
              </div>
            </div>

            {/* Document Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", justifyContent: "center" }}>
              <div style={{
                width: "100%",
                maxWidth: "850px",
                background: "#ffffff",
                borderRadius: "6px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
                minHeight: "850px",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}>
                {previewModalLoading ? (
                  <div style={{ textAlign: "center", padding: "100px", color: "#71717a" }}>Loading document...</div>
                ) : (
                  <iframe
                    srcDoc={previewModalOffer.content || "<p>No content rendered</p>"}
                    title="Full Offer Document Preview"
                    style={{
                      width: "100%",
                      height: "100%",
                      minHeight: "850px",
                      border: "none",
                      display: "block",
                      background: "#ffffff",
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION DIALOG MODAL */}
      {confirmModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1100,
          padding: "20px",
        }}>
          <div style={{
            background: "#ffffff",
            width: "100%",
            maxWidth: "480px",
            borderRadius: "14px",
            padding: "24px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            border: "1px solid #e4e4e7",
          }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "16px", fontWeight: "700", color: "#09090b" }}>
              {confirmModal.type === "SEND_EMAIL" && (confirmModal.offer?.status === "SENT" ? "Resend Offer Letter Email" : "Send Offer Letter Email")}
              {confirmModal.type === "SENT" && "Confirm Manual Issuance (Mark as Sent)"}
              {confirmModal.type === "ACCEPTED" && "Record Candidate Acceptance"}
              {confirmModal.type === "REJECTED" && "Record Candidate Rejection"}
              {confirmModal.type === "DELETE" && "Delete Offer Letter Draft"}
            </h3>

            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#52525b", lineHeight: "1.5" }}>
              {confirmModal.type === "SEND_EMAIL" && (
                <>
                  Send official offer letter email with attached PDF to <strong>{confirmModal.offer?.candidate?.fullName}</strong> ({confirmModal.offer?.candidate?.email})?
                  <br /><br />
                  The candidate will receive the formal offer details and the generated PDF document directly via Gmail SMTP.
                </>
              )}
              {confirmModal.type === "SENT" && (
                <>
                  Are you sure you want to mark this offer letter for <strong>{confirmModal.offer.candidate?.fullName}</strong> as <strong>SENT</strong>?
                  <br /><br />
                  <span style={{ color: "#d97706", fontWeight: "600" }}>Note:</span> Once marked as Sent, the offer letter terms become locked and cannot be edited. You can share the downloaded PDF with the candidate manually.
                </>
              )}
              {confirmModal.type === "ACCEPTED" && (
                <>
                  Record that candidate <strong>{confirmModal.offer.candidate?.fullName}</strong> has accepted the offer of employment as <strong>{confirmModal.offer.position}</strong>.
                  <br /><br />
                  This will enable the candidate to be onboarded as an employee through the standard HRMS onboarding workflow.
                </>
              )}
              {confirmModal.type === "REJECTED" && (
                <>
                  Record that candidate <strong>{confirmModal.offer.candidate?.fullName}</strong> has declined or rejected the offer.
                </>
              )}
              {confirmModal.type === "DELETE" && (
                <>
                  Are you sure you want to delete the draft offer letter for <strong>{confirmModal.offer.candidate?.fullName}</strong>? This action cannot be undone.
                </>
              )}
            </p>

            {confirmModal.type !== "DELETE" && confirmModal.type !== "SEND_EMAIL" && (
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px", color: "#374151" }}>
                  Internal HR Notes (Optional):
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Shared PDF via manual corporate dispatch; candidate confirmed via signed acceptance copy."
                  value={confirmModal.notes}
                  onChange={(e) => setConfirmModal({ ...confirmModal, notes: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #d4d4d8",
                    fontSize: "13px",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            )}

            {modalError && (
              <div style={{
                marginBottom: "16px",
                padding: "10px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "8px",
                color: "#991b1b",
                fontSize: "13px",
                lineHeight: "1.5",
              }}>
                <strong>Error:</strong> {modalError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={actionLoading}
                onClick={() => {
                  setConfirmModal(null);
                  setModalError("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleExecuteStatusChange}
                style={{
                  background: confirmModal.type === "DELETE" || confirmModal.type === "REJECTED"
                    ? "#dc2626"
                    : confirmModal.type === "ACCEPTED"
                    ? "#059669"
                    : "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: actionLoading ? "not-allowed" : "pointer",
                }}
              >
                {actionLoading
                  ? (confirmModal.type === "SEND_EMAIL" ? "Sending Email & PDF..." : "Processing...")
                  : confirmModal.type === "SEND_EMAIL"
                  ? "Send Email"
                  : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

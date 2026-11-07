import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { IconClose } from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import Pagination from "../components/Pagination";
import ModuleToolbar from "../components/ModuleToolbar";
import OnboardingSectionReviewBar, {
  FINAL_APPROVED_STATUSES,
  SECTION_LABELS,
  allSectionsApproved,
} from "../components/OnboardingSectionReviewBar";
import api from "../services/api";

const STATUS_BADGES = {
  SUBMITTED: { label: "Under Review", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  CHANGES_REQUESTED: { label: "Updates Requested", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  APPROVED: { label: "Approved - Invite Issued", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  ACCOUNT_SETUP_SENT: { label: "Account Setup Sent", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  ACCOUNT_SETUP_PENDING: { label: "Invite Not Delivered", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  ACTIVATED: { label: "Activated", bg: "#ecfeff", color: "#0e7490", border: "#a5f3fc" },
  PROCESSING_APPROVAL: { label: "Processing Approval", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  DRAFT: { label: "Draft in Progress", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  REJECTED: { label: "Rejected", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
};

const FILTER_TABS = [
  { key: "ALL", label: "All" },
  { key: "SUBMITTED", label: "Under Review" },
  { key: "CHANGES_REQUESTED", label: "Updates Requested" },
  { key: "APPROVED", label: "Approved - Invite Issued" },
  { key: "ACCOUNT_SETUP_SENT", label: "Account Setup Sent" },
  { key: "ACCOUNT_SETUP_PENDING", label: "Invite Not Delivered" },
  { key: "ACTIVATED", label: "Activated" },
  { key: "REJECTED", label: "Rejected" },
];

const SECTION_DECISION_COPY = {
  REQUEST_CORRECTION: {
    title: "Request Section Correction",
    help: "Tell the candidate exactly what to fix. They are emailed a secure link and can edit only this section.",
    submit: "Send Correction Request",
    color: "#d97706",
    placeholder: "e.g. Emergency contact phone must be a 10-digit number.",
  },
  REJECT: {
    title: "Reject Section",
    help: "The candidate must resubmit this section. Other approved sections stay locked.",
    submit: "Reject Section",
    color: "#b91c1c",
    placeholder: "e.g. ID proof is unreadable; upload a clear scan.",
  },
};

export default function AdminOnboardingReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkOfferId = (searchParams.get("offerId") || "").trim();
  const deepLinkHandledRef = useRef("");

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deepLinkMessage, setDeepLinkMessage] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  const totalSubmissions = submissions.length;
  const totalPages = Math.ceil((totalSubmissions || 1) / pageSize);
  const paginatedSubmissions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return submissions.slice(start, start + pageSize);
  }, [submissions, page, pageSize]);

  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Request Corrections Modal
  const [showCorrectionsModal, setShowCorrectionsModal] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [requestingCorrections, setRequestingCorrections] = useState(false);

  // Approval Modal
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approving, setApproving] = useState(false);

  // Reject Modal
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // Action feedback
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Resend activation state
  const [resending, setResending] = useState(false);

  // Section-wise review state
  const [sectionBusy, setSectionBusy] = useState(false);
  const [sectionNoteModal, setSectionNoteModal] = useState(null); // { section, decision }
  const [sectionNote, setSectionNote] = useState("");

  // Live-update refs (SSE handler must always see the latest filters / selection)
  const selectedIdRef = useRef(null);
  const refetchRef = useRef({ list: () => {}, detail: () => {} });
  const [liveConnected, setLiveConnected] = useState(false);

  // Mask / Reveal sensitive bank and tax data
  const [showSensitiveData, setShowSensitiveData] = useState(false);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const fetchSubmissions = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (debouncedSearch.trim()) params.append("search", debouncedSearch.trim());
      if (deepLinkOfferId) params.append("offerId", deepLinkOfferId);

      const res = await api.get(`/onboarding/submissions?${params.toString()}`);
      setSubmissions(res.data.submissions || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load onboarding submissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [statusFilter, debouncedSearch, deepLinkOfferId]);

  // Silent refetch of the open submission (used by live updates and after section actions)
  const refreshSelectedDetail = async (id) => {
    if (!id) return;
    try {
      const res = await api.get(`/onboarding/submissions/${id}`);
      setSelectedSubmission((current) =>
        current && String(current._id) === String(id) ? res.data.submission : current
      );
    } catch {
      // Keep the current view on transient errors
    }
  };

  useEffect(() => {
    selectedIdRef.current = selectedSubmission?._id ? String(selectedSubmission._id) : null;
  }, [selectedSubmission?._id]);

  // Always point the SSE handler at the latest closures (filters change over time)
  refetchRef.current = {
    list: () => fetchSubmissions({ silent: true }),
    detail: (id) => refreshSelectedDetail(id),
  };

  // Live HR updates via Server-Sent Events (same pattern as leave management)
  useEffect(() => {
    const baseURL = api.defaults.baseURL || "/api";
    const eventsUrl = `${baseURL.replace(/\/$/, "")}/onboarding/events`;

    let eventSource = null;
    let debounceTimer = null;
    try {
      eventSource = new EventSource(eventsUrl, { withCredentials: true });
      eventSource.onopen = () => setLiveConnected(true);
      eventSource.onerror = () => setLiveConnected(false);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload || payload.type === "CONNECTED") {
            setLiveConnected(true);
            return;
          }
          // Coalesce bursts of events into a single refetch
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            refetchRef.current.list();
            if (payload.submissionId && selectedIdRef.current === String(payload.submissionId)) {
              refetchRef.current.detail(payload.submissionId);
            }
          }, 250);
        } catch {}
      };
    } catch {}

    return () => {
      clearTimeout(debounceTimer);
      if (eventSource) eventSource.close();
    };
  }, []);

  const openSectionDecision = (section, decision) => {
    if (decision === "APPROVE") {
      submitSectionDecision(section, "APPROVE", "");
      return;
    }
    setActionError("");
    setSectionNote("");
    setSectionNoteModal({ section, decision });
  };

  const submitSectionDecision = async (section, decision, note) => {
    if (!selectedSubmission?._id) return;
    try {
      setSectionBusy(true);
      setActionError("");
      setActionSuccess("");
      const res = await api.post(
        `/onboarding/submissions/${selectedSubmission._id}/sections/${section}/review`,
        { decision, note }
      );
      setActionSuccess(res.data.message || "Section updated.");
      setSectionNoteModal(null);
      setSectionNote("");
      await refreshSelectedDetail(selectedSubmission._id);
      fetchSubmissions({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to update section review.");
    } finally {
      setSectionBusy(false);
    }
  };

  const handleSectionNoteSubmit = (e) => {
    e.preventDefault();
    if (!sectionNote.trim()) {
      setActionError("A note is required when rejecting a section or requesting a correction.");
      return;
    }
    submitSectionDecision(sectionNoteModal.section, sectionNoteModal.decision, sectionNote.trim());
  };

  const handleOpenDetail = async (sub) => {
    try {
      setLoadingDetail(true);
      setActionError("");
      setActionSuccess("");
      const res = await api.get(`/onboarding/submissions/${sub._id}`);
      setSelectedSubmission(res.data.submission);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to load submission details.");
    } finally {
      setLoadingDetail(false);
    }
  };

  // Deep-link from Offer Letters "Onboard" → open matching candidate submission
  useEffect(() => {
    if (!deepLinkOfferId || loading) return;
    if (deepLinkHandledRef.current === deepLinkOfferId) return;
    deepLinkHandledRef.current = deepLinkOfferId;

    const match = submissions.find((sub) => {
      const offerRef = sub.offerLetterId;
      const id = offerRef?._id || offerRef;
      return id && String(id) === String(deepLinkOfferId);
    });

    if (match) {
      setDeepLinkMessage("");
      handleOpenDetail(match);
    } else {
      setDeepLinkMessage(
        "No candidate onboarding record was found for this offer yet. The candidate must sign the offer in the portal before HR review can begin. Legacy offers accepted outside the portal will not appear here."
      );
      setSelectedSubmission(null);
    }
  }, [deepLinkOfferId, loading, submissions]);

  const clearOfferDeepLink = () => {
    if (!deepLinkOfferId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("offerId");
    setSearchParams(next, { replace: true });
    setDeepLinkMessage("");
    deepLinkHandledRef.current = "";
  };

  const handleRequestCorrections = async (e) => {
    e.preventDefault();
    if (!correctionReason.trim()) {
      setActionError("Please provide specific notes or reasons for the requested corrections.");
      return;
    }

    try {
      setRequestingCorrections(true);
      setActionError("");
      const res = await api.post(`/onboarding/submissions/${selectedSubmission._id}/request-corrections`, {
        reason: correctionReason.trim(),
      });

      setActionSuccess("Correction request sent to candidate successfully.");
      setShowCorrectionsModal(false);
      setCorrectionReason("");
      setSelectedSubmission({
        ...selectedSubmission,
        status: "CHANGES_REQUESTED",
        correctionReason: correctionReason.trim(),
        reviewedAt: new Date().toISOString(),
      });
      refreshSelectedDetail(selectedSubmission._id);
      fetchSubmissions({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to request corrections.");
    } finally {
      setRequestingCorrections(false);
    }
  };

  const handleApproveSubmission = async () => {
    try {
      setApproving(true);
      setActionError("");
      const res = await api.post(`/onboarding/submissions/${selectedSubmission._id}/approve`);

      setActionSuccess(
        res.data.message ||
          "Onboarding approved. Account setup invitation sent; the employee profile is created when the candidate activates their account."
      );
      setShowApproveModal(false);
      setSelectedSubmission({
        ...selectedSubmission,
        ...(res.data.onboarding ? { status: res.data.onboarding.status } : { status: "APPROVED" }),
      });
      await refreshSelectedDetail(selectedSubmission._id);
      fetchSubmissions({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to approve onboarding.");
    } finally {
      setApproving(false);
    }
  };

  const handleRejectSubmission = async (e) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      setActionError("Please provide a reason for rejecting this candidate onboarding.");
      return;
    }

    try {
      setRejecting(true);
      setActionError("");
      const res = await api.post(`/onboarding/submissions/${selectedSubmission._id}/reject`, {
        reason: rejectionReason.trim(),
      });

      setActionSuccess("Candidate onboarding has been rejected.");
      setShowRejectModal(false);
      setRejectionReason("");
      setSelectedSubmission({
        ...selectedSubmission,
        status: "REJECTED",
        rejectionReason: rejectionReason.trim(),
        rejectedAt: new Date().toISOString(),
      });
      fetchSubmissions();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to reject candidate onboarding.");
    } finally {
      setRejecting(false);
    }
  };

  const handleResendActivation = async () => {
    if (!selectedSubmission?._id) return;

    try {
      setResending(true);
      setActionError("");
      const res = await api.post(`/onboarding/submissions/${selectedSubmission._id}/resend-activation`);
      setActionSuccess(res.data.message || "Account setup invitation resent successfully.");
      refreshSelectedDetail(selectedSubmission._id);
      fetchSubmissions({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to resend activation email.");
    } finally {
      setResending(false);
    }
  };

  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const handleViewDocument = async (doc) => {
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId || !selectedSubmission?._id) return;
    setDownloadingDocId(docId);
    try {
      const response = await api.get(
        `/onboarding/submissions/${selectedSubmission._id}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const mimeType = response.headers["content-type"] || "application/pdf";
      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", doc.fileName || doc.title || "document");
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to view document: " + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleDownloadDocument = async (doc) => {
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId || !selectedSubmission?._id) return;
    setDownloadingDocId(docId);
    try {
      const response = await api.get(
        `/onboarding/submissions/${selectedSubmission._id}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const mimeType = response.headers["content-type"] || "application/octet-stream";
      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", doc.fileName || doc.title || "document");
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to download document: " + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const counts = useMemo(() => {
    const summary = { all: submissions.length, submitted: 0, changes: 0, approved: 0, rejected: 0 };
    submissions.forEach((s) => {
      if (s.status === "SUBMITTED") summary.submitted++;
      else if (s.status === "CHANGES_REQUESTED") summary.changes++;
      else if (FINAL_APPROVED_STATUSES.includes(s.status)) summary.approved++;
      else if (s.status === "REJECTED") summary.rejected++;
    });
    return summary;
  }, [submissions]);

  const sectionReviews = selectedSubmission?.sectionReviews || {};
  const isFinalApproved = Boolean(selectedSubmission && FINAL_APPROVED_STATUSES.includes(selectedSubmission.status));
  const canReviewSections = Boolean(
    selectedSubmission && ["SUBMITTED", "CHANGES_REQUESTED"].includes(selectedSubmission.status)
  );
  const everySectionApproved = allSectionsApproved(sectionReviews);
  const renderSectionBar = (section) => (
    <OnboardingSectionReviewBar
      section={section}
      review={sectionReviews[section]}
      canReview={canReviewSections}
      busy={sectionBusy}
      onDecision={openSectionDecision}
    />
  );

  return (
    <div className="container-wide">
      <AppHeader
        title="Onboarding"
      />

      {/* Compact Inline Onboarding Statistics Strip */}
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
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Total Onboarding: <strong style={{ color: "var(--ink)" }}>{counts.all}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Awaiting Review: <strong style={{ color: counts.submitted > 0 ? "var(--g-800, #155a37)" : "var(--muted)" }}>{counts.submitted}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Updates Requested: <strong style={{ color: counts.changes > 0 ? "#b45309" : "var(--muted)" }}>{counts.changes}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Approved: <strong style={{ color: "var(--g-800, #155a37)" }}>{counts.approved}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted, #646d67)" }}>
          Rejected: <strong style={{ color: counts.rejected > 0 ? "#b91c1c" : "var(--muted)" }}>{counts.rejected}</strong>
        </span>
        <span
          title={liveConnected ? "Live updates connected" : "Live updates reconnecting"}
          style={{ marginLeft: "auto", fontSize: 11, color: liveConnected ? "#047857" : "#94a3b8" }}
        >
          ● {liveConnected ? "Live" : "Offline"}
        </span>
      </div>

      <ModuleToolbar
        searchValue={searchTerm}
        onSearchChange={(e) => setSearchTerm(e.target.value)}
        searchPlaceholder="Search candidate name or email..."
        searchAriaLabel="Search onboarding candidates"
        filterCount={statusFilter !== "ALL" ? 1 : 0}
        onFiltersClear={() => setStatusFilter("ALL")}
        filters={
          <label className="module-toolbar-filter-field">
            Status
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {FILTER_TABS.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            padding: "12px 18px",
            borderRadius: "6px",
            color: "#b91c1c",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {deepLinkOfferId && (
        <div
          style={{
            background: deepLinkMessage ? "#fffbeb" : "#eff6ff",
            border: `1px solid ${deepLinkMessage ? "#fde68a" : "#bfdbfe"}`,
            padding: "12px 18px",
            borderRadius: "6px",
            color: deepLinkMessage ? "#92400e" : "#1e40af",
            fontSize: "13px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <span>
            {deepLinkMessage ||
              "Opened from Offer Letters — showing the onboarding record linked to this offer."}
          </span>
          <button
            type="button"
            onClick={clearOfferDeepLink}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Submissions Table */}
      <div
        className="table-wrapper-relative"
        style={{ background: "var(--card)", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}
      >
        {loading && <div className="table-progress-bar" />}
        {loading && submissions.length === 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "700px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Candidate</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Position & Department</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Offer Status</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Onboarding Status</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Submitted Date</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                <TableSkeletonRows rows={5} cols={6} />
              </tbody>
            </table>
          </div>
        ) : submissions.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
            <p style={{ margin: "0 0 12px" }}>
              No candidate onboarding submissions found matching the selected criteria.
            </p>
            {(statusFilter !== "ALL" || debouncedSearch) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("ALL");
                  setSearchTerm("");
                }}
                className="btn-sm btn-secondary"
                style={{ fontSize: "12px" }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "700px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Candidate</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Position & Department</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Offer Status</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Onboarding Status</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600" }}>Submitted Date</th>
                  <th style={{ padding: "12px 16px", color: "#475569", fontWeight: "600", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? "table-refreshing-dim" : ""}>
                {paginatedSubmissions.map((sub) => {
                  const badge = STATUS_BADGES[sub.status] || STATUS_BADGES.DRAFT;
                  const offer = sub.offerLetterId;
                  return (
                    <tr key={sub._id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "14px 16px" }}>
                        <strong style={{ color: "#0f172a", display: "block" }}>{sub.candidate?.fullName}</strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{sub.candidate?.email}</span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={{ color: "#0f172a", display: "block" }}>{offer?.position || "Assigned"}</span>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{offer?.department || "Core"}</span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            color: offer?.status === "ACCEPTED" ? "#16a34a" : "#64748b",
                            fontWeight: "500",
                          }}
                        >
                          {offer?.status || "Draft"}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: "600",
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748b" }}>
                        {sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString("en-IN") : "In Draft"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(sub)}
                          style={{
                            padding: "6px 14px",
                            background: "#f8fafc",
                            border: "1px solid #cbd5e1",
                            borderRadius: "6px",
                            color: "#334155",
                            fontSize: "12px",
                            fontWeight: "600",
                            cursor: "pointer",
                          }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalSubmissions > 0 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalSubmissions}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50]}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="submissions"
          />
        )}
      </div>

      {/* Review Details — centered modal */}
      {selectedSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
            backdropFilter: "blur(2px)",
          }}
          onClick={() => {
            if (!approving && !requestingCorrections && !rejecting) {
              setSelectedSubmission(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !approving && !requestingCorrections && !rejecting) {
              setSelectedSubmission(null);
            }
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Candidate onboarding submission"
            style={{
              width: "100%",
              maxWidth: 760,
              background: "var(--card, #ffffff)",
              maxHeight: "min(90vh, 90dvh)",
              display: "flex",
              flexDirection: "column",
              borderRadius: "var(--r-md, 12px)",
              border: "1px solid var(--hair, #e6ede8)",
              boxShadow: "0 20px 48px rgba(19, 26, 21, 0.16)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pinned Drawer Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#ffffff",
                flexShrink: 0,
              }}
            >
              <div>
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
                  Candidate Onboarding Submission
                </span>
                <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: "4px 0 0" }}>
                  {selectedSubmission.candidate?.fullName || "Candidate Details"}
                </h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "11px",
                    fontWeight: "600",
                    background: (STATUS_BADGES[selectedSubmission.status] || STATUS_BADGES.DRAFT).bg,
                    color: (STATUS_BADGES[selectedSubmission.status] || STATUS_BADGES.DRAFT).color,
                    border: `1px solid ${(STATUS_BADGES[selectedSubmission.status] || STATUS_BADGES.DRAFT).border}`,
                  }}
                >
                  {(STATUS_BADGES[selectedSubmission.status] || STATUS_BADGES.DRAFT).label}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  aria-label="Close"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                    padding: "4px 8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconClose size={18} />
                </button>
              </div>
            </div>

            {/* Scrollable Drawer Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {actionSuccess && (
                <div
                  style={{
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    color: "#065f46",
                    fontSize: "13px",
                    marginBottom: "18px",
                    lineHeight: "1.5",
                  }}
                >
                  {actionSuccess}
                </div>
              )}
              {actionError && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "12px 16px",
                    borderRadius: "8px",
                    color: "#b91c1c",
                    fontSize: "13px",
                    marginBottom: "18px",
                    lineHeight: "1.5",
                  }}
                >
                  {actionError}
                </div>
              )}

              {/* Status Banner: HR final approval -> account setup -> activated */}
              {isFinalApproved && (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    padding: "16px 20px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#166534", fontWeight: "700", textTransform: "uppercase" }}>
                    {selectedSubmission.status === "ACTIVATED"
                      ? "Account Activated - Employee Profile Created"
                      : selectedSubmission.status === "ACCOUNT_SETUP_PENDING"
                      ? "Approved - Account Setup Invitation Not Delivered"
                      : "Approved - Awaiting Account Setup"}
                  </span>
                  {selectedSubmission.status === "ACTIVATED" ? (
                    <div style={{ fontSize: "15px", fontWeight: "700", color: "#14532d", marginTop: "4px" }}>
                      Employee Code: {selectedSubmission.employeeId?.employeeCode || "Active Employee Profile"}
                    </div>
                  ) : (
                    <p style={{ fontSize: "12px", color: "#15803d", margin: "6px 0 12px" }}>
                      HR approval is frozen. An account setup invitation was issued
                      {selectedSubmission.invitationSentAt
                        ? ` on ${new Date(selectedSubmission.invitationSentAt).toLocaleString("en-IN")}`
                        : ""}
                      . The employee profile is created only after the candidate activates their account.
                    </p>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", marginTop: 8 }}>
                    {selectedSubmission.employeeId?._id && (
                      <Link
                        to={`/admin/employees/${selectedSubmission.employeeId._id}`}
                        style={{ fontSize: "12px", color: "#2563eb", fontWeight: "600", textDecoration: "none" }}
                      >
                        View in People Management →
                      </Link>
                    )}
                    {selectedSubmission.status !== "ACTIVATED" && (
                      <button
                        type="button"
                        onClick={handleResendActivation}
                        disabled={resending}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#475569",
                          fontSize: "12px",
                          cursor: resending ? "not-allowed" : "pointer",
                          textDecoration: "underline",
                          padding: 0,
                        }}
                      >
                        {resending ? "Resending..." : "Resend Account Setup Invitation"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Status Banner: CHANGES_REQUESTED */}
              {selectedSubmission.status === "CHANGES_REQUESTED" && (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    padding: "16px 20px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#92400e", fontWeight: "700", textTransform: "uppercase" }}>
                    Updates Requested from Candidate
                  </span>
                  <p style={{ fontSize: "13px", color: "#78350f", margin: "6px 0 0", lineHeight: "1.5" }}>
                    <strong>Requested Notes:</strong>{" "}
                    {selectedSubmission.correctionReason || "Candidate has been asked to update their onboarding submission."}
                  </p>
                  {selectedSubmission.reviewedAt && (
                    <span style={{ fontSize: "11px", color: "#b45309", display: "block", marginTop: "8px" }}>
                      Requested on: {new Date(selectedSubmission.reviewedAt).toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              )}

              {/* Status Banner: REJECTED */}
              {selectedSubmission.status === "REJECTED" && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "16px 20px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#991b1b", fontWeight: "700", textTransform: "uppercase" }}>
                    Candidate Onboarding Rejected
                  </span>
                  <p style={{ fontSize: "13px", color: "#7f1d1d", margin: "6px 0 0", lineHeight: "1.5" }}>
                    <strong>Rejection Reason:</strong>{" "}
                    {selectedSubmission.rejectionReason || "Candidate onboarding was rejected by HR administrator."}
                  </p>
                  {selectedSubmission.rejectedAt && (
                    <span style={{ fontSize: "11px", color: "#b91c1c", display: "block", marginTop: "8px" }}>
                      Rejected on: {new Date(selectedSubmission.rejectedAt).toLocaleString("en-IN")}
                    </span>
                  )}
                </div>
              )}

              {/* Offer Info */}
              <div
                style={{
                  background: "#f8fafc",
                  padding: "14px 18px",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  marginBottom: "18px",
                  fontSize: "12px",
                }}
              >
                <strong style={{ color: "#334155", display: "block", marginBottom: "8px" }}>Offer Details:</strong>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>Position: <strong>{selectedSubmission.offerLetterId?.position || "N/A"}</strong></div>
                  <div>Department: <strong>{selectedSubmission.offerLetterId?.department || "Core Team"}</strong></div>
                  <div>
                    Monthly Compensation:{" "}
                    <strong>₹{Number(selectedSubmission.offerLetterId?.monthlySalary || 0).toLocaleString("en-IN")}</strong>
                  </div>
                  <div>
                    Signed Date:{" "}
                    <strong>
                      {selectedSubmission.offerLetterId?.signature?.signedAt
                        ? new Date(selectedSubmission.offerLetterId.signature.signedAt).toLocaleDateString("en-IN")
                        : "Signed"}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Personal Details */}
              <div style={{ marginBottom: "18px" }}>
                <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: "0 0 10px" }}>{SECTION_LABELS.personalDetails}</h4>
                {renderSectionBar("personalDetails")}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
                  <div>Full Name: <strong>{selectedSubmission.personalDetails?.fullName || selectedSubmission.candidate?.fullName}</strong></div>
                  <div>Phone: <strong>{selectedSubmission.personalDetails?.phoneNumber || "N/A"}</strong></div>
                  <div>
                    DOB:{" "}
                    <strong>
                      {selectedSubmission.personalDetails?.dateOfBirth
                        ? new Date(selectedSubmission.personalDetails.dateOfBirth).toLocaleDateString("en-IN")
                        : "N/A"}
                    </strong>
                  </div>
                  <div>Gender: <strong>{selectedSubmission.personalDetails?.gender || "N/A"}</strong></div>
                </div>
              </div>

              {/* Address */}
              <div style={{ marginBottom: "18px" }}>
                <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>{SECTION_LABELS.residentialAddress}</h4>
                {renderSectionBar("residentialAddress")}
                <div style={{ fontSize: "12px", color: "#334155", lineHeight: "1.5" }}>
                  {selectedSubmission.residentialAddress?.street || "Address not provided"}
                  {selectedSubmission.residentialAddress?.city ? `, ${selectedSubmission.residentialAddress.city}` : ""}
                  {selectedSubmission.residentialAddress?.state ? `, ${selectedSubmission.residentialAddress.state}` : ""}
                  {selectedSubmission.residentialAddress?.postalCode ? ` - ${selectedSubmission.residentialAddress.postalCode}` : ""}
                </div>
              </div>

              {/* Emergency Contact */}
              <div style={{ marginBottom: "18px" }}>
                <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>{SECTION_LABELS.emergencyContact}</h4>
                {renderSectionBar("emergencyContact")}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
                  <div>Name: <strong>{selectedSubmission.emergencyContact?.name || "N/A"}</strong></div>
                  <div>Relationship: <strong>{selectedSubmission.emergencyContact?.relationship || "N/A"}</strong></div>
                  <div>Phone: <strong>{selectedSubmission.emergencyContact?.phone || "N/A"}</strong></div>
                </div>
              </div>

              {/* Bank & Tax */}
              <div style={{ marginBottom: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Bank & Tax Information</h4>
                  <button
                    type="button"
                    onClick={() => setShowSensitiveData(!showSensitiveData)}
                    style={{
                      background: "transparent",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      color: "#334155",
                      fontSize: "11px",
                      fontWeight: "600",
                      cursor: "pointer",
                      padding: "2px 8px",
                    }}
                  >
                    {showSensitiveData ? "Mask Numbers" : "Reveal Numbers"}
                  </button>
                </div>
                {renderSectionBar("bankAndTax")}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
                  <div>Bank Name: <strong>{selectedSubmission.bankDetails?.bankName || "N/A"}</strong></div>
                  <div>
                    Account No:{" "}
                    <strong>
                      {selectedSubmission.bankDetails?.accountNumber
                        ? showSensitiveData
                          ? selectedSubmission.bankDetails.accountNumber
                          : `••••${String(selectedSubmission.bankDetails.accountNumber).slice(-4)}`
                        : "N/A"}
                    </strong>
                  </div>
                  <div>IFSC: <strong>{selectedSubmission.bankDetails?.ifscCode || "N/A"}</strong></div>
                  <div>
                    PAN / Tax ID:{" "}
                    <strong>
                      {selectedSubmission.taxDetails?.panNumber
                        ? showSensitiveData
                          ? selectedSubmission.taxDetails.panNumber
                          : `••••${String(selectedSubmission.taxDetails.panNumber).slice(-4)}`
                        : "N/A"}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Uploaded Documents */}
              <div style={{ marginBottom: "20px" }}>
                <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: "0 0 10px" }}>
                  Uploaded Documents ({selectedSubmission.documents?.length || 0})
                </h4>
                {renderSectionBar("documents")}
                {selectedSubmission.documents?.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>No documents uploaded.</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selectedSubmission.documents.map((doc) => {
                      const docId = doc._id || doc.id || doc.storageKey;
                      const isProcessing = downloadingDocId === docId;
                      return (
                        <div
                          key={docId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "12px", color: "#0f172a", display: "block" }}>
                              {doc.title || doc.fileName}
                            </strong>
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              {doc.documentType} • {(doc.fileSize / 1024).toFixed(1)} KB
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <button
                              type="button"
                              onClick={() => handleViewDocument(doc)}
                              disabled={isProcessing}
                              style={{
                                background: "none",
                                border: "none",
                                padding: 0,
                                fontSize: "12px",
                                color: "#2563eb",
                                fontWeight: "600",
                                cursor: isProcessing ? "not-allowed" : "pointer",
                                textDecoration: "underline",
                              }}
                            >
                              {isProcessing ? "Loading..." : "View Document"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadDocument(doc)}
                              disabled={isProcessing}
                              style={{
                                background: "#ffffff",
                                border: "1px solid #cbd5e1",
                                padding: "4px 8px",
                                fontSize: "12px",
                                color: "#475569",
                                fontWeight: "500",
                                borderRadius: "4px",
                                cursor: isProcessing ? "not-allowed" : "pointer",
                              }}
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Review History */}
              {selectedSubmission.history && selectedSubmission.history.length > 0 && (
                <div style={{ marginBottom: "20px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", margin: "0 0 10px" }}>Audit History</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selectedSubmission.history.map((h, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: "8px 12px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "6px",
                          fontSize: "11px",
                          color: "#475569",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                          <strong style={{ color: "#0f172a" }}>{h.action}</strong>
                          <span style={{ color: "#94a3b8" }}>
                            {h.timestamp ? new Date(h.timestamp).toLocaleString("en-IN") : ""}
                          </span>
                        </div>
                        {h.notes && <div>{h.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pinned Action Bar at Bottom of Drawer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e2e8f0",
                background: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
                gap: "12px",
                boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.04)",
              }}
            >
              {selectedSubmission.status === "SUBMITTED" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setActionError("");
                      setRejectionReason("");
                      setShowRejectModal(true);
                    }}
                    style={{
                      padding: "8px 16px",
                      background: "#ffffff",
                      border: "1px solid #fca5a5",
                      borderRadius: "6px",
                      color: "#b91c1c",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Reject Candidate
                  </button>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError("");
                        setCorrectionReason("");
                        setShowCorrectionsModal(true);
                      }}
                      style={{
                        padding: "8px 16px",
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: "6px",
                        color: "#b45309",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      Request Corrections
                    </button>

                    <button
                      type="button"
                      disabled={!everySectionApproved}
                      title={
                        everySectionApproved
                          ? "Freeze approval and send the account setup email"
                          : "Approve every section first"
                      }
                      onClick={() => {
                        setActionError("");
                        setShowApproveModal(true);
                      }}
                      style={{
                        padding: "8px 20px",
                        background: everySectionApproved ? "#16a34a" : "#a7d7b8",
                        border: "none",
                        borderRadius: "6px",
                        color: "#ffffff",
                        fontSize: "13px",
                        fontWeight: "600",
                        cursor: everySectionApproved ? "pointer" : "not-allowed",
                      }}
                    >
                      Final Approve & Send Account Setup
                    </button>
                  </div>
                </>
              )}

              {selectedSubmission.status === "CHANGES_REQUESTED" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setActionError("");
                      setRejectionReason("");
                      setShowRejectModal(true);
                    }}
                    style={{
                      padding: "8px 16px",
                      background: "#ffffff",
                      border: "1px solid #fca5a5",
                      borderRadius: "6px",
                      color: "#b91c1c",
                      fontSize: "12px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Reject Candidate
                  </button>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#b45309", fontWeight: "500" }}>
                      Awaiting Candidate Updates
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError("");
                        setCorrectionReason(selectedSubmission.correctionReason || "");
                        setShowCorrectionsModal(true);
                      }}
                      style={{
                        padding: "8px 14px",
                        background: "#fffbeb",
                        border: "1px solid #fde68a",
                        borderRadius: "6px",
                        color: "#b45309",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      Update Correction Request
                    </button>
                  </div>
                </>
              )}

              {isFinalApproved && (
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: "#166534", fontWeight: "600" }}>
                    {selectedSubmission.status === "ACTIVATED"
                      ? `Employee: ${selectedSubmission.employeeId?.employeeCode || "Active Record"}`
                      : "Approved - employee profile is created when the candidate activates their account"}
                  </span>
                  {selectedSubmission.employeeId?._id && (
                    <Link
                      to={`/admin/employees/${selectedSubmission.employeeId._id}`}
                      style={{
                        padding: "6px 14px",
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        borderRadius: "6px",
                        color: "#2563eb",
                        fontSize: "12px",
                        fontWeight: "600",
                        textDecoration: "none",
                      }}
                    >
                      View Employee Profile
                    </Link>
                  )}
                </div>
              )}

              {selectedSubmission.status === "REJECTED" && (
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: "#b91c1c", fontWeight: "600" }}>
                    Candidate Onboarding Rejected
                  </span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    Actions are disabled for rejected submissions.
                  </span>
                </div>
              )}

              {selectedSubmission.status !== "SUBMITTED" &&
                selectedSubmission.status !== "CHANGES_REQUESTED" &&
                !isFinalApproved &&
                selectedSubmission.status !== "PROCESSING_APPROVAL" &&
                selectedSubmission.status !== "REJECTED" && (
                  <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      Draft in progress (Not yet submitted for review)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError("");
                        setRejectionReason("");
                        setShowRejectModal(true);
                      }}
                      style={{
                        padding: "6px 14px",
                        background: "#ffffff",
                        border: "1px solid #fca5a5",
                        borderRadius: "6px",
                        color: "#b91c1c",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      Reject Candidate
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Section decision (reject / request correction) note modal */}
      {sectionNoteModal && selectedSubmission && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "16px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={SECTION_DECISION_COPY[sectionNoteModal.decision].title}
            style={{
              background: "#ffffff",
              padding: "28px",
              borderRadius: "12px",
              maxWidth: "480px",
              width: "100%",
              border: "1px solid #e2e8f0",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 4px" }}>
              {SECTION_DECISION_COPY[sectionNoteModal.decision].title}
            </h3>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: 8 }}>
              {SECTION_LABELS[sectionNoteModal.section]}
            </div>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px", lineHeight: "1.5" }}>
              {SECTION_DECISION_COPY[sectionNoteModal.decision].help}
            </p>
            <form onSubmit={handleSectionNoteSubmit}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                Note for candidate <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                value={sectionNote}
                onChange={(e) => setSectionNote(e.target.value)}
                placeholder={SECTION_DECISION_COPY[sectionNoteModal.decision].placeholder}
                rows={4}
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: "13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                  marginBottom: 14,
                }}
                required
              />
              {actionError && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    color: "#b91c1c",
                    fontSize: "12px",
                    marginBottom: "14px",
                  }}
                >
                  {actionError}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSectionNoteModal(null);
                    setActionError("");
                  }}
                  disabled={sectionBusy}
                  style={{
                    padding: "8px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    color: "#475569",
                    fontSize: "12px",
                    cursor: sectionBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sectionBusy}
                  style={{
                    padding: "8px 18px",
                    background: SECTION_DECISION_COPY[sectionNoteModal.decision].color,
                    border: "none",
                    borderRadius: "6px",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: sectionBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {sectionBusy ? "Saving..." : SECTION_DECISION_COPY[sectionNoteModal.decision].submit}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Corrections Modal */}
      {showCorrectionsModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: "28px",
              borderRadius: "12px",
              maxWidth: "480px",
              width: "100%",
              border: "1px solid #e2e8f0",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>
              Request Onboarding Corrections
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px", lineHeight: "1.5" }}>
              Specify the fields or documents the candidate needs to correct. An email with a secure link will be sent to the candidate.
            </p>

            <form onSubmit={handleRequestCorrections}>
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                  Notes & Required Changes <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Please upload a clear copy of your address proof and verify your bank IFSC code."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "13px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowCorrectionsModal(false)}
                  disabled={requestingCorrections}
                  style={{
                    padding: "8px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    color: "#475569",
                    fontSize: "12px",
                    cursor: requestingCorrections ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={requestingCorrections}
                  style={{
                    padding: "8px 18px",
                    background: "#d97706",
                    border: "none",
                    borderRadius: "6px",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: requestingCorrections ? "not-allowed" : "pointer",
                  }}
                >
                  {requestingCorrections ? "Sending Request..." : "Send Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Confirmation Modal */}
      {showApproveModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: "28px",
              borderRadius: "12px",
              maxWidth: "480px",
              width: "100%",
              border: "1px solid #e2e8f0",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>
              Final Approval & Account Setup Invitation
            </h3>
            <p style={{ fontSize: "13px", color: "#475569", lineHeight: "1.5", margin: "0 0 16px" }}>
              Give final approval for <strong>{selectedSubmission.candidate?.fullName}</strong>? All sections are
              approved. This freezes the submission.
            </p>

            <div
              style={{
                background: "#f8fafc",
                padding: "14px 16px",
                borderRadius: "6px",
                border: "1px solid #e2e8f0",
                fontSize: "12px",
                color: "#475569",
                marginBottom: "20px",
                lineHeight: "1.6",
              }}
            >
              <div>• An account setup email with a secure password link is sent to the candidate.</div>
              <div>• The employee profile is NOT created yet.</div>
              <div>• It is created, with compensation from the accepted offer, only after the candidate activates their account.</div>
            </div>

            {actionError && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  color: "#b91c1c",
                  fontSize: "12px",
                  marginBottom: "16px",
                }}
              >
                {actionError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setShowApproveModal(false)}
                disabled={approving}
                style={{
                  padding: "8px 14px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  color: "#475569",
                  fontSize: "12px",
                  cursor: approving ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveSubmission}
                disabled={approving}
                style={{
                  padding: "8px 20px",
                  background: "#16a34a",
                  border: "none",
                  borderRadius: "6px",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: approving ? "not-allowed" : "pointer",
                }}
              >
                {approving ? "Sending Invitation..." : "Confirm & Send Account Setup Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Confirmation Modal */}
      {showRejectModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: "28px",
              borderRadius: "12px",
              maxWidth: "480px",
              width: "100%",
              border: "1px solid #e2e8f0",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#b91c1c", margin: "0 0 8px" }}>
              Reject Candidate Onboarding
            </h3>
            <p style={{ fontSize: "13px", color: "#475569", lineHeight: "1.5", margin: "0 0 16px" }}>
              Are you sure you want to reject the onboarding for{" "}
              <strong>{selectedSubmission.candidate?.fullName}</strong>? This action will invalidate their active
              onboarding link and prevent employee account creation.
            </p>

            <form onSubmit={handleRejectSubmission}>
              <div style={{ marginBottom: "18px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                  Rejection Reason <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Failed background verification; inconsistent credentials."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "13px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  disabled={rejecting}
                  style={{
                    padding: "8px 14px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    color: "#475569",
                    fontSize: "12px",
                    cursor: rejecting ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejecting}
                  style={{
                    padding: "8px 20px",
                    background: "#dc2626",
                    border: "none",
                    borderRadius: "6px",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: rejecting ? "not-allowed" : "pointer",
                  }}
                >
                  {rejecting ? "Rejecting..." : "Confirm Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

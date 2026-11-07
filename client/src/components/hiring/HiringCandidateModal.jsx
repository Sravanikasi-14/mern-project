import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { isRequestTimeoutError, postOfferLetterSend } from "../../services/api";
import { IconClose } from "../Icons";
import OnboardingSectionReviewBar, {
  SECTION_KEYS,
  SECTION_LABELS,
  allSectionsApproved,
} from "../OnboardingSectionReviewBar";
import {
  HIRING_STAGE_LABELS,
  OFFER_STATUS_BADGES,
  ONBOARDING_STATUS_BADGES,
  STAGE_BADGES,
  defaultTabForStage,
  formatDate,
  formatDateTime,
} from "../../utils/hiringStage";

export const MODAL_TABS = [
  { key: "overview", label: "Overview" },
  { key: "offer", label: "Offer" },
  { key: "onboarding", label: "Onboarding" },
  { key: "account", label: "Account Setup" },
  { key: "timeline", label: "Timeline" },
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

const HR_SIGNATURE_REQUIRED_MESSAGE =
  "Add your HR signature in Settings before sending offer letters.";

const DRAFT_STATUSES = ["PENDING", "IN_PROGRESS", "DRAFT"];
const ACCOUNT_STATUSES = ["APPROVED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING"];

function Badge({ badge, children }) {
  const b = badge || { bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" };
  return (
    <span className="hw-badge" style={{ background: b.bg, color: b.color, borderColor: b.border }}>
      {children}
    </span>
  );
}

function SkeletonLines({ rows = 3 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="hw-skel" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

function maskValue(value, reveal) {
  if (!value) return "N/A";
  return reveal ? value : `••••${String(value).slice(-4)}`;
}

function errorText(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

/**
 * ONE detail modal for the whole hiring lifecycle.
 *
 * Opens immediately from the light list row. Everything heavier loads in the background:
 *   - GET /hiring/candidates/:offerId        light summary (on open)
 *   - GET /offer-letters/:id                 offer HTML — only once the Offer / Timeline tab is opened
 *   - GET /onboarding/submissions/:userId    section field data — only once Onboarding / Timeline tab is opened
 */
export default function HiringCandidateModal({
  offerId,
  row,
  initialTab,
  liveTick = 0,
  liveSubmissionId = "",
  onClose,
  onChanged,
}) {
  const [tab, setTab] = useState(initialTab || defaultTabForStage(row?.stage));
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [offer, setOffer] = useState({ status: "idle", data: null, error: "" });
  const [onb, setOnb] = useState({ status: "idle", data: null, error: "" });

  const [notice, setNotice] = useState(null); // { type: "success" | "error", text }
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState(null); // { type, section?, decision? }
  const [dialogText, setDialogText] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [reveal, setReveal] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const aliveRef = useRef(true);
  const submissionIdRef = useRef(null);
  const onbStatusRef = useRef("idle");

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Light header data: summary fields override the list row once they arrive.
  const view = useMemo(() => ({ ...(row || {}), ...(summary || {}) }), [row, summary]);
  const submissionId = view.candidateUserId ? String(view.candidateUserId) : "";
  const hasOnboarding = Boolean(submissionId && (view.onboardingStatus || summary?.onboarding));
  submissionIdRef.current = submissionId;
  onbStatusRef.current = onb.status;

  const onboardingStatus = onb.data?.status || view.onboardingStatus || null;
  const sectionStatuses = view.onboarding?.sectionStatuses || row?.sectionStatuses || null;
  const sectionReviews = useMemo(() => {
    if (onb.data?.sectionReviews) return onb.data.sectionReviews;
    const reviews = {};
    for (const key of SECTION_KEYS) {
      reviews[key] = { status: sectionStatuses?.[key] || "NOT_SUBMITTED" };
    }
    return reviews;
  }, [onb.data, sectionStatuses]);
  const everySectionApproved = allSectionsApproved(sectionReviews);
  const canReviewSections = ["SUBMITTED", "CHANGES_REQUESTED"].includes(onboardingStatus);

  // ---------- loaders ----------
  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get(`/hiring/candidates/${offerId}`);
      if (!aliveRef.current) return;
      setSummary(res.data.candidate);
      setSummaryError("");
    } catch (err) {
      if (aliveRef.current) setSummaryError(errorText(err, "Couldn't load candidate summary."));
    }
  }, [offerId]);

  const fetchOffer = useCallback(async () => {
    setOffer((cur) => ({ ...cur, status: cur.data ? "ready" : "loading", error: "" }));
    try {
      const res = await api.get(`/offer-letters/${offerId}`);
      if (aliveRef.current) setOffer({ status: "ready", data: res.data.offerLetter, error: "" });
    } catch (err) {
      if (aliveRef.current) {
        setOffer((cur) => ({ ...cur, status: "error", error: errorText(err, "Couldn't load the offer letter.") }));
      }
    }
  }, [offerId]);

  const fetchOnboarding = useCallback(async ({ silent = false } = {}) => {
    const id = submissionIdRef.current;
    if (!id) return;
    if (!silent) setOnb((cur) => ({ ...cur, status: cur.data ? "ready" : "loading", error: "" }));
    try {
      const res = await api.get(`/onboarding/submissions/${id}`);
      if (aliveRef.current) setOnb({ status: "ready", data: res.data.submission, error: "" });
    } catch (err) {
      if (aliveRef.current && !silent) {
        setOnb((cur) => ({ ...cur, status: "error", error: errorText(err, "Couldn't load onboarding details.") }));
      }
    }
  }, []);

  // Open immediately, then fetch the light summary in the background.
  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Lazy tab data
  useEffect(() => {
    if ((tab === "offer" || tab === "timeline") && offer.status === "idle") fetchOffer();
  }, [tab, offer.status, fetchOffer]);

  useEffect(() => {
    if ((tab === "onboarding" || tab === "timeline") && onb.status === "idle" && hasOnboarding) {
      fetchOnboarding();
    }
  }, [tab, onb.status, hasOnboarding, fetchOnboarding]);

  // Live update for THIS candidate: refetch the light SUMMARY (+ onboarding detail if already loaded).
  // Never refetch the offer HTML.
  useEffect(() => {
    if (!liveTick) return;
    if (!liveSubmissionId || String(liveSubmissionId) !== submissionIdRef.current) return;
    fetchSummary();
    if (onbStatusRef.current === "ready") fetchOnboarding({ silent: true });
  }, [liveTick, liveSubmissionId, fetchSummary, fetchOnboarding]);

  // Esc closes (unless a dialog is open)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (dialog) {
        if (!busy) setDialog(null);
      } else if (!busy) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, busy, onClose]);

  const reload = useCallback(
    async ({ offerToo = false } = {}) => {
      await fetchSummary();
      if (onbStatusRef.current === "ready") await fetchOnboarding({ silent: true });
      if (offerToo) await fetchOffer();
      onChanged?.();
    },
    [fetchSummary, fetchOnboarding, fetchOffer, onChanged]
  );

  const flash = (type, text) => setNotice({ type, text });

  // ---------- offer actions ----------
  const handleSendOffer = async () => {
    setBusy("send");
    setNotice(null);
    try {
      const res = await postOfferLetterSend(offerId);
      if (!res.data?.success) throw new Error(res.data?.message || "Failed to send offer letter.");
      flash("success", res.data.message || `Offer letter sent to ${view.email}.`);
      await reload({ offerToo: true });
    } catch (err) {
      let text = errorText(err, "Failed to send offer letter.");
      if (err?.response?.data?.code === "HR_SIGNATURE_REQUIRED") text = HR_SIGNATURE_REQUIRED_MESSAGE;
      if (isRequestTimeoutError(err)) {
        text =
          "The send request timed out while waiting for the mail server. The email may still have been sent — check the delivery status before retrying.";
      }
      flash("error", text);
      await reload({ offerToo: true }).catch(() => {});
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleWithdraw = async () => {
    const reason = dialogText.trim();
    if (reason.length < 3) {
      setDialogError("Enter a withdrawal reason (at least 3 characters).");
      return;
    }
    setBusy("withdraw");
    setDialogError("");
    try {
      const res = await api.post(`/offer-letters/${offerId}/withdraw`, { reason });
      setDialog(null);
      setDialogText("");
      flash("success", res.data?.message || "Offer withdrawn. The candidate can no longer sign this offer.");
      await reload({ offerToo: true });
    } catch (err) {
      setDialogError(errorText(err, "Failed to withdraw offer letter."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleDownloadPdf = async () => {
    setBusy("pdf");
    setNotice(null);
    try {
      const response = await api.get(`/offer-letters/${offerId}/pdf`, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = (view.name || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.href = url;
      link.download = `Offer_Letter_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      flash("error", "Couldn't download offer letter. Please try again.");
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  // ---------- onboarding actions ----------
  const submitSectionDecision = async (section, decision, note) => {
    if (!submissionId) return;
    setBusy("section");
    setNotice(null);
    setDialogError("");
    try {
      const res = await api.post(`/onboarding/submissions/${submissionId}/sections/${section}/review`, {
        decision,
        note,
      });
      setDialog(null);
      setDialogText("");
      flash("success", res.data?.message || "Section updated.");
      if (onbStatusRef.current !== "ready") await fetchOnboarding();
      await reload();
    } catch (err) {
      const text = errorText(err, "Failed to update section review.");
      if (dialog) setDialogError(text);
      else flash("error", text);
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const openSectionDecision = (section, decision) => {
    if (decision === "APPROVE") {
      submitSectionDecision(section, "APPROVE", "");
      return;
    }
    setDialogText("");
    setDialogError("");
    setDialog({ type: "section", section, decision });
  };

  const handleRequestCorrections = async () => {
    if (!dialogText.trim()) {
      setDialogError("Please provide specific notes or reasons for the requested corrections.");
      return;
    }
    setBusy("corrections");
    setDialogError("");
    try {
      await api.post(`/onboarding/submissions/${submissionId}/request-corrections`, {
        reason: dialogText.trim(),
      });
      setDialog(null);
      setDialogText("");
      flash("success", "Correction request sent to candidate successfully.");
      await reload();
    } catch (err) {
      setDialogError(errorText(err, "Failed to request corrections."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleApprove = async () => {
    setBusy("approve");
    setDialogError("");
    try {
      const res = await api.post(`/onboarding/submissions/${submissionId}/approve`);
      setDialog(null);
      flash(
        "success",
        res.data?.message ||
          "Onboarding approved. Account setup invitation sent; the employee profile is created when the candidate activates their account."
      );
      await reload();
      setTab("account");
    } catch (err) {
      setDialogError(errorText(err, "Failed to approve onboarding."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleReject = async () => {
    if (!dialogText.trim()) {
      setDialogError("Please provide a reason for rejecting this candidate onboarding.");
      return;
    }
    setBusy("reject");
    setDialogError("");
    try {
      await api.post(`/onboarding/submissions/${submissionId}/reject`, { reason: dialogText.trim() });
      setDialog(null);
      setDialogText("");
      flash("success", "Candidate onboarding has been rejected.");
      await reload();
    } catch (err) {
      setDialogError(errorText(err, "Failed to reject candidate onboarding."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleResendActivation = async () => {
    setBusy("resend");
    setNotice(null);
    try {
      const res = await api.post(`/onboarding/submissions/${submissionId}/resend-activation`);
      flash("success", res.data?.message || "Account setup invitation resent successfully.");
      await reload();
    } catch (err) {
      flash("error", errorText(err, "Failed to resend activation email."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const fetchDocumentBlob = async (doc) => {
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId || !submissionId) return null;
    setDownloadingDocId(docId);
    try {
      const response = await api.get(
        `/onboarding/submissions/${submissionId}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const mimeType = response.headers["content-type"] || "application/octet-stream";
      return new Blob([response.data], { type: mimeType });
    } catch (err) {
      flash("error", `Failed to load document: ${errorText(err, "request failed")}`);
      return null;
    } finally {
      if (aliveRef.current) setDownloadingDocId(null);
    }
  };

  const handleViewDocument = async (doc) => {
    const blob = await fetchDocumentBlob(doc);
    if (!blob) return;
    const url = window.URL.createObjectURL(blob);
    if (!window.open(url, "_blank")) {
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", doc.fileName || doc.title || "document");
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  };

  const handleDownloadDocument = async (doc) => {
    const blob = await fetchDocumentBlob(doc);
    if (!blob) return;
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", doc.fileName || doc.title || "document");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  };

  // ---------- derived ----------
  const stageLabel = HIRING_STAGE_LABELS[view.stage] || view.stage || "—";
  const offerBadge = OFFER_STATUS_BADGES[view.offerStatus];
  const onbBadge = ONBOARDING_STATUS_BADGES[onboardingStatus];
  const actions = summary?.nextActions || null;
  const offerInfo = summary?.offer || null;
  const onbSummary = summary?.onboarding || null;
  const isFinalApproved = ["APPROVED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING", "ACTIVATED"].includes(onboardingStatus);
  const approvedCount = SECTION_KEYS.filter((k) => sectionReviews[k]?.status === "APPROVED").length;
  const employeeId = view.employeeId ? String(view.employeeId) : "";

  const timeline = useMemo(() => {
    const events = [];
    for (const h of onb.data?.history || []) {
      events.push({
        at: h.timestamp,
        title: String(h.action || "").replace(/_/g, " "),
        note: h.notes,
        source: h.actorRole === "CANDIDATE" ? "Candidate" : "Onboarding",
      });
    }
    const o = offer.data;
    if (o) {
      if (o.createdAt) events.push({ at: o.createdAt, title: "Offer created", source: "Offer" });
      for (const h of o.emailDelivery?.history || []) {
        events.push({
          at: h.sentAt,
          title: `Offer email ${String(h.status || "sent").toLowerCase().replace(/_/g, " ")}`,
          note: [h.recipient, h.error].filter(Boolean).join(" — "),
          source: "Offer",
        });
      }
      if (o.signature?.signedAt) {
        events.push({
          at: o.signature.signedAt,
          title: `Offer signed${o.signature.signerName ? ` by ${o.signature.signerName}` : ""}`,
          source: "Offer",
        });
      } else if (o.decisionAt) {
        events.push({ at: o.decisionAt, title: `Offer ${String(o.status || "").toLowerCase()}`, source: "Offer" });
      }
      if (o.withdrawal?.withdrawnAt) {
        events.push({ at: o.withdrawal.withdrawnAt, title: "Offer withdrawn", note: o.withdrawal.reason, source: "Offer" });
      }
    }
    return events
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [onb.data, offer.data]);

  // ---------- render helpers ----------
  const renderSectionBody = (section) => {
    const d = onb.data;
    if (!d) {
      return onb.status === "error" ? null : <SkeletonLines rows={2} />;
    }
    switch (section) {
      case "personalDetails":
        return (
          <dl className="hw-grid">
            <div><dt>Full name</dt><dd>{d.personalDetails?.fullName || d.candidate?.fullName || "N/A"}</dd></div>
            <div><dt>Phone</dt><dd>{d.personalDetails?.phoneNumber || "N/A"}</dd></div>
            <div><dt>Date of birth</dt><dd>{d.personalDetails?.dateOfBirth ? formatDate(d.personalDetails.dateOfBirth) : "N/A"}</dd></div>
            <div><dt>Gender</dt><dd>{d.personalDetails?.gender || "N/A"}</dd></div>
          </dl>
        );
      case "residentialAddress": {
        const a = d.residentialAddress || {};
        const text = [a.street, a.city, a.state].filter(Boolean).join(", ") + (a.postalCode ? ` - ${a.postalCode}` : "");
        return <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{a.street ? text : "Address not provided"}</div>;
      }
      case "emergencyContact":
        return (
          <dl className="hw-grid">
            <div><dt>Name</dt><dd>{d.emergencyContact?.name || "N/A"}</dd></div>
            <div><dt>Relationship</dt><dd>{d.emergencyContact?.relationship || "N/A"}</dd></div>
            <div><dt>Phone</dt><dd>{d.emergencyContact?.phone || "N/A"}</dd></div>
          </dl>
        );
      case "bankAndTax":
        return (
          <dl className="hw-grid">
            <div><dt>Bank</dt><dd>{d.bankDetails?.bankName || "N/A"}</dd></div>
            <div><dt>Account number</dt><dd>{maskValue(d.bankDetails?.accountNumber, reveal)}</dd></div>
            <div><dt>IFSC</dt><dd>{d.bankDetails?.ifscCode || "N/A"}</dd></div>
            <div><dt>PAN / Tax ID</dt><dd>{maskValue(d.taxDetails?.panNumber, reveal)}</dd></div>
          </dl>
        );
      case "documents": {
        const docs = d.documents || [];
        if (docs.length === 0) return <span style={{ fontSize: 12, color: "#94a3b8" }}>No documents uploaded.</span>;
        return (
          <div>
            {docs.map((doc) => {
              const docId = doc._id || doc.id || doc.storageKey;
              const loading = downloadingDocId === docId;
              return (
                <div key={docId} className="hw-doc">
                  <div>
                    <strong style={{ fontSize: 12, display: "block" }}>{doc.title || doc.fileName}</strong>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {doc.documentType} • {((doc.fileSize || 0) / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button type="button" className="hw-link-btn" disabled={loading} onClick={() => handleViewDocument(doc)}>
                      {loading ? "Loading..." : "View"}
                    </button>
                    <button type="button" className="hw-btn hw-btn-sm" disabled={loading} onClick={() => handleDownloadDocument(doc)}>
                      Download
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      default:
        return null;
    }
  };

  const renderOverview = () => (
    <>
      <div className="hw-stats">
        <div className="hw-stat">
          <div className="hw-stat-label">Stage</div>
          <div className="hw-stat-value" style={{ fontSize: 15 }}>{stageLabel}</div>
        </div>
        <div className="hw-stat">
          <div className="hw-stat-label">Offer</div>
          <div className="hw-stat-value" style={{ fontSize: 15 }}>{offerBadge?.label || view.offerStatus || "—"}</div>
        </div>
        <div className="hw-stat">
          <div className="hw-stat-label">Onboarding</div>
          <div className="hw-stat-value" style={{ fontSize: 15 }}>{onbBadge?.label || (hasOnboarding ? onboardingStatus : "Not started")}</div>
        </div>
        <div className="hw-stat">
          <div className="hw-stat-label">Sections approved</div>
          <div className="hw-stat-value">{hasOnboarding ? `${approvedCount}/${SECTION_KEYS.length}` : "—"}</div>
        </div>
        <div className="hw-stat">
          <div className="hw-stat-label">Pending review</div>
          <div className="hw-stat-value">{hasOnboarding ? view.sectionsPendingCount ?? 0 : "—"}</div>
        </div>
        <div className="hw-stat">
          <div className="hw-stat-label">Documents</div>
          <div className="hw-stat-value">{view.docsCount ?? 0}</div>
        </div>
      </div>

      <div className="hw-card">
        <h4>Role & offer</h4>
        <dl className="hw-grid">
          <div><dt>Position</dt><dd>{view.position || "—"}</dd></div>
          <div><dt>Department</dt><dd>{offerInfo?.department || view.department || "—"}</dd></div>
          <div>
            <dt>Monthly compensation</dt>
            <dd>{view.monthlySalary != null ? `₹${Number(view.monthlySalary).toLocaleString("en-IN")}` : "—"}</dd>
          </div>
          <div><dt>Joining date</dt><dd>{formatDate(view.joiningDate)}</dd></div>
        </dl>
      </div>

      <div className="hw-card">
        <h4>Next actions</h4>
        {!actions ? (
          summaryError ? <span style={{ color: "#b91c1c" }}>{summaryError}</span> : <SkeletonLines rows={2} />
        ) : (
          <div className="hw-foot-group">
            {actions.canSendOffer && (
              <button type="button" className="hw-btn hw-btn-primary hw-btn-sm" onClick={() => setTab("offer")}>Send offer</button>
            )}
            {actions.canResendOffer && (
              <button type="button" className="hw-btn hw-btn-sm" onClick={() => setTab("offer")}>Resend or withdraw offer</button>
            )}
            {actions.canReviewOnboarding && (
              <button type="button" className="hw-btn hw-btn-primary hw-btn-sm" onClick={() => setTab("onboarding")}>
                {view.stage === "CORRECTIONS" ? "View corrections" : "Review onboarding"}
              </button>
            )}
            {actions.canResendActivation && (
              <button type="button" className="hw-btn hw-btn-sm" onClick={() => setTab("account")}>Account setup</button>
            )}
            {!actions.canSendOffer &&
              !actions.canResendOffer &&
              !actions.canReviewOnboarding &&
              !actions.canResendActivation && (
                <span style={{ color: "#64748b" }}>
                  {view.stage === "ONBOARDING"
                    ? "Waiting for the candidate to complete and submit onboarding."
                    : view.stage === "COMPLETED"
                    ? "Complete — the employee profile exists."
                    : "No action needed right now."}
                </span>
              )}
          </div>
        )}
      </div>
    </>
  );

  const renderOffer = () => {
    const delivery = offerInfo?.emailDelivery;
    return (
      <>
        <div className="hw-card">
          <h4>Offer details</h4>
          <dl className="hw-grid">
            <div><dt>Status</dt><dd>{offerBadge?.label || view.offerStatus || "—"}</dd></div>
            <div><dt>Position</dt><dd>{view.position || "—"}</dd></div>
            <div><dt>Work location</dt><dd>{offerInfo?.workLocation || "—"}</dd></div>
            <div><dt>Employment type</dt><dd>{offerInfo?.employmentType || "—"}</dd></div>
            <div>
              <dt>Email delivery</dt>
              <dd>
                {(delivery?.status || view.emailDeliveryStatus || "NOT_SENT").replace(/_/g, " ")}
                {delivery?.sentAt ? ` · ${formatDateTime(delivery.sentAt)}` : ""}
                {delivery?.attempts ? ` · ${delivery.attempts} attempt${delivery.attempts > 1 ? "s" : ""}` : ""}
              </dd>
            </div>
            <div>
              <dt>Signed</dt>
              <dd>
                {offerInfo?.signature?.signedAt
                  ? `${offerInfo.signature.signerName || "Candidate"} · ${formatDateTime(offerInfo.signature.signedAt)}`
                  : "Not signed"}
              </dd>
            </div>
          </dl>
          {delivery?.error && delivery.status === "DELIVERY_FAILED" && (
            <div className="hw-alert hw-alert-error" style={{ marginTop: 10, marginBottom: 0 }}>{delivery.error}</div>
          )}
        </div>

        <div className="hw-foot-group" style={{ marginBottom: 14 }}>
          {(actions?.canSendOffer || actions?.canResendOffer || ["DRAFT", "SENT"].includes(view.offerStatus)) && (
            <button
              type="button"
              className="hw-btn hw-btn-primary"
              disabled={Boolean(busy)}
              onClick={handleSendOffer}
            >
              {busy === "send" ? "Sending..." : view.offerStatus === "DRAFT" ? "Send offer" : "Resend offer"}
            </button>
          )}
          {(actions?.canWithdrawOffer || view.offerStatus === "SENT") && (
            <button
              type="button"
              className="hw-btn hw-btn-danger"
              disabled={Boolean(busy)}
              onClick={() => {
                setDialogText("");
                setDialogError("");
                setDialog({ type: "withdraw" });
              }}
            >
              Withdraw offer
            </button>
          )}
          {view.offerStatus && view.offerStatus !== "DRAFT" && (
            <button type="button" className="hw-btn" disabled={Boolean(busy)} onClick={handleDownloadPdf}>
              {busy === "pdf" ? "Preparing..." : "Download PDF"}
            </button>
          )}
          {view.offerStatus === "DRAFT" && (
            <Link className="hw-btn" to={`/admin/hiring?compose=1&editOfferId=${encodeURIComponent(offerId)}`}>
              Edit draft
            </Link>
          )}
        </div>

        <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Document preview</h4>
        {offer.status === "loading" || offer.status === "idle" ? (
          <div className="hw-offer-frame" style={{ padding: 18 }}><SkeletonLines rows={8} /></div>
        ) : offer.status === "error" ? (
          <div className="hw-alert hw-alert-error">
            {offer.error}{" "}
            <button type="button" className="hw-link-btn" onClick={fetchOffer}>Retry</button>
          </div>
        ) : (
          <iframe
            className="hw-offer-frame"
            title="Offer letter preview"
            sandbox=""
            srcDoc={offer.data?.content || "<p style='font-family:sans-serif;color:#64748b'>No document content.</p>"}
          />
        )}
      </>
    );
  };

  const renderOnboarding = () => {
    if (!hasOnboarding) {
      return (
        <div className="hw-alert hw-alert-info">
          {view.offerStatus === "ACCEPTED"
            ? "No onboarding record is linked to this offer (it may have been accepted outside the candidate portal)."
            : "Onboarding starts after the candidate signs the offer in the portal."}
        </div>
      );
    }
    const detail = onb.data;
    return (
      <>
        {onb.status === "error" && (
          <div className="hw-alert hw-alert-error">
            {onb.error}{" "}
            <button type="button" className="hw-link-btn" onClick={() => fetchOnboarding()}>Retry</button>
          </div>
        )}

        {onboardingStatus === "CHANGES_REQUESTED" && (
          <div className="hw-banner" style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#78350f" }}>
            <strong className="hw-banner-title" style={{ color: "#92400e" }}>Updates requested from candidate</strong>
            {detail?.correctionReason || onbSummary?.correctionReason || "Candidate has been asked to update their onboarding submission."}
          </div>
        )}
        {onboardingStatus === "REJECTED" && (
          <div className="hw-banner" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#7f1d1d" }}>
            <strong className="hw-banner-title" style={{ color: "#991b1b" }}>Candidate onboarding rejected</strong>
            {detail?.rejectionReason || "Candidate onboarding was rejected by HR."}
          </div>
        )}
        {isFinalApproved && (
          <div className="hw-banner" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}>
            <strong className="hw-banner-title" style={{ color: "#166534" }}>
              {onboardingStatus === "ACTIVATED" ? "Account activated" : "Approved — awaiting account setup"}
            </strong>
            HR approval is frozen. The employee profile is created only after the candidate activates their account.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button type="button" className="hw-btn hw-btn-sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? "Mask numbers" : "Reveal numbers"}
          </button>
        </div>

        {SECTION_KEYS.map((section) => (
          <div className="hw-section" key={section}>
            <h4>
              {SECTION_LABELS[section]}
              {section === "documents" ? ` (${detail?.documents?.length ?? view.docsCount ?? 0})` : ""}
            </h4>
            <OnboardingSectionReviewBar
              section={section}
              review={sectionReviews[section]}
              canReview={canReviewSections && Boolean(detail)}
              busy={busy === "section"}
              onDecision={openSectionDecision}
            />
            {renderSectionBody(section)}
          </div>
        ))}
      </>
    );
  };

  const renderAccount = () => {
    if (!hasOnboarding) {
      return <div className="hw-alert hw-alert-info">Account setup begins once HR gives final approval to the candidate's onboarding.</div>;
    }
    const invited = ACCOUNT_STATUSES.includes(onboardingStatus) || onboardingStatus === "ACTIVATED";
    return (
      <>
        <div className="hw-card">
          <h4>Invitation</h4>
          <dl className="hw-grid">
            <div><dt>Status</dt><dd>{onbBadge?.label || onboardingStatus || "—"}</dd></div>
            <div><dt>Invitation sent</dt><dd>{onbSummary?.invitationSentAt ? formatDateTime(onbSummary.invitationSentAt) : invited ? "Not delivered" : "Not yet"}</dd></div>
            <div><dt>Approved</dt><dd>{onbSummary?.approvedAt ? formatDateTime(onbSummary.approvedAt) : "—"}</dd></div>
            <div><dt>Account activated</dt><dd>{onbSummary?.accountActivatedAt ? formatDateTime(onbSummary.accountActivatedAt) : "Not yet"}</dd></div>
          </dl>
        </div>
        {onboardingStatus === "ACTIVATED" || employeeId ? (
          <div className="hw-banner" style={{ background: "#ecfeff", border: "1px solid #a5f3fc", color: "#155e75" }}>
            <strong className="hw-banner-title">Employee profile created</strong>
            The candidate activated their account.{" "}
            {employeeId && <Link to={`/admin/employees/${employeeId}`} style={{ fontWeight: 600 }}>View in People Management →</Link>}
          </div>
        ) : invited ? (
          <div className="hw-banner" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}>
            <strong className="hw-banner-title" style={{ color: "#166534" }}>Waiting for candidate activation</strong>
            An account setup invitation was issued. The employee profile is created only after the candidate activates their account.
          </div>
        ) : (
          <div className="hw-alert hw-alert-info">
            The invitation is sent automatically on final HR approval. Complete the Onboarding review first.
          </div>
        )}
        {(actions?.canResendActivation || ACCOUNT_STATUSES.includes(onboardingStatus)) && (
          <button type="button" className="hw-btn hw-btn-primary" disabled={Boolean(busy)} onClick={handleResendActivation}>
            {busy === "resend" ? "Resending..." : "Resend account setup invitation"}
          </button>
        )}
      </>
    );
  };

  const renderTimeline = () => {
    const loading = offer.status === "loading" || onb.status === "loading" || offer.status === "idle";
    return (
      <>
        {loading && <SkeletonLines rows={4} />}
        {!loading && timeline.length === 0 && <div className="hw-empty">No activity recorded yet.</div>}
        <ul className="hw-timeline">
          {timeline.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <strong>{e.title}</strong>
              <div className="hw-tl-meta">{e.source} · {formatDateTime(e.at)}</div>
              {e.note && <div style={{ color: "#475569", marginTop: 2 }}>{e.note}</div>}
            </li>
          ))}
        </ul>
        {onb.data?.historyTotal > (onb.data?.history?.length || 0) && (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            Showing the latest {onb.data.history.length} of {onb.data.historyTotal} onboarding events.
          </div>
        )}
      </>
    );
  };

  // ---------- footer actions (onboarding tab) ----------
  const renderFooter = () => {
    if (tab !== "onboarding" || !hasOnboarding || onb.status === "idle") return null;
    const openReject = () => {
      setDialogText("");
      setDialogError("");
      setDialog({ type: "reject" });
    };
    const openCorrections = (prefill = "") => {
      setDialogText(prefill);
      setDialogError("");
      setDialog({ type: "corrections" });
    };
    if (onboardingStatus === "SUBMITTED") {
      return (
        <div className="hw-modal-foot">
          <button type="button" className="hw-btn hw-btn-danger" disabled={Boolean(busy)} onClick={openReject}>Reject candidate</button>
          <div className="hw-foot-group">
            <button type="button" className="hw-btn hw-btn-warn" disabled={Boolean(busy)} onClick={() => openCorrections()}>Request corrections</button>
            <button
              type="button"
              className="hw-btn hw-btn-primary"
              disabled={!everySectionApproved || Boolean(busy)}
              title={everySectionApproved ? "Freeze approval and send the account setup email" : "Approve every section first"}
              onClick={() => {
                setDialogError("");
                setDialog({ type: "approve" });
              }}
            >
              Final approve & send account setup
            </button>
          </div>
        </div>
      );
    }
    if (onboardingStatus === "CHANGES_REQUESTED") {
      return (
        <div className="hw-modal-foot">
          <button type="button" className="hw-btn hw-btn-danger" disabled={Boolean(busy)} onClick={openReject}>Reject candidate</button>
          <div className="hw-foot-group">
            <span style={{ fontSize: 12, color: "#b45309", fontWeight: 500 }}>Awaiting candidate updates</span>
            <button type="button" className="hw-btn hw-btn-warn" disabled={Boolean(busy)} onClick={() => openCorrections(onb.data?.correctionReason || "")}>
              Update correction request
            </button>
          </div>
        </div>
      );
    }
    if (DRAFT_STATUSES.includes(onboardingStatus)) {
      return (
        <div className="hw-modal-foot">
          <span style={{ fontSize: 12, color: "#64748b" }}>Draft in progress (not yet submitted for review)</span>
          <button type="button" className="hw-btn hw-btn-danger hw-btn-sm" disabled={Boolean(busy)} onClick={openReject}>Reject candidate</button>
        </div>
      );
    }
    return null;
  };

  // ---------- dialogs ----------
  const renderDialog = () => {
    if (!dialog) return null;
    let content = null;
    if (dialog.type === "section") {
      const copy = SECTION_DECISION_COPY[dialog.decision];
      content = (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!dialogText.trim()) {
              setDialogError("A note is required when rejecting a section or requesting a correction.");
              return;
            }
            submitSectionDecision(dialog.section, dialog.decision, dialogText.trim());
          }}
        >
          <h3>{copy.title}</h3>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>{SECTION_LABELS[dialog.section]}</div>
          <p>{copy.help}</p>
          <textarea rows={4} autoFocus value={dialogText} onChange={(e) => setDialogText(e.target.value)} placeholder={copy.placeholder} />
          {dialogError && <div className="hw-alert hw-alert-error">{dialogError}</div>}
          <div className="hw-dialog-actions">
            <button type="button" className="hw-btn" disabled={busy === "section"} onClick={() => setDialog(null)}>Cancel</button>
            <button type="submit" className="hw-btn" disabled={busy === "section"} style={{ background: copy.color, color: "#fff", borderColor: copy.color }}>
              {busy === "section" ? "Saving..." : copy.submit}
            </button>
          </div>
        </form>
      );
    } else if (dialog.type === "corrections") {
      content = (
        <form onSubmit={(e) => { e.preventDefault(); handleRequestCorrections(); }}>
          <h3>Request onboarding corrections</h3>
          <p>Specify the fields or documents the candidate needs to correct. An email with a secure link will be sent.</p>
          <textarea rows={4} autoFocus value={dialogText} onChange={(e) => setDialogText(e.target.value)} placeholder="e.g. Please upload a clear copy of your address proof." />
          {dialogError && <div className="hw-alert hw-alert-error">{dialogError}</div>}
          <div className="hw-dialog-actions">
            <button type="button" className="hw-btn" disabled={busy === "corrections"} onClick={() => setDialog(null)}>Cancel</button>
            <button type="submit" className="hw-btn hw-btn-warn" disabled={busy === "corrections"}>{busy === "corrections" ? "Sending..." : "Send request"}</button>
          </div>
        </form>
      );
    } else if (dialog.type === "reject") {
      content = (
        <form onSubmit={(e) => { e.preventDefault(); handleReject(); }}>
          <h3 style={{ color: "#b91c1c" }}>Reject candidate onboarding</h3>
          <p>
            Reject onboarding for <strong>{view.name}</strong>? This invalidates their active onboarding link and prevents employee account creation.
          </p>
          <textarea rows={4} autoFocus value={dialogText} onChange={(e) => setDialogText(e.target.value)} placeholder="e.g. Failed background verification." />
          {dialogError && <div className="hw-alert hw-alert-error">{dialogError}</div>}
          <div className="hw-dialog-actions">
            <button type="button" className="hw-btn" disabled={busy === "reject"} onClick={() => setDialog(null)}>Cancel</button>
            <button type="submit" className="hw-btn" disabled={busy === "reject"} style={{ background: "#dc2626", color: "#fff", borderColor: "#dc2626" }}>
              {busy === "reject" ? "Rejecting..." : "Confirm rejection"}
            </button>
          </div>
        </form>
      );
    } else if (dialog.type === "approve") {
      content = (
        <div>
          <h3>Final approval & account setup invitation</h3>
          <p>
            Give final approval for <strong>{view.name}</strong>? All sections are approved. This freezes the submission.
          </p>
          <div className="hw-card" style={{ lineHeight: 1.6 }}>
            <div>• An account setup email with a secure password link is sent to the candidate.</div>
            <div>• The employee profile is NOT created yet.</div>
            <div>• It is created, with compensation from the accepted offer, only after the candidate activates their account.</div>
          </div>
          {dialogError && <div className="hw-alert hw-alert-error">{dialogError}</div>}
          <div className="hw-dialog-actions">
            <button type="button" className="hw-btn" disabled={busy === "approve"} onClick={() => setDialog(null)}>Cancel</button>
            <button type="button" className="hw-btn hw-btn-primary" disabled={busy === "approve"} onClick={handleApprove}>
              {busy === "approve" ? "Sending invitation..." : "Confirm & send account setup email"}
            </button>
          </div>
        </div>
      );
    } else if (dialog.type === "withdraw") {
      content = (
        <form onSubmit={(e) => { e.preventDefault(); handleWithdraw(); }}>
          <h3>Withdraw offer</h3>
          <p>The candidate will no longer be able to sign this offer. The reason is kept internally and is not shown to the candidate.</p>
          <textarea rows={3} autoFocus value={dialogText} onChange={(e) => setDialogText(e.target.value)} placeholder="Reason for withdrawal" />
          {dialogError && <div className="hw-alert hw-alert-error">{dialogError}</div>}
          <div className="hw-dialog-actions">
            <button type="button" className="hw-btn" disabled={busy === "withdraw"} onClick={() => setDialog(null)}>Cancel</button>
            <button type="submit" className="hw-btn" disabled={busy === "withdraw"} style={{ background: "#dc2626", color: "#fff", borderColor: "#dc2626" }}>
              {busy === "withdraw" ? "Withdrawing..." : "Withdraw offer"}
            </button>
          </div>
        </form>
      );
    }
    return (
      <div className="hw-overlay is-top" role="presentation">
        <div className="hw-dialog" role="dialog" aria-modal="true">{content}</div>
      </div>
    );
  };

  const stageBadge = STAGE_BADGES[view.stage];

  return (
    <div
      className="hw-overlay"
      role="presentation"
      onClick={() => {
        if (!busy && !dialog) onClose();
      }}
    >
      <div
        className="hw-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Candidate hiring details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hw-modal-head">
          <div style={{ minWidth: 0 }}>
            <span className="hw-modal-eyebrow">Hiring & Onboarding</span>
            <h2>{view.name || "Candidate"}</h2>
            <span className="hw-modal-sub">
              {view.email}
              {view.position ? ` · ${view.position}` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge badge={stageBadge}>{stageLabel}</Badge>
            <button type="button" className="hw-close" aria-label="Close" onClick={onClose}>
              <IconClose size={18} />
            </button>
          </div>
        </div>

        <div className="hw-tabs" role="tablist">
          {MODAL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`hw-tab${tab === t.key ? " is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === "onboarding" && view.sectionsPendingCount > 0 ? ` (${view.sectionsPendingCount})` : ""}
            </button>
          ))}
        </div>

        <div className="hw-modal-body">
          {notice && (
            <div className={`hw-alert ${notice.type === "success" ? "hw-alert-success" : "hw-alert-error"}`} role="status">
              {notice.text}
            </div>
          )}
          {summaryError && !summary && tab !== "overview" && (
            <div className="hw-alert hw-alert-error">
              {summaryError}{" "}
              <button type="button" className="hw-link-btn" onClick={fetchSummary}>Retry</button>
            </div>
          )}
          {tab === "overview" && renderOverview()}
          {tab === "offer" && renderOffer()}
          {tab === "onboarding" && renderOnboarding()}
          {tab === "account" && renderAccount()}
          {tab === "timeline" && renderTimeline()}
        </div>

        {renderFooter()}
      </div>
      {renderDialog()}
    </div>
  );
}

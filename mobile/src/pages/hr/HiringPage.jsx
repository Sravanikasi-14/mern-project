import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../../hooks/useSmartBack";
import HrPortalHeader from "../../components/HrPortalHeader";
import StatusBadge from "../../components/StatusBadge";
import SegmentedTabs from "../../components/SegmentedTabs";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import SoftRefresh from "../../components/SoftRefresh";
import { useToast } from "../../components/Toast";
import { initialsFrom } from "../../components/SummaryRow";
import api, { isRequestTimeoutError, postOfferLetterSend } from "../../services/api";
import {
  blobFromAxiosResponse,
  documentErrorMessage,
  openDocument,
  saveDocument,
} from "../../services/documents";
import {
  HIRING_STAGE_CHIPS,
  HIRING_STAGE_LABELS,
  defaultTabForStage,
  formatDate,
  formatDateTime,
  normalizeStageParam,
  primaryActionForRow,
  stageFromLegacyStatus,
} from "../../utils/hiringStage";

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 20000;
const SEARCH_DEBOUNCE_MS = 300;

const SHEET_TABS = [
  { value: "overview", label: "Overview" },
  { value: "offer", label: "Offer" },
  { value: "onboarding", label: "Onboarding" },
  { value: "account", label: "Setup" },
  { value: "timeline", label: "Timeline" },
];

const SECTIONS = [
  { key: "personalDetails", label: "Personal details" },
  { key: "residentialAddress", label: "Residential address" },
  { key: "emergencyContact", label: "Emergency contact" },
  { key: "bankAndTax", label: "Bank & tax" },
  { key: "documents", label: "Documents" },
];

const SECTION_DECISION_COPY = {
  approve: { title: "Approve section", confirm: "Approve", message: "Lock this section as approved." },
  correction: { title: "Request correction", confirm: "Request correction", message: "The candidate will be asked to update only this section." },
  reject: { title: "Reject section", confirm: "Reject section", message: "The candidate must resubmit this section." },
};

const HR_SIGNATURE_REQUIRED_MESSAGE =
  "Save your electronic signature in Settings before sending offer letters.";

const SETUP_STATUSES = ["APPROVED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING"];
const DRAFT_STATUSES = ["PENDING", "IN_PROGRESS", "DRAFT"];

function maskTail(value) {
  const raw = String(value || "");
  if (!raw) return "—";
  if (raw.length <= 4) return "••••";
  return `••••${raw.slice(-4)}`;
}

function errText(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

function DetailRow({ label, value }) {
  return (
    <div className="ob-detail-row">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function DetailSection({ title, children, reviewBar }) {
  return (
    <section className="ob-detail-section">
      <h3 className="ob-detail-heading">{title}</h3>
      <div className="ob-detail-body">{children}</div>
      {reviewBar || null}
    </section>
  );
}

function SectionReviewBar({ review, canReview, busy, onDecision }) {
  const status = review?.status || "NOT_SUBMITTED";
  const actionable = ["PENDING_REVIEW", "RESUBMITTED", "REJECTED", "CORRECTION_REQUESTED", "APPROVED"].includes(status);
  return (
    <div className="ob-section-review" style={{ marginTop: 10 }}>
      <StatusBadge status={status} />
      {review?.note && ["CORRECTION_REQUESTED", "REJECTED"].includes(status) ? (
        <p className="caption" style={{ marginTop: 6 }}>HR note: {review.note}</p>
      ) : null}
      {canReview && actionable ? (
        <div className="row-actions" style={{ marginTop: 8 }}>
          {status !== "APPROVED" ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecision("APPROVE")}>Approve</button>
          ) : null}
          {status !== "CORRECTION_REQUESTED" ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDecision("REQUEST_CORRECTION")}>Correction</button>
          ) : null}
          {status !== "REJECTED" ? (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => onDecision("REJECT")}>Reject</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Progressive detail sheet. Opens instantly from the light list row; fetches in the background:
 *   summary (on open) -> offer HTML (Offer / Timeline tab) -> onboarding fields (Onboarding / Timeline tab).
 */
function HiringSheet({ offerId, row, initialTab, pollTick, onClose, onChanged }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab || defaultTabForStage(row?.stage));
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const [offer, setOffer] = useState({ status: "idle", data: null, error: "" });
  const [onb, setOnb] = useState({ status: "idle", data: null, error: "" });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [action, setAction] = useState(null); // corrections | reject | approve | section | withdraw
  const [sectionAction, setSectionAction] = useState(null);
  const [notes, setNotes] = useState("");
  const [showSensitive, setShowSensitive] = useState(false);
  const [docBusyId, setDocBusyId] = useState("");

  const aliveRef = useRef(true);
  const submissionIdRef = useRef("");
  const onbReadyRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const view = useMemo(() => ({ ...(row || {}), ...(summary || {}) }), [row, summary]);
  const submissionId = view.candidateUserId ? String(view.candidateUserId) : "";
  const hasOnboarding = Boolean(submissionId && (view.onboardingStatus || summary?.onboarding));
  submissionIdRef.current = submissionId;
  onbReadyRef.current = onb.status === "ready";

  const status = onb.data?.status || view.onboardingStatus || "";
  const sectionStatuses = view.onboarding?.sectionStatuses || row?.sectionStatuses || null;
  const sectionReviews = useMemo(() => {
    if (onb.data?.sectionReviews) return onb.data.sectionReviews;
    const reviews = {};
    for (const { key } of SECTIONS) reviews[key] = { status: sectionStatuses?.[key] || "NOT_SUBMITTED" };
    return reviews;
  }, [onb.data, sectionStatuses]);
  const everySectionApproved = SECTIONS.every(({ key }) => sectionReviews[key]?.status === "APPROVED");
  const canReviewSections = ["SUBMITTED", "CHANGES_REQUESTED"].includes(status) && Boolean(onb.data);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get(`/hiring/candidates/${offerId}`);
      if (!aliveRef.current) return;
      setSummary(res.data.candidate);
      setSummaryError("");
    } catch (err) {
      if (aliveRef.current) setSummaryError(errText(err, "Could not load candidate summary."));
    }
  }, [offerId]);

  const fetchOffer = useCallback(async () => {
    setOffer((cur) => ({ ...cur, status: cur.data ? "ready" : "loading", error: "" }));
    try {
      const res = await api.get(`/offer-letters/${offerId}`);
      if (aliveRef.current) setOffer({ status: "ready", data: res.data.offerLetter, error: "" });
    } catch (err) {
      if (aliveRef.current) setOffer((cur) => ({ ...cur, status: "error", error: errText(err, "Could not load the offer.") }));
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
        setOnb((cur) => ({ ...cur, status: "error", error: errText(err, "Could not load onboarding details.") }));
      }
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if ((tab === "offer" || tab === "timeline") && offer.status === "idle") fetchOffer();
  }, [tab, offer.status, fetchOffer]);

  useEffect(() => {
    if ((tab === "onboarding" || tab === "timeline") && onb.status === "idle" && hasOnboarding) fetchOnboarding();
  }, [tab, onb.status, hasOnboarding, fetchOnboarding]);

  // List poll tick: refresh only the LIGHT summary (never the offer HTML).
  useEffect(() => {
    if (!pollTick) return;
    fetchSummary();
    if (onbReadyRef.current) fetchOnboarding({ silent: true });
  }, [pollTick, fetchSummary, fetchOnboarding]);

  const reload = useCallback(
    async ({ offerToo = false } = {}) => {
      await fetchSummary();
      if (onbReadyRef.current) await fetchOnboarding({ silent: true });
      if (offerToo) await fetchOffer();
      onChanged?.();
    },
    [fetchSummary, fetchOnboarding, fetchOffer, onChanged]
  );

  const stageLabel = HIRING_STAGE_LABELS[view.stage] || view.stage || "";
  const actions = summary?.nextActions || null;
  const offerInfo = summary?.offer || null;
  const onbSummary = summary?.onboarding || null;
  const employeeId = view.employeeId ? String(view.employeeId) : "";

  // ---------- actions ----------
  const sendOffer = async () => {
    if (busy) return;
    setBusy("send");
    setActionError("");
    try {
      const res = await postOfferLetterSend(offerId);
      if (!res.data?.success) throw new Error(res.data?.message || "Could not send offer.");
      toast.push(res.data.message || `Offer sent to ${view.email}.`);
      await reload({ offerToo: true });
    } catch (err) {
      let text = errText(err, "Could not send offer.");
      if (err?.response?.data?.code === "HR_SIGNATURE_REQUIRED") text = HR_SIGNATURE_REQUIRED_MESSAGE;
      if (isRequestTimeoutError(err)) {
        text = "The send timed out. The email may still have been sent — check delivery status before retrying.";
      }
      setActionError(text);
      await reload({ offerToo: true }).catch(() => {});
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const downloadPdf = async (mode = "save") => {
    if (busy) return;
    setBusy("pdf");
    setActionError("");
    try {
      const response = await api.get(`/offer-letters/${offerId}/pdf`, { responseType: "blob" });
      const safe = (view.name || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
      const file = await blobFromAxiosResponse(response, `Offer_Letter_${safe}.pdf`);
      const payload = {
        ...file,
        mimeType: "application/pdf",
        blob: file.blob.type ? file.blob : new Blob([file.blob], { type: "application/pdf" }),
      };
      if (mode === "open") {
        await openDocument(payload);
      } else {
        await saveDocument(payload);
        toast.push("Offer PDF ready — use Save or Share.");
      }
    } catch (err) {
      setActionError(documentErrorMessage(err, "Could not download PDF."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const handleDocument = async (doc, mode = "open") => {
    if (!submissionId || docBusyId) return;
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId) return;
    try {
      setDocBusyId(String(docId));
      setActionError("");
      const response = await api.get(
        `/onboarding/submissions/${submissionId}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const file = await blobFromAxiosResponse(response, doc.fileName || doc.title || "document");
      if (mode === "save") {
        await saveDocument(file);
        toast.push("Document ready — use Save or Share.");
      } else {
        await openDocument(file);
      }
    } catch (err) {
      setActionError(documentErrorMessage(err, "Could not open this document."));
    } finally {
      if (aliveRef.current) setDocBusyId("");
    }
  };

  const startAction = (next, prefill = "") => {
    setActionError("");
    setNotes(prefill);
    setAction(next);
  };

  const closeAction = () => {
    setAction(null);
    setSectionAction(null);
    setActionError("");
  };

  const runAction = async () => {
    if (busy) return;
    if (["reject", "corrections", "withdraw"].includes(action) && !notes.trim()) {
      setActionError("A reason is required for this action.");
      return;
    }
    setBusy("action");
    setActionError("");
    try {
      if (action === "section" && sectionAction) {
        const { section, decision } = sectionAction;
        if (decision !== "APPROVE" && !notes.trim()) {
          setActionError("A note for the candidate is required for this decision.");
          return;
        }
        const res = await api.post(`/onboarding/submissions/${submissionId}/sections/${section}/review`, {
          decision,
          note: notes.trim(),
        });
        toast.push(res.data?.message || "Section updated.");
        if (!onbReadyRef.current) await fetchOnboarding();
      } else if (action === "approve") {
        const res = await api.post(`/onboarding/submissions/${submissionId}/approve`);
        toast.push(res.data?.message || "Approved. Account setup invitation sent.");
        setTab("account");
      } else if (action === "reject") {
        await api.post(`/onboarding/submissions/${submissionId}/reject`, { reason: notes.trim() });
        toast.push("Onboarding rejected.");
      } else if (action === "corrections") {
        await api.post(`/onboarding/submissions/${submissionId}/request-corrections`, { reason: notes.trim() });
        toast.push("Correction request sent.");
      } else if (action === "resend") {
        await api.post(`/onboarding/submissions/${submissionId}/resend-activation`);
        toast.push("Account setup invitation resent.");
      } else if (action === "withdraw") {
        await api.post(`/offer-letters/${offerId}/withdraw`, { reason: notes.trim() });
        toast.push("Offer withdrawn.");
      }
      setAction(null);
      setSectionAction(null);
      setNotes("");
      await reload({ offerToo: action === "withdraw" });
    } catch (err) {
      setActionError(errText(err, "Could not complete this action."));
    } finally {
      if (aliveRef.current) setBusy("");
    }
  };

  const renderReview = (key) => (
    <SectionReviewBar
      review={sectionReviews[key]}
      canReview={canReviewSections}
      busy={Boolean(busy)}
      onDecision={(decision) => {
        if (decision === "APPROVE") {
          setSectionAction({ section: key, decision });
          setNotes("");
          setAction("section");
          return;
        }
        setActionError("");
        setNotes("");
        setSectionAction({ section: key, decision });
        setAction("section");
      }}
    />
  );

  const sectionLabel = (key) => SECTIONS.find((s) => s.key === key)?.label || key;
  const sectionCopy =
    SECTION_DECISION_COPY[
      sectionAction?.decision === "APPROVE" ? "approve" : sectionAction?.decision === "REJECT" ? "reject" : "correction"
    ];

  const timeline = useMemo(() => {
    const events = [];
    for (const h of onb.data?.history || []) {
      events.push({ at: h.timestamp, title: String(h.action || "").replace(/_/g, " "), note: h.notes, source: "Onboarding" });
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
        events.push({ at: o.signature.signedAt, title: `Offer signed${o.signature.signerName ? ` by ${o.signature.signerName}` : ""}`, source: "Offer" });
      }
      if (o.withdrawal?.withdrawnAt) {
        events.push({ at: o.withdrawal.withdrawnAt, title: "Offer withdrawn", note: o.withdrawal.reason, source: "Offer" });
      }
    }
    return events.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [onb.data, offer.data]);

  // ---------- tab bodies ----------
  const renderOverview = () => (
    <>
      <DetailSection title="Pipeline">
        <DetailRow label="Stage" value={stageLabel} />
        <DetailRow label="Offer" value={view.offerStatus} />
        <DetailRow label="Onboarding" value={view.onboardingStatus || "Not started"} />
        <DetailRow label="Sections to review" value={hasOnboarding ? String(view.sectionsPendingCount ?? 0) : "—"} />
        <DetailRow label="Documents" value={String(view.docsCount ?? 0)} />
      </DetailSection>
      <DetailSection title="Role & offer">
        <DetailRow label="Position" value={view.position} />
        <DetailRow label="Department" value={offerInfo?.department || view.department} />
        <DetailRow
          label="Monthly compensation"
          value={view.monthlySalary != null ? `₹${Number(view.monthlySalary).toLocaleString("en-IN")}` : "—"}
        />
        <DetailRow label="Joining date" value={formatDate(view.joiningDate)} />
      </DetailSection>
      <DetailSection title="Next actions">
        {!actions ? (
          summaryError ? <p className="caption">{summaryError}</p> : <Skeleton rows={2} />
        ) : (
          <div className="row-actions">
            {(actions.canSendOffer || actions.canResendOffer) && (
              <button type="button" className="btn-primary" onClick={() => setTab("offer")}>
                {actions.canSendOffer ? "Send offer" : "Resend / withdraw"}
              </button>
            )}
            {actions.canReviewOnboarding && (
              <button type="button" className="btn-primary" onClick={() => setTab("onboarding")}>Review onboarding</button>
            )}
            {actions.canResendActivation && (
              <button type="button" className="btn-secondary" onClick={() => setTab("account")}>Account setup</button>
            )}
            {!actions.canSendOffer && !actions.canResendOffer && !actions.canReviewOnboarding && !actions.canResendActivation && (
              <p className="caption">
                {view.stage === "ONBOARDING" ? "Waiting for the candidate to submit onboarding." : "No action needed right now."}
              </p>
            )}
          </div>
        )}
      </DetailSection>
    </>
  );

  const renderOffer = () => {
    const delivery = offerInfo?.emailDelivery;
    return (
      <>
        <DetailSection title="Offer">
          <DetailRow label="Status" value={view.offerStatus} />
          <DetailRow label="Position" value={view.position} />
          <DetailRow
            label="Email delivery"
            value={`${(delivery?.status || view.emailDeliveryStatus || "NOT_SENT").replace(/_/g, " ")}${delivery?.sentAt ? ` · ${formatDateTime(delivery.sentAt)}` : ""}`}
          />
          <DetailRow
            label="Signed"
            value={offerInfo?.signature?.signedAt ? `${offerInfo.signature.signerName || "Candidate"} · ${formatDate(offerInfo.signature.signedAt)}` : "Not signed"}
          />
        </DetailSection>
        <div className="row-actions" style={{ margin: "8px 0 12px" }}>
          {["DRAFT", "SENT"].includes(view.offerStatus) && (
            <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={sendOffer}>
              {busy === "send" ? "Sending…" : view.offerStatus === "DRAFT" ? "Send offer" : "Resend offer"}
            </button>
          )}
          {view.offerStatus === "SENT" && (
            <button type="button" className="btn-danger" disabled={Boolean(busy)} onClick={() => startAction("withdraw")}>Withdraw</button>
          )}
          {view.offerStatus && view.offerStatus !== "DRAFT" && (
            <>
              <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => downloadPdf("open")}>Open PDF</button>
              <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => downloadPdf("save")}>Share PDF</button>
            </>
          )}
          {view.offerStatus === "DRAFT" && (
            <button type="button" className="btn-secondary" onClick={() => navigate("/admin/hiring/offer-editor")}>Edit draft</button>
          )}
        </div>
        {offer.status === "loading" || offer.status === "idle" ? (
          <Skeleton rows={4} />
        ) : offer.status === "error" ? (
          <ErrorState message={offer.error} onRetry={fetchOffer} />
        ) : (
          <iframe
            title="Offer letter preview"
            sandbox=""
            srcDoc={offer.data?.content || "<p>No document content.</p>"}
            style={{ width: "100%", height: 420, border: "1px solid #e6ede8", borderRadius: 8, background: "#fff" }}
          />
        )}
      </>
    );
  };

  const renderOnboarding = () => {
    if (!hasOnboarding) {
      return (
        <p className="caption">
          {view.offerStatus === "ACCEPTED"
            ? "No onboarding record is linked to this offer."
            : "Onboarding starts after the candidate signs the offer."}
        </p>
      );
    }
    const d = onb.data;
    return (
      <>
        {onb.status === "error" ? <ErrorState message={onb.error} onRetry={() => fetchOnboarding()} /> : null}
        {status === "CHANGES_REQUESTED" ? (
          <div className="alert alert-warn">
            Corrections requested: {d?.correctionReason || onbSummary?.correctionReason || "Candidate must update their submission."}
          </div>
        ) : null}
        {status === "REJECTED" ? (
          <div className="alert alert-error">Rejected: {d?.rejectionReason || "No reason recorded."}</div>
        ) : null}
        {["APPROVED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING", "ACTIVATED"].includes(status) ? (
          <div className="alert alert-ok">Approved. The employee profile is created only after the candidate activates their account.</div>
        ) : null}

        <DetailSection title="Personal details" reviewBar={renderReview("personalDetails")}>
          {d ? (
            <>
              <DetailRow label="Full name" value={d.personalDetails?.fullName || d.candidate?.fullName} />
              <DetailRow label="Phone" value={d.personalDetails?.phoneNumber} />
              <DetailRow label="Date of birth" value={formatDate(d.personalDetails?.dateOfBirth)} />
              <DetailRow label="Gender" value={d.personalDetails?.gender} />
            </>
          ) : <Skeleton rows={2} />}
        </DetailSection>

        <DetailSection title="Residential address" reviewBar={renderReview("residentialAddress")}>
          {d ? (
            <p className="ob-detail-prose">
              {[d.residentialAddress?.street, d.residentialAddress?.city, d.residentialAddress?.state, d.residentialAddress?.postalCode]
                .filter(Boolean)
                .join(", ") || "Address not provided"}
            </p>
          ) : <Skeleton rows={1} />}
        </DetailSection>

        <DetailSection title="Emergency contact" reviewBar={renderReview("emergencyContact")}>
          {d ? (
            <>
              <DetailRow label="Name" value={d.emergencyContact?.name} />
              <DetailRow label="Relationship" value={d.emergencyContact?.relationship} />
              <DetailRow label="Phone" value={d.emergencyContact?.phone} />
            </>
          ) : <Skeleton rows={2} />}
        </DetailSection>

        <DetailSection title="Bank & tax" reviewBar={renderReview("bankAndTax")}>
          {d ? (
            <>
              <div className="row-actions" style={{ marginBottom: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowSensitive((v) => !v)}>
                  {showSensitive ? "Mask numbers" : "Reveal numbers"}
                </button>
              </div>
              <DetailRow label="Bank name" value={d.bankDetails?.bankName} />
              <DetailRow label="Account number" value={d.bankDetails?.accountNumber ? (showSensitive ? d.bankDetails.accountNumber : maskTail(d.bankDetails.accountNumber)) : "—"} />
              <DetailRow label="IFSC" value={d.bankDetails?.ifscCode} />
              <DetailRow label="PAN / Tax ID" value={d.taxDetails?.panNumber ? (showSensitive ? d.taxDetails.panNumber : maskTail(d.taxDetails.panNumber)) : "—"} />
            </>
          ) : <Skeleton rows={2} />}
        </DetailSection>

        <DetailSection title={`Documents (${d?.documents?.length ?? view.docsCount ?? 0})`} reviewBar={renderReview("documents")}>
          {!d ? (
            <Skeleton rows={2} />
          ) : !d.documents?.length ? (
            <p className="caption">No documents uploaded.</p>
          ) : (
            <div className="ob-doc-list">
              {d.documents.map((doc) => {
                const docId = doc._id || doc.id || doc.storageKey;
                const busyDoc = docBusyId === String(docId);
                return (
                  <div key={docId || doc.title} className="ob-doc-row">
                    <div>
                      <strong>{doc.title || doc.fileName || "Document"}</strong>
                      <p className="caption">
                        {doc.documentType || "File"}
                        {doc.fileSize ? ` · ${(Number(doc.fileSize) / 1024).toFixed(1)} KB` : ""}
                      </p>
                    </div>
                    <div className="row-actions">
                      <button type="button" className="btn-secondary" disabled={busyDoc} onClick={() => handleDocument(doc, "open")}>
                        {busyDoc ? "…" : "Open"}
                      </button>
                      <button type="button" className="btn-secondary" disabled={busyDoc} onClick={() => handleDocument(doc, "save")}>Share</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DetailSection>

        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {status === "SUBMITTED" ? (
            <>
              <button type="button" className="btn-primary" disabled={!everySectionApproved || Boolean(busy)} onClick={() => startAction("approve")}>
                Final approve &amp; send account setup
              </button>
              {!everySectionApproved ? <p className="caption">Approve every section to enable final approval.</p> : null}
              <button type="button" className="btn-secondary" onClick={() => startAction("corrections")}>Request corrections (all open sections)</button>
              <button type="button" className="btn-danger" onClick={() => startAction("reject")}>Reject</button>
            </>
          ) : null}
          {status === "CHANGES_REQUESTED" ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => startAction("corrections", d?.correctionReason || "")}>Update correction request</button>
              <button type="button" className="btn-danger" onClick={() => startAction("reject")}>Reject</button>
            </>
          ) : null}
          {DRAFT_STATUSES.includes(status) ? (
            <button type="button" className="btn-danger" onClick={() => startAction("reject")}>Reject candidate</button>
          ) : null}
        </div>
      </>
    );
  };

  const renderAccount = () => {
    if (!hasOnboarding) return <p className="caption">Account setup begins after final HR approval of onboarding.</p>;
    const invited = SETUP_STATUSES.includes(status) || status === "ACTIVATED";
    return (
      <>
        <DetailSection title="Invitation">
          <DetailRow label="Status" value={status} />
          <DetailRow label="Invitation sent" value={onbSummary?.invitationSentAt ? formatDateTime(onbSummary.invitationSentAt) : invited ? "Not delivered" : "Not yet"} />
          <DetailRow label="Approved" value={formatDateTime(onbSummary?.approvedAt)} />
          <DetailRow label="Activated" value={onbSummary?.accountActivatedAt ? formatDateTime(onbSummary.accountActivatedAt) : "Not yet"} />
        </DetailSection>
        {status === "ACTIVATED" || employeeId ? (
          <div className="alert alert-ok">
            Employee profile created.
            {employeeId ? (
              <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => navigate(`/admin/employees/${employeeId}`)}>
                View profile
              </button>
            ) : null}
          </div>
        ) : invited ? (
          <div className="alert alert-ok">Invitation issued. The employee profile is created only after the candidate activates their account.</div>
        ) : (
          <p className="caption">The invitation is sent automatically on final HR approval.</p>
        )}
        {SETUP_STATUSES.includes(status) ? (
          <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={() => startAction("resend")}>
            Resend account setup email
          </button>
        ) : null}
      </>
    );
  };

  const renderTimeline = () => {
    const loading = offer.status === "idle" || offer.status === "loading" || onb.status === "loading";
    if (loading) return <Skeleton rows={4} />;
    if (timeline.length === 0) return <EmptyState message="No activity recorded yet." />;
    return (
      <ul className="ob-history-list">
        {timeline.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <strong>{e.title}</strong>
            <span className="caption"> · {e.source} · {formatDateTime(e.at)}</span>
            {e.note ? <p className="caption">{e.note}</p> : null}
          </li>
        ))}
      </ul>
    );
  };

  const confirmTitle =
    action === "section"
      ? `${sectionCopy.title}: ${sectionLabel(sectionAction?.section)}`
      : action === "approve"
      ? "Final approval"
      : action === "reject"
      ? "Reject onboarding"
      : action === "corrections"
      ? "Request corrections"
      : action === "resend"
      ? "Resend account setup email"
      : action === "withdraw"
      ? "Withdraw offer"
      : "Confirm";

  const confirmMessage =
    action === "section"
      ? sectionCopy.message
      : action === "approve"
      ? "All sections are approved. This sends the account setup invitation. The employee record is created only after the candidate sets up their account."
      : action === "resend"
      ? "Send a fresh account setup link to the candidate email."
      : action === "withdraw"
      ? "The candidate will no longer be able to sign this offer."
      : "";

  return (
    <>
      <Modal open onClose={onClose} title={view.name || "Candidate"} size="lg">
        <div className="ob-detail">
          <div className="ob-detail-header">
            <StatusBadge status={view.stage === "OFFERS" ? view.offerStatus : view.onboardingStatus || view.offerStatus} />
            <p className="caption">{view.email}</p>
            <p className="caption">{[view.position, stageLabel].filter(Boolean).join(" · ")}</p>
          </div>
          <SegmentedTabs value={tab} onChange={setTab} options={SHEET_TABS} />
          {actionError && !action ? <div className="alert alert-error" style={{ marginTop: 8 }}>{actionError}</div> : null}
          {summaryError && !summary && tab !== "overview" ? <div className="alert alert-error" style={{ marginTop: 8 }}>{summaryError}</div> : null}
          <div style={{ marginTop: 10 }}>
            {tab === "overview" && renderOverview()}
            {tab === "offer" && renderOffer()}
            {tab === "onboarding" && renderOnboarding()}
            {tab === "account" && renderAccount()}
            {tab === "timeline" && renderTimeline()}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(action)}
        onClose={closeAction}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={
          action === "section" ? sectionCopy.confirm : action === "approve" ? "Approve & send invite" : action === "withdraw" ? "Withdraw" : "Confirm"
        }
        danger={action === "reject" || action === "withdraw" || (action === "section" && sectionAction?.decision === "REJECT")}
        busy={busy === "action"}
        onConfirm={runAction}
      >
        {actionError ? <div className="alert alert-error" style={{ marginTop: 12 }}>{actionError}</div> : null}
        {(action === "section" && sectionAction?.decision !== "APPROVE") ||
        action === "reject" ||
        action === "corrections" ||
        action === "withdraw" ? (
          <label className="form-grid" style={{ marginTop: 12 }}>
            {action === "reject" ? "Rejection reason" : action === "withdraw" ? "Withdrawal reason" : "Note for the candidate"}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Explain…" />
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

export default function HrHiringPage() {
  const goBack = useSmartBack("/admin/more");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const stage =
    normalizeStageParam(searchParams.get("stage")) ||
    stageFromLegacyStatus(searchParams.get("status")) ||
    "ALL";
  const deepLinkOfferId = (searchParams.get("offerId") || "").trim();
  const deepLinkTab = (searchParams.get("tab") || "").trim().toLowerCase();

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("search") || "");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null); // { offerId, row, tab }
  const [pollTick, setPollTick] = useState(0);

  const seqRef = useRef(0);
  const loadRef = useRef(null);
  const handledDeepLinkRef = useRef("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [stage, debouncedSearch]);

  // Light list only (limit 20). `silent` refreshes never flash the skeleton or surface transient errors.
  const load = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++seqRef.current;
      try {
        if (!silent) {
          setLoading(true);
          setError("");
        }
        const params = { page, limit: PAGE_SIZE };
        if (stage !== "ALL") params.stage = stage;
        if (debouncedSearch) params.search = debouncedSearch;
        const res = await api.get("/hiring/candidates", { params });
        if (seq !== seqRef.current) return;
        setItems(res.data?.candidates || []);
        setSummary(res.data?.summary || null);
        setPagination(res.data?.pagination || { page, limit: PAGE_SIZE, total: 0, totalPages: 1 });
      } catch (err) {
        if (seq === seqRef.current && !silent) setError(err.response?.data?.message || "Could not load hiring pipeline.");
      } finally {
        if (seq === seqRef.current && !silent) setLoading(false);
      }
    },
    [stage, debouncedSearch, page]
  );
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

  // Poll the light list every 20s ONLY while this page is mounted, visible and focused;
  // refetch immediately when the app regains focus. Everything is torn down on unmount.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      loadRef.current?.({ silent: true });
      setPollTick((n) => n + 1);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) refresh();
    }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const updateParams = (mutate) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  };

  const setStage = (key) =>
    updateParams((p) => {
      if (key === "ALL") p.delete("stage");
      else p.set("stage", key);
      p.delete("status");
    });

  const openCandidate = (row, tab) => setOpen({ offerId: String(row.offerId), row, tab: tab || defaultTabForStage(row.stage) });

  const closeSheet = () => {
    setOpen(null);
    if (deepLinkOfferId) {
      updateParams((p) => {
        p.delete("offerId");
        p.delete("tab");
      });
    }
  };

  // Deep link: open the sheet immediately (before the list returns).
  useEffect(() => {
    if (!deepLinkOfferId || handledDeepLinkRef.current === deepLinkOfferId) return;
    handledDeepLinkRef.current = deepLinkOfferId;
    const match = items.find((r) => String(r.offerId) === deepLinkOfferId);
    const valid = ["overview", "offer", "onboarding", "account", "timeline"];
    setOpen({
      offerId: deepLinkOfferId,
      row: match || { offerId: deepLinkOfferId },
      tab: valid.includes(deepLinkTab) ? deepLinkTab : match ? defaultTabForStage(match.stage) : "overview",
    });
  }, [deepLinkOfferId, deepLinkTab, items]);

  const openRow = useMemo(() => {
    if (!open) return null;
    return items.find((r) => String(r.offerId) === open.offerId) || open.row;
  }, [open, items]);

  const emptyFiltered = stage !== "ALL" || Boolean(debouncedSearch);

  return (
    <div className="hr-onboarding">
      <HrPortalHeader title="Hiring & Onboarding" showBack onBack={() => goBack()} />
      {loading && items.length > 0 ? <SoftRefresh active label="Refreshing" /> : null}

      <div className="row-actions" style={{ marginBottom: 10 }}>
        <button type="button" className="btn-primary" onClick={() => navigate("/admin/hiring/offer-editor")}>
          + New offer
        </button>
      </div>

      <label className="form-grid" style={{ marginBottom: 12 }}>
        <span className="caption">Search candidates</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, email, role…"
        />
      </label>

      <div className="chip-row" role="tablist" aria-label="Filter by stage" style={{ marginBottom: 12 }}>
        {HIRING_STAGE_CHIPS.map((chip) => {
          const count = summary ? summary[chip.summaryKey] ?? 0 : null;
          return (
            <button
              key={chip.key}
              type="button"
              role="tab"
              aria-selected={stage === chip.key}
              className={`chip${stage === chip.key ? " is-active" : ""}`}
              onClick={() => setStage(chip.key)}
            >
              {chip.label}
              {count !== null ? ` ${count}` : ""}
            </button>
          );
        })}
      </div>

      {loading && items.length === 0 ? (
        <Skeleton />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : items.length === 0 ? (
        <EmptyState
          message={emptyFiltered ? "No candidates match this view." : "No offers or onboarding records yet."}
          actionLabel={emptyFiltered ? "Clear filters" : undefined}
          onAction={
            emptyFiltered
              ? () => {
                  setSearch("");
                  setStage("ALL");
                }
              : undefined
          }
        />
      ) : (
        items.map((item) => {
          const primary = primaryActionForRow(item);
          return (
            <div key={item.offerId} className="card" style={{ padding: 12 }}>
              <button
                type="button"
                className="summary-row"
                style={{ border: "none", padding: 0, margin: 0, width: "100%", background: "transparent" }}
                onClick={() => openCandidate(item)}
              >
                <span className="summary-avatar">{initialsFrom(item.name || "Candidate")}</span>
                <span className="summary-body">
                  <span className="summary-title">{item.name || "Candidate"}</span>
                  <span className="summary-sub">
                    {item.position || "—"}
                    {item.department ? ` · ${item.department}` : ""}
                  </span>
                  <span className="caption">
                    {item.email}
                    {item.sectionsPendingCount > 0 ? ` · ${item.sectionsPendingCount} to review` : ""}
                  </span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <StatusBadge status={item.onboardingStatus || item.offerStatus} />
                  <span className="caption">{HIRING_STAGE_LABELS[item.stage] || item.stage}</span>
                </span>
              </button>
              <div className="row-actions">
                <button type="button" className="btn-secondary" onClick={() => openCandidate(item, primary.tab)}>
                  {primary.label}
                </button>
              </div>
            </div>
          );
        })
      )}

      {error && items.length > 0 ? <div className="alert alert-error">{error}</div> : null}

      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.limit}
        onPageChange={setPage}
        itemLabel="candidates"
      />

      {open ? (
        <HiringSheet
          key={open.offerId}
          offerId={open.offerId}
          row={openRow}
          initialTab={open.tab}
          pollTick={pollTick}
          onClose={closeSheet}
          onChanged={() => loadRef.current?.({ silent: true })}
        />
      ) : null}
    </div>
  );
}

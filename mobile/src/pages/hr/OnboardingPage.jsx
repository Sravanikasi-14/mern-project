import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../../hooks/useSmartBack";
import HrPortalHeader from "../../components/HrPortalHeader";
import StatusBadge from "../../components/StatusBadge";
import SegmentedTabs from "../../components/SegmentedTabs";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import { useToast } from "../../components/Toast";
import { initialsFrom } from "../../components/SummaryRow";
import api from "../../services/api";
import {
  blobFromAxiosResponse,
  documentErrorMessage,
  openDocument,
  saveDocument,
} from "../../services/documents";

const TABS = [
  { value: "progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

// Statuses after final HR approval (employee is only created once the candidate activates the account).
const COMPLETED_STATUSES = ["APPROVED", "COMPLETED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING", "ACTIVATED"];
const SETUP_STATUSES = ["APPROVED", "ACCOUNT_SETUP_SENT", "ACCOUNT_SETUP_PENDING"];
const REVIEWABLE_STATUSES = ["SUBMITTED", "CHANGES_REQUESTED"];
const POLL_INTERVAL_MS = 15000;

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

function allSectionsApproved(item) {
  const reviews = item?.sectionReviews || {};
  return SECTIONS.every(({ key }) => reviews[key]?.status === "APPROVED");
}

function candidateName(item) {
  return (
    item?.personalDetails?.fullName ||
    item?.candidate?.fullName ||
    item?.fullName ||
    item?.candidateName ||
    "Candidate"
  );
}

function candidateEmail(item) {
  return item?.candidate?.email || item?.candidateEmail || item?.email || "";
}

function offerMeta(item) {
  const offer = item?.offerLetterId && typeof item.offerLetterId === "object" ? item.offerLetterId : null;
  return {
    position: offer?.position || item?.jobTitle || item?.position || "—",
    department: offer?.department || item?.department || "—",
    monthlySalary: offer?.monthlySalary,
    signedAt: offer?.signature?.signedAt || offer?.signedAt,
  };
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function maskTail(value) {
  const raw = String(value || "");
  if (!raw) return "—";
  if (raw.length <= 4) return "••••";
  return `••••${raw.slice(-4)}`;
}

function SectionReviewBar({ review, canReview, busy, onDecision }) {
  const status = review?.status || "NOT_SUBMITTED";
  const awaiting = ["PENDING_REVIEW", "RESUBMITTED", "REJECTED", "CORRECTION_REQUESTED", "APPROVED"].includes(status);
  return (
    <div className="ob-section-review" style={{ marginTop: 10 }}>
      <StatusBadge status={status} />
      {review?.note && ["CORRECTION_REQUESTED", "REJECTED"].includes(status) ? (
        <p className="caption" style={{ marginTop: 6 }}>HR note: {review.note}</p>
      ) : null}
      {canReview && awaiting ? (
        <div className="row-actions" style={{ marginTop: 8 }}>
          {status !== "APPROVED" ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecision("APPROVE")}>
              Approve
            </button>
          ) : null}
          {status !== "CORRECTION_REQUESTED" ? (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDecision("REQUEST_CORRECTION")}>
              Correction
            </button>
          ) : null}
          {status !== "REJECTED" ? (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => onDecision("REJECT")}>
              Reject
            </button>
          ) : null}
        </div>
      ) : null}
      {canReview && status === "NOT_SUBMITTED" ? (
        <p className="caption" style={{ marginTop: 6 }}>Not submitted by the candidate yet.</p>
      ) : null}
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

function DetailRow({ label, value }) {
  return (
    <div className="ob-detail-row">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

export default function HrOnboardingPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkOfferId = (searchParams.get("offerId") || "").trim();
  const deepLinkHandledRef = useRef("");
  const goBack = useSmartBack("/admin/more");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deepLinkMessage, setDeepLinkMessage] = useState("");
  const [tab, setTab] = useState("progress");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [docBusyId, setDocBusyId] = useState("");

  const [sectionAction, setSectionAction] = useState(null); // { section, decision }
  const selectedIdRef = useRef("");
  const loadRef = useRef(null);

  // `silent` refreshes (polling / focus) never flash the skeleton or surface transient errors.
  const load = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
        setError("");
      }
      const params = { limit: 100, page: 1 };
      if (deepLinkOfferId) params.offerId = deepLinkOfferId;
      const res = await api.get("/onboarding/submissions", { params });
      setItems(res.data?.submissions || res.data?.data || []);
    } catch (err) {
      if (!silent) setError(err.response?.data?.message || "Could not load onboarding.");
    } finally {
      if (!silent) setLoading(false);
    }
  };
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [deepLinkOfferId]);

  // Near real-time updates: mobile authenticates with a Bearer token (EventSource cannot send it),
  // so poll while the page is visible and refetch whenever the app regains focus.
  const refreshSelectedDetailNow = async (id) => {
    if (!id) return;
    try {
      const res = await api.get(`/onboarding/submissions/${id}`);
      if (res.data?.submission) {
        setSelected((prev) => (prev && String(prev._id) === String(id) ? res.data.submission : prev));
      }
    } catch {
      /* keep the last known detail */
    }
  };
  const refreshSelectedDetail = () => refreshSelectedDetailNow(selectedIdRef.current);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      loadRef.current?.({ silent: true });
      refreshSelectedDetail();
    };
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    selectedIdRef.current = detailOpen && selected?._id ? String(selected._id) : "";
  }, [detailOpen, selected?._id]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (tab === "completed") {
      list = items.filter((item) => COMPLETED_STATUSES.includes(item.status));
    } else if (tab === "rejected") {
      list = items.filter((item) => item.status === "REJECTED");
    } else {
      list = items.filter((item) => !COMPLETED_STATUSES.includes(item.status) && item.status !== "REJECTED");
    }
    if (!q) return list;
    return list.filter((item) => {
      const hay = `${candidateName(item)} ${candidateEmail(item)} ${offerMeta(item).position} ${offerMeta(item).department}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, tab, search]);

  const openDetails = async (item) => {
    setActionError("");
    setShowSensitive(false);
    setDetailOpen(true);
    setSelected(item);
    try {
      const res = await api.get(`/onboarding/submissions/${item._id}`);
      setSelected(res.data?.submission || item);
    } catch {
      setSelected(item);
    }
  };

  useEffect(() => {
    if (!deepLinkOfferId || loading) return;
    if (deepLinkHandledRef.current === deepLinkOfferId) return;
    deepLinkHandledRef.current = deepLinkOfferId;

    const match = items.find((item) => {
      const offerRef = item.offerLetterId;
      const id = offerRef?._id || offerRef;
      return id && String(id) === String(deepLinkOfferId);
    });

    if (match) {
      setDeepLinkMessage("");
      setTab(
        COMPLETED_STATUSES.includes(match.status)
          ? "completed"
          : match.status === "REJECTED"
            ? "rejected"
            : "progress"
      );
      openDetails(match);
    } else {
      setDeepLinkMessage(
        "No candidate onboarding record was found for this offer yet. The candidate must sign in the portal before HR review can begin."
      );
    }
  }, [deepLinkOfferId, loading, items]);

  const closeDetail = () => {
    setDetailOpen(false);
    setSelected(null);
    setActionError("");
  };

  const startAction = (nextAction) => {
    setActionError("");
    setNotes(
      nextAction === "corrections" && selected?.correctionReason
        ? selected.correctionReason
        : ""
    );
    setAction(nextAction);
  };

  const runAction = async () => {
    if (busy || !selected?._id) return;
    if ((action === "reject" || action === "corrections") && !notes.trim()) {
      setActionError("Notes are required for this action.");
      return;
    }
    try {
      setBusy(true);
      setActionError("");
      if (action === "section" && sectionAction) {
        const { section, decision } = sectionAction;
        if (decision !== "APPROVE" && !notes.trim()) {
          setActionError("A note for the candidate is required for this decision.");
          setBusy(false);
          return;
        }
        const res = await api.post(
          `/onboarding/submissions/${selected._id}/sections/${section}/review`,
          { decision, note: notes.trim() }
        );
        toast.push(res.data?.message || "Section updated.");
        setAction(null);
        setSectionAction(null);
        setNotes("");
        await Promise.all([load({ silent: true }), refreshSelectedDetailNow(selected._id)]);
        return;
      }
      if (action === "approve") {
        await api.post(`/onboarding/submissions/${selected._id}/approve`);
      } else if (action === "reject") {
        await api.post(`/onboarding/submissions/${selected._id}/reject`, {
          reason: notes.trim(),
        });
      } else if (action === "corrections") {
        await api.post(`/onboarding/submissions/${selected._id}/request-corrections`, {
          reason: notes.trim(),
        });
      } else if (action === "resend") {
        await api.post(`/onboarding/submissions/${selected._id}/resend-activation`);
      }
      toast.push("Onboarding updated.");
      setAction(null);
      closeDetail();
      setNotes("");
      await load();
    } catch (err) {
      setActionError(err.response?.data?.message || "Could not update onboarding.");
    } finally {
      setBusy(false);
    }
  };

  const handleDocument = async (doc, mode = "open") => {
    if (!selected?._id || docBusyId) return;
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId) return;
    try {
      setDocBusyId(String(docId));
      setActionError("");
      const response = await api.get(
        `/onboarding/submissions/${selected._id}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const file = await blobFromAxiosResponse(
        response,
        doc.fileName || doc.title || "document"
      );
      if (mode === "save") {
        await saveDocument(file);
        toast.push("Document ready — use Save or Share.");
      } else {
        await openDocument(file);
      }
    } catch (err) {
      setActionError(documentErrorMessage(err, "Could not open this document."));
    } finally {
      setDocBusyId("");
    }
  };

  const offer = offerMeta(selected || {});
  const status = selected?.status || "";
  const canReviewSections = REVIEWABLE_STATUSES.includes(status);
  const everySectionApproved = allSectionsApproved(selected);
  const canFinalApprove = status === "SUBMITTED" && everySectionApproved;
  const canApproveReject = status === "SUBMITTED";
  const canResend = SETUP_STATUSES.includes(status);
  const renderReview = (key) => (
    <SectionReviewBar
      review={selected?.sectionReviews?.[key]}
      canReview={canReviewSections}
      busy={busy}
      onDecision={(decision) => {
        setActionError("");
        setNotes("");
        setSectionAction({ section: key, decision });
        setAction("section");
      }}
    />
  );
  const sectionLabel = (key) => SECTIONS.find((s) => s.key === key)?.label || key;
  const sectionCopy = SECTION_DECISION_COPY[
    sectionAction?.decision === "APPROVE" ? "approve" : sectionAction?.decision === "REJECT" ? "reject" : "correction"
  ];
  const employeeId =
    selected?.employeeId?._id ||
    selected?.employeeId ||
    selected?.employee?._id ||
    selected?.employee?.id ||
    "";

  return (
    <div className="hr-onboarding">
      <HrPortalHeader title="Onboarding" showBack onBack={() => goBack()} />
      {loading && items.length > 0 ? <SoftRefresh active label="Refreshing" /> : null}

      {deepLinkOfferId ? (
        <div className={`alert ${deepLinkMessage ? "alert-error" : ""}`} style={{ marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            {deepLinkMessage || "Opened from Offer Letters for a linked offer."}
          </p>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("offerId");
              setSearchParams(next, { replace: true });
              setDeepLinkMessage("");
              deepLinkHandledRef.current = "";
            }}
          >
            Clear offer filter
          </button>
        </div>
      ) : null}

      <label className="form-grid" style={{ marginBottom: 12 }}>
        <span className="caption">Search candidates</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, email, position…"
        />
      </label>

      <SegmentedTabs value={tab} onChange={setTab} options={TABS} />

      {loading && items.length === 0 ? (
        <Skeleton />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState message="No onboarding records in this view." />
      ) : (
        visible.map((item) => {
          const meta = offerMeta(item);
          return (
            <div key={item._id} className="card" style={{ padding: 12 }}>
              <button
                type="button"
                className="summary-row"
                style={{ border: "none", padding: 0, margin: 0, width: "100%", background: "transparent" }}
                onClick={() => openDetails(item)}
              >
                <span className="summary-avatar">{initialsFrom(candidateName(item))}</span>
                <span className="summary-body">
                  <span className="summary-title">{candidateName(item)}</span>
                  <span className="summary-sub">
                    {meta.position}
                    {meta.department && meta.department !== "—" ? ` · ${meta.department}` : ""}
                  </span>
                  <span className="caption">{candidateEmail(item)}</span>
                </span>
                <StatusBadge status={item.status} />
              </button>
              {item.status === "SUBMITTED" ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setSelected(item);
                      setDetailOpen(false);
                      startAction("reject");
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setSelected(item);
                      setDetailOpen(false);
                      startAction("corrections");
                    }}
                  >
                    Corrections
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      if (!allSectionsApproved(item)) {
                        openDetails(item);
                        return;
                      }
                      setSelected(item);
                      setDetailOpen(false);
                      startAction("approve");
                    }}
                  >
                    {allSectionsApproved(item) ? "Final approve" : "Review sections"}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })
      )}

      {error && items.length > 0 ? <div className="alert alert-error">{error}</div> : null}

      <Modal
        open={detailOpen && Boolean(selected) && !action}
        onClose={closeDetail}
        title="Onboarding details"
        footer={
          selected ? (
            <div className="stack" style={{ gap: 8 }}>
              {canApproveReject ? (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!canFinalApprove}
                    onClick={() => startAction("approve")}
                  >
                    Final approve &amp; send account setup
                  </button>
                  {!canFinalApprove ? (
                    <p className="caption">Approve every section below to enable final approval.</p>
                  ) : null}
                  <button type="button" className="btn-secondary" onClick={() => startAction("corrections")}>
                    Request corrections (all open sections)
                  </button>
                  <button type="button" className="btn-danger" onClick={() => startAction("reject")}>
                    Reject
                  </button>
                </>
              ) : null}
              {status === "CHANGES_REQUESTED" ? (
                <>
                  <button type="button" className="btn-secondary" onClick={() => startAction("corrections")}>
                    Update correction request
                  </button>
                  <button type="button" className="btn-danger" onClick={() => startAction("reject")}>
                    Reject
                  </button>
                </>
              ) : null}
              {canResend ? (
                <>
                  <button type="button" className="btn-primary" onClick={() => startAction("resend")}>
                    Resend account setup email
                  </button>
                  {employeeId ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => navigate(`/admin/employees/${employeeId}`)}
                    >
                      View employee profile
                    </button>
                  ) : null}
                </>
              ) : null}
              <button type="button" className="btn-secondary" onClick={closeDetail}>
                Close
              </button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="ob-detail">
            {actionError ? <div className="alert alert-error">{actionError}</div> : null}

            <div className="ob-detail-header">
              <StatusBadge status={selected.status} />
              <h2 className="ob-detail-name">{candidateName(selected)}</h2>
              <p className="caption">{candidateEmail(selected) || "—"}</p>
              <p className="caption">Submitted {formatDate(selected.submittedAt || selected.createdAt)}</p>
            </div>

            {SETUP_STATUSES.includes(status) ? (
              <div className={`alert ${status === "ACCOUNT_SETUP_PENDING" ? "alert-warn" : "alert-ok"}`}>
                {status === "ACCOUNT_SETUP_PENDING"
                  ? "Approved, but the account setup email could not be delivered. Resend it below."
                  : `Approved${selected.invitationSentAt ? ` · setup email sent ${formatDate(selected.invitationSentAt)}` : ""}.`}
                {" "}The employee profile is created when the candidate sets up their account.
              </div>
            ) : null}
            {status === "ACTIVATED" ? (
              <div className="alert alert-ok">
                Account activated{selected.accountActivatedAt ? ` on ${formatDate(selected.accountActivatedAt)}` : ""}.
                {selected.employeeCode ? ` Employee code ${selected.employeeCode}.` : ""}
              </div>
            ) : null}
            {status === "CHANGES_REQUESTED" ? (
              <div className="alert alert-warn">
                Corrections requested{selected.reviewedAt ? ` on ${formatDate(selected.reviewedAt)}` : ""}:
                {" "}
                {selected.correctionReason || "Candidate must update their submission."}
              </div>
            ) : null}
            {status === "REJECTED" ? (
              <div className="alert alert-error">
                Rejected{selected.rejectedAt ? ` on ${formatDate(selected.rejectedAt)}` : ""}:
                {" "}
                {selected.rejectionReason || "No reason recorded."}
              </div>
            ) : null}

            <DetailSection title="Offer details">
              <DetailRow label="Position" value={offer.position} />
              <DetailRow label="Department" value={offer.department} />
              <DetailRow
                label="Monthly compensation"
                value={
                  offer.monthlySalary != null
                    ? `₹${Number(offer.monthlySalary).toLocaleString("en-IN")}`
                    : "—"
                }
              />
              <DetailRow label="Signed" value={formatDate(offer.signedAt)} />
            </DetailSection>

            <DetailSection title="Personal details" reviewBar={renderReview("personalDetails")}>
              <DetailRow
                label="Full name"
                value={selected.personalDetails?.fullName || candidateName(selected)}
              />
              <DetailRow label="Phone" value={selected.personalDetails?.phoneNumber} />
              <DetailRow label="Date of birth" value={formatDate(selected.personalDetails?.dateOfBirth)} />
              <DetailRow label="Gender" value={selected.personalDetails?.gender} />
            </DetailSection>

            <DetailSection title="Residential address" reviewBar={renderReview("residentialAddress")}>
              <p className="ob-detail-prose">
                {[
                  selected.residentialAddress?.street,
                  selected.residentialAddress?.city,
                  selected.residentialAddress?.state,
                  selected.residentialAddress?.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ") || "Address not provided"}
              </p>
            </DetailSection>

            <DetailSection title="Emergency contact" reviewBar={renderReview("emergencyContact")}>
              <DetailRow label="Name" value={selected.emergencyContact?.name} />
              <DetailRow label="Relationship" value={selected.emergencyContact?.relationship} />
              <DetailRow label="Phone" value={selected.emergencyContact?.phone} />
            </DetailSection>

            <DetailSection title="Bank & tax" reviewBar={renderReview("bankAndTax")}>
              <div className="row-actions" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowSensitive((v) => !v)}
                >
                  {showSensitive ? "Mask numbers" : "Reveal numbers"}
                </button>
              </div>
              <DetailRow label="Bank name" value={selected.bankDetails?.bankName} />
              <DetailRow
                label="Account number"
                value={
                  selected.bankDetails?.accountNumber
                    ? showSensitive
                      ? selected.bankDetails.accountNumber
                      : maskTail(selected.bankDetails.accountNumber)
                    : "—"
                }
              />
              <DetailRow label="IFSC" value={selected.bankDetails?.ifscCode} />
              <DetailRow
                label="PAN / Tax ID"
                value={
                  selected.taxDetails?.panNumber
                    ? showSensitive
                      ? selected.taxDetails.panNumber
                      : maskTail(selected.taxDetails.panNumber)
                    : "—"
                }
              />
            </DetailSection>

            <DetailSection
              title={`Documents (${selected.documents?.length || 0})`}
              reviewBar={renderReview("documents")}
            >
              {!selected.documents?.length ? (
                <p className="caption">No documents uploaded.</p>
              ) : (
                <div className="ob-doc-list">
                  {selected.documents.map((doc) => {
                    const docId = doc._id || doc.id || doc.storageKey;
                    const busyDoc = docBusyId === String(docId);
                    return (
                      <div key={docId || doc.title} className="ob-doc-row">
                        <div>
                          <strong>{doc.title || doc.fileName || "Document"}</strong>
                          <p className="caption">
                            {doc.documentType || "File"}
                            {doc.fileSize
                              ? ` · ${(Number(doc.fileSize) / 1024).toFixed(1)} KB`
                              : ""}
                          </p>
                        </div>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busyDoc}
                            onClick={() => handleDocument(doc, "open")}
                          >
                            {busyDoc ? "…" : "Open"}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busyDoc}
                            onClick={() => handleDocument(doc, "save")}
                          >
                            Share
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DetailSection>

            {Array.isArray(selected.history) && selected.history.length > 0 ? (
              <DetailSection title="History">
                <ul className="ob-history-list">
                  {selected.history.map((entry, index) => (
                    <li key={`${entry.action || "event"}-${index}`}>
                      <strong>{entry.action || "Update"}</strong>
                      <span className="caption"> · {formatDate(entry.timestamp || entry.at)}</span>
                      {entry.notes ? <p className="caption">{entry.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => {
          setAction(null);
          setSectionAction(null);
          setActionError("");
          if (!detailOpen) setSelected(null);
        }}
        title={
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
                    : "Update onboarding"
        }
        message={
          action === "section"
            ? sectionCopy.message
            : action === "approve"
              ? "All sections are approved. This sends the account setup invitation. The employee record is created only after the candidate sets up their account."
              : action === "resend"
                ? "Send a fresh account setup link to the candidate email."
                : "This uses the same onboarding APIs as the website."
        }
        confirmLabel={action === "section" ? sectionCopy.confirm : action === "approve" ? "Approve & send invite" : "Confirm"}
        danger={action === "reject" || (action === "section" && sectionAction?.decision === "REJECT")}
        busy={busy}
        onConfirm={runAction}
      >
        {actionError ? <div className="alert alert-error" style={{ marginTop: 12 }}>{actionError}</div> : null}
        {action === "section" && sectionAction?.decision !== "APPROVE" ? (
          <label className="form-grid" style={{ marginTop: 12 }}>
            Note for the candidate
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Explain what needs to change in this section…"
            />
          </label>
        ) : null}
        {action === "reject" || action === "corrections" ? (
          <label className="form-grid" style={{ marginTop: 12 }}>
            {action === "reject" ? "Rejection reason" : "Correction notes"}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder={
                action === "reject"
                  ? "Explain why this submission is being rejected…"
                  : "List the fields or documents the candidate must update…"
              }
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

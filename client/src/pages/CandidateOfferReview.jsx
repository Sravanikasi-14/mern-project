import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";
import SignatureCapture, { isSignatureValueComplete } from "../components/SignatureCapture";

/** Renders the frozen offer HTML in an isolated iframe so its print CSS cannot leak into the app. */
function OfferDocumentFrame({ html }) {
  const frameRef = useRef(null);
  const [height, setHeight] = useState(900);

  const resize = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const next = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0);
    if (next > 0) setHeight(next + 8);
  };

  return (
    <iframe
      ref={frameRef}
      title="Offer letter"
      srcDoc={html || ""}
      sandbox="allow-same-origin"
      onLoad={resize}
      style={{ display: "block", width: "100%", minWidth: "8.5in", height, border: "none", background: "#fff" }}
    />
  );
}

export default function CandidateOfferReview() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offerData, setOfferData] = useState(null);

  // Signing state
  const [fullName, setFullName] = useState("");
  const [legalConsent, setLegalConsent] = useState(false);
  const [signature, setSignature] = useState(null);
  const [signing, setSigning] = useState(false);
  const [signSuccess, setSignSuccess] = useState(null);
  const [signError, setSignError] = useState("");

  // Decline state
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchOffer = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await api.get(`/candidate/offers/review/${encodeURIComponent(token)}`);
        if (!cancelled) {
          setOfferData(res.data);
          if (res.data.offer?.candidate?.fullName) {
            setFullName(res.data.offer.candidate.fullName);
          }
          // Persist continuity fields from GET so refresh keeps the onboarding CTA
          if (res.data.onboardingLink || res.data.onboardingToken) {
            setSignSuccess((prev) => ({
              ...(prev || {}),
              onboardingLink: res.data.onboardingLink,
              onboardingToken: res.data.onboardingToken,
              onboardingStatus: res.data.onboardingStatus,
            }));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "This offer review link is invalid or has expired. Please contact HR."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (token) {
      fetchOffer();
    } else {
      setError("No offer review token provided.");
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleDownloadPdf = () => {
    const downloadUrl = `/api/candidate/offers/review/${encodeURIComponent(token)}/pdf`;
    window.open(downloadUrl, "_blank");
  };

  const handleSignOffer = async (e) => {
    e.preventDefault();
    setSignError("");

    if (!fullName.trim()) {
      setSignError("Please type your full legal name to sign the document.");
      return;
    }

    if (!legalConsent) {
      setSignError("Please acknowledge and accept the terms of employment.");
      return;
    }

    if (!isSignatureValueComplete(signature)) {
      setSignError("Please draw, upload, or type your signature before accepting.");
      return;
    }

    try {
      setSigning(true);
      const res = await api.post(`/candidate/offers/review/${encodeURIComponent(token)}/accept`, {
        fullName: fullName.trim(),
        legalConsent: true,
        signatureMethod: signature.method,
        imageDataUrl: signature.dataUrl || undefined,
        typedText: signature.method === "TYPE" ? signature.typedText : undefined,
      });

      setSignSuccess(res.data);
      if (res.data.offer) {
        setOfferData((prev) => ({
          ...prev,
          offer: res.data.offer,
          alreadySigned: true,
          onboardingLink: res.data.onboardingLink || prev?.onboardingLink || null,
          onboardingToken: res.data.onboardingToken || prev?.onboardingToken || null,
          onboardingStatus: res.data.onboardingStatus || "DRAFT",
        }));
      }
      // Continue into onboarding in the same portal when a secure token is returned
      if (res.data.onboardingToken) {
        navigate(`/candidate/onboarding/${encodeURIComponent(res.data.onboardingToken)}`, {
          replace: false,
        });
        return;
      }
    } catch (err) {
      setSignError(
        err.response?.data?.message || "Failed to sign offer letter. Please try again."
      );
    } finally {
      setSigning(false);
    }
  };

  const handleDeclineOffer = async () => {
    try {
      setDeclining(true);
      setDeclineError("");
      const res = await api.post(`/candidate/offers/review/${encodeURIComponent(token)}/decline`, {
        reason: declineReason.trim(),
      });
      setShowDeclineModal(false);
      if (res.data.offer) {
        setOfferData((prev) => ({
          ...prev,
          offer: res.data.offer,
          alreadyDeclined: true,
        }));
      }
    } catch (err) {
      setDeclineError(err.response?.data?.message || "Failed to decline offer. Please try again.");
    } finally {
      setDeclining(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ width: 40, height: 40, margin: "0 auto 16px" }} />
          <p style={{ color: "#64748b", fontSize: "14px" }}>Loading offer…</p>
        </div>
      </div>
    );
  }

  if (error || !offerData?.offer) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: "20px" }}>
        <div style={{ maxWidth: "480px", width: "100%", background: "#ffffff", padding: "36px", borderRadius: "12px", border: "1px solid #e2e8f0", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fef2f2", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>Review Link Expired or Invalid</h2>
          <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.5", margin: "0 0 24px" }}>{error}</p>
          <p style={{ fontSize: "13px", color: "#94a3b8" }}>If you believe this is an error, please contact your HR representative to request a new link.</p>
        </div>
      </div>
    );
  }

  const { offer, alreadySigned, alreadyDeclined, alreadyWithdrawn } = offerData;
  const onboardingLink =
    signSuccess?.onboardingLink || offerData?.onboardingLink || null;
  const onboardingStatus = offerData?.onboardingStatus || null;
  const actionsClosed = alreadySigned || alreadyDeclined || alreadyWithdrawn;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 16px" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        {/* Company Header Card */}
        <div style={{ background: "#ffffff", padding: "16px 20px", borderRadius: "12px", border: "1px solid #e2e8f0", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Offer letter</h1>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0" }}>{offer.company?.name || "Company"}</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={handleDownloadPdf}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "6px", color: "#334155", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </button>

            {alreadySigned && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#dcfce7", color: "#15803d", fontSize: "13px", fontWeight: "600" }}>
                Accepted & Signed
              </span>
            )}
            {alreadyDeclined && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#fee2e2", color: "#b91c1c", fontSize: "13px", fontWeight: "600" }}>
                Declined
              </span>
            )}
            {alreadyWithdrawn && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#f4f4f5", color: "#52525b", fontSize: "13px", fontWeight: "600" }}>
                Withdrawn
              </span>
            )}
            {!actionsClosed && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#eff6ff", color: "#1d4ed8", fontSize: "13px", fontWeight: "600" }}>
                Pending Review
              </span>
            )}
          </div>
        </div>

        {/* Status Callout if already signed */}
        {alreadySigned && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "20px 24px", borderRadius: "10px", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#065f46", margin: "0 0 6px" }}>Offer Letter Signed</h3>
            <p style={{ fontSize: "13px", color: "#047857", margin: "0 0 16px", lineHeight: "1.5" }}>
              Thank you for accepting our offer! This document was electronically signed by <strong>{offer.signature?.signerName || offer.candidate?.fullName}</strong> on{" "}
              {offer.decisionAt ? new Date(offer.decisionAt).toLocaleString("en-IN") : new Date().toLocaleDateString("en-IN")}.
            </p>
            {onboardingLink ? (
              <a
                href={onboardingLink.startsWith("http")
                  ? onboardingLink
                  : `/candidate/onboarding/${encodeURIComponent(offerData.onboardingToken || "")}`}
                onClick={(e) => {
                  if (offerData.onboardingToken) {
                    e.preventDefault();
                    navigate(`/candidate/onboarding/${encodeURIComponent(offerData.onboardingToken)}`);
                  }
                }}
                style={{ display: "inline-block", background: "#059669", color: "#ffffff", padding: "10px 22px", borderRadius: "6px", fontSize: "13px", fontWeight: "600", textDecoration: "none" }}
              >
                {onboardingStatus === "SUBMITTED"
                  ? "View onboarding submission"
                  : onboardingStatus === "CHANGES_REQUESTED"
                    ? "Continue corrections"
                    : "Continue employee onboarding"}
              </a>
            ) : onboardingStatus === "APPROVED" ? (
              <p style={{ fontSize: "12px", color: "#065f46", margin: 0 }}>
                Onboarding is approved. Check your email for the account activation link.
              </p>
            ) : (
              <p style={{ fontSize: "12px", color: "#065f46", margin: 0 }}>
                Check your inbox at <strong>{offer.candidate?.email}</strong> for your onboarding invitation email.
              </p>
            )}
          </div>
        )}

        {/* Status Callout if declined */}
        {alreadyDeclined && (
          <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", padding: "20px 24px", borderRadius: "10px", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#9f1239", margin: "0 0 6px" }}>Offer Declined</h3>
            <p style={{ fontSize: "13px", color: "#be123c", margin: 0, lineHeight: "1.5" }}>
              This offer was marked as declined on {offer.decisionAt ? new Date(offer.decisionAt).toLocaleString("en-IN") : "record"}.
              {offer.decisionNotes ? ` Reason: ${offer.decisionNotes}` : ""}
            </p>
          </div>
        )}

        {alreadyWithdrawn && (
          <div style={{ background: "#f4f4f5", border: "1px solid #e4e4e7", padding: "20px 24px", borderRadius: "10px", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#3f3f46", margin: "0 0 6px" }}>Offer Withdrawn</h3>
            <p style={{ fontSize: "13px", color: "#52525b", margin: 0, lineHeight: "1.5" }}>
              This offer has been withdrawn by the employer and is no longer available to accept or sign.
              Please contact HR if you have questions.
            </p>
          </div>
        )}

        {/* Offer Summary Highlights Card */}
        <div style={{ background: "#ffffff", padding: "20px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "24px" }}>
          <h3 style={{ fontSize: "13px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b", margin: "0 0 14px" }}>Position & Terms Overview</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            <div>
              <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>Offered Position</span>
              <strong style={{ fontSize: "14px", color: "#0f172a" }}>{offer.position}</strong>
            </div>
            <div>
              <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>Department</span>
              <strong style={{ fontSize: "14px", color: "#0f172a" }}>{offer.department || "Core Team"}</strong>
            </div>
            <div>
              <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>Location</span>
              <strong style={{ fontSize: "14px", color: "#0f172a" }}>{offer.workLocation || "Office / Hybrid"}</strong>
            </div>
            <div>
              <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>Monthly Compensation</span>
              <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                ₹{Number(offer.monthlySalary || 0).toLocaleString("en-IN")} / mo
              </strong>
            </div>
            <div>
              <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>Expected Start Date</span>
              <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                {offer.joiningDate ? new Date(offer.joiningDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : "As scheduled"}
              </strong>
            </div>
          </div>
        </div>

        {/* Rendered HTML Document Frame */}
        <div
          style={{ background: "#ffffff", padding: "12px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "28px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", overflowX: "auto" }}
        >
          <OfferDocumentFrame html={offer.content} />
        </div>

        {/* Candidate Signing Action Section (Only visible when offer is still open) */}
        {!actionsClosed && (
          <div style={{ background: "#ffffff", padding: "32px", borderRadius: "12px", border: "1px solid #cbd5e1", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px" }}>Accept and Sign Employment Offer</h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 24px", lineHeight: "1.5" }}>
              Type your full legal name and add your signature below to electronically accept this employment offer. Your signature, typed name and timestamp will be permanently linked to this document version.
            </p>

            {signError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 16px", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "20px" }}>
                {signError}
              </div>
            )}

            <form onSubmit={handleSignOffer}>
              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                  Full Legal Name (Electronic Signature) <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Sravani Kasi"
                  style={{ width: "100%", padding: "10px 14px", fontSize: "14px", border: "1px solid #cbd5e1", borderRadius: "6px", fontFamily: "inherit" }}
                  required
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                  Your Signature <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <SignatureCapture onChange={setSignature} disabled={signing} defaultTypedText={fullName} />
              </div>

              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "13px", color: "#334155", cursor: "pointer", lineHeight: "1.5" }}>
                  <input
                    type="checkbox"
                    checked={legalConsent}
                    onChange={(e) => setLegalConsent(e.target.checked)}
                    style={{ marginTop: "3px" }}
                  />
                  <span>
                    I confirm that I have carefully reviewed this offer letter, agree to the employment terms, compensation details, and policies, and intend to electronically sign and accept this position.
                  </span>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <button
                  type="button"
                  onClick={() => setShowDeclineModal(true)}
                  style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "13px", fontWeight: "500", cursor: "pointer", textDecoration: "underline" }}
                >
                  Decline this offer
                </button>

                <button
                  type="submit"
                  disabled={signing}
                  style={{ padding: "11px 28px", background: "#2563eb", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: signing ? "not-allowed" : "pointer", opacity: signing ? 0.7 : 1 }}
                >
                  {signing ? "Recording Signature..." : "Accept & Sign Offer"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Decline Offer Modal */}
        {showDeclineModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}>
            <div style={{ background: "#ffffff", padding: "28px", borderRadius: "12px", maxWidth: "480px", width: "100%", border: "1px solid #e2e8f0" }}>
              <h3 style={{ fontSize: "17px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>Decline Employment Offer</h3>
              <p style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.5", margin: "0 0 16px" }}>
                Are you sure you wish to decline this offer? This decision cannot be reversed.
              </p>

              {declineError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "10px 14px", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "14px" }}>
                  {declineError}
                </div>
              )}

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>
                  Reason (Optional)
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Provide feedback or reason for declining..."
                  rows={3}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px", fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowDeclineModal(false)}
                  style={{ padding: "8px 16px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "6px", color: "#475569", fontSize: "13px", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeclineOffer}
                  disabled={declining}
                  style={{ padding: "8px 18px", background: "#ef4444", border: "none", borderRadius: "6px", color: "#ffffff", fontSize: "13px", fontWeight: "600", cursor: declining ? "not-allowed" : "pointer" }}
                >
                  {declining ? "Processing..." : "Confirm Decline"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

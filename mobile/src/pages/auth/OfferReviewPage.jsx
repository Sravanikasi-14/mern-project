import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import api from "../../services/api";
import SignatureCapture, { isSignatureValueComplete } from "../../components/SignatureCapture";

export default function OfferReviewPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/candidate/offers/review/${encodeURIComponent(token)}`);
      setData(res.data);
      setFullName(res.data.offer?.candidate?.fullName || "");
    } catch (err) {
      setError(err.response?.data?.message || "This offer link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const goToOnboarding = (onboardingToken) => {
    if (!onboardingToken) return;
    navigate(`/candidate/onboarding/${encodeURIComponent(onboardingToken)}`);
  };

  const accept = async (event) => {
    event.preventDefault();
    if (!fullName.trim() || !consent) {
      setError("Type your legal name and accept the terms to sign.");
      return;
    }
    if (!isSignatureValueComplete(signature)) {
      setError("Draw, upload, or type your signature before accepting.");
      return;
    }
    try {
      setBusy(true);
      const res = await api.post(`/candidate/offers/review/${encodeURIComponent(token)}/accept`, {
        fullName: fullName.trim(),
        legalConsent: true,
        signatureMethod: signature.method,
        imageDataUrl: signature.dataUrl || undefined,
        typedText: signature.method === "TYPE" ? signature.typedText : undefined,
      });
      setData((prev) => ({
        ...prev,
        offer: res.data.offer || prev.offer,
        alreadySigned: true,
        onboardingToken: res.data.onboardingToken || prev?.onboardingToken || null,
        onboardingLink: res.data.onboardingLink || prev?.onboardingLink || null,
        onboardingStatus: res.data.onboardingStatus || "DRAFT",
      }));
      if (res.data.onboardingToken) {
        goToOnboarding(res.data.onboardingToken);
        return;
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not accept this offer.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    try {
      setBusy(true);
      const res = await api.post(`/candidate/offers/review/${encodeURIComponent(token)}/decline`, {
        reason: reason.trim(),
      });
      setDeclineOpen(false);
      setData((prev) => ({ ...prev, offer: res.data.offer || prev.offer, alreadyDeclined: true }));
    } catch (err) {
      setError(err.response?.data?.message || "Could not decline this offer.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="auth-screen"><Skeleton /></main>;
  if (error && !data) return <main className="auth-screen"><ErrorState message={error} /><Link to="/login">Go to sign in</Link></main>;

  const offer = data?.offer;
  const withdrawn = data?.alreadyWithdrawn || offer?.status === "WITHDRAWN";
  const closed =
    data?.alreadySigned ||
    data?.alreadyDeclined ||
    withdrawn ||
    ["ACCEPTED", "DECLINED", "REJECTED", "WITHDRAWN"].includes(offer?.status);
  const onboardingToken = data?.onboardingToken || null;
  const onboardingStatus = data?.onboardingStatus || null;

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="page-title">Offer letter</h1>
        <StatusBadge status={offer?.status} />
        <p style={{ marginTop: 12 }}>{offer?.jobTitle || offer?.designation || offer?.position}</p>
        <p className="caption">{offer?.candidate?.fullName}</p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {withdrawn ? (
          <div className="alert" style={{ marginTop: 12 }}>
            This offer has been withdrawn by the employer and can no longer be accepted or signed.
            Please contact HR if you have questions.
          </div>
        ) : null}
        {!closed ? (
          <form className="form-grid" onSubmit={accept} style={{ marginTop: 16 }}>
            <label>Full legal name<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>Your signature</div>
              <SignatureCapture onChange={setSignature} disabled={busy} defaultTypedText={fullName} />
            </div>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              I accept the terms of employment
            </label>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Signing..." : "Accept offer"}</button>
            <button type="button" className="btn-danger" onClick={() => setDeclineOpen(true)}>Decline offer</button>
          </form>
        ) : !withdrawn ? (
          <div style={{ marginTop: 12 }}>
            <p className="caption">This offer has already been answered.</p>
            {onboardingToken ? (
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => goToOnboarding(onboardingToken)}
              >
                {onboardingStatus === "CHANGES_REQUESTED"
                  ? "Continue corrections"
                  : onboardingStatus === "SUBMITTED"
                    ? "View onboarding"
                    : "Continue onboarding"}
              </button>
            ) : onboardingStatus === "APPROVED" ? (
              <p className="caption" style={{ marginTop: 8 }}>
                Onboarding is approved. Check your email for the activation link.
              </p>
            ) : data?.alreadySigned ? (
              <p className="caption" style={{ marginTop: 8 }}>
                Check your inbox for the onboarding invitation email if you need to continue.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title="Decline offer"
        message="Tell HR why you are declining, then confirm."
        confirmLabel="Decline offer"
        danger
        busy={busy}
        onConfirm={decline}
      >
        <label className="form-grid" style={{ marginTop: 12 }}>
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </ConfirmDialog>
    </main>
  );
}

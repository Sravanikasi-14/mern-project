import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import api from "../../services/api";

export default function OfferReviewPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
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

  const accept = async (event) => {
    event.preventDefault();
    if (!fullName.trim() || !consent) {
      setError("Type your legal name and accept the terms to sign.");
      return;
    }
    try {
      setBusy(true);
      const res = await api.post(`/candidate/offers/review/${encodeURIComponent(token)}/accept`, {
        fullName: fullName.trim(),
        legalConsent: true,
      });
      setData((prev) => ({ ...prev, offer: res.data.offer || prev.offer, alreadySigned: true }));
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
  const closed = data?.alreadySigned || data?.alreadyDeclined || ["ACCEPTED", "DECLINED"].includes(offer?.status);

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="page-title">Offer letter</h1>
        <StatusBadge status={offer?.status} />
        <p style={{ marginTop: 12 }}>{offer?.jobTitle || offer?.designation}</p>
        <p className="caption">{offer?.candidate?.fullName}</p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {!closed ? (
          <form className="form-grid" onSubmit={accept} style={{ marginTop: 16 }}>
            <label>Full legal name<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              I accept the terms of employment
            </label>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Signing..." : "Accept offer"}</button>
            <button type="button" className="btn-danger" onClick={() => setDeclineOpen(true)}>Decline offer</button>
          </form>
        ) : (
          <p className="caption" style={{ marginTop: 12 }}>This offer has already been answered.</p>
        )}
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

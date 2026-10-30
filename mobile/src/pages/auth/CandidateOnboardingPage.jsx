import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Expandable from "../../components/Expandable";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import api from "../../services/api";

const emptyPersonal = { fullName: "", preferredName: "", phoneNumber: "", personalPhone: "", dateOfBirth: "", gender: "", city: "" };
const emptyAddress = { street: "", city: "", state: "", postalCode: "", country: "India" };
const emptyEmergency = { name: "", relationship: "", phone: "" };
const emptyBank = { accountHolderName: "", bankName: "", accountNumber: "", ifscCode: "", accountType: "Salary Account" };
const emptyTax = { panNumber: "", taxRegime: "New Tax Regime (Sec 115BAC)" };

export default function CandidateOnboardingPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [personal, setPersonal] = useState(emptyPersonal);
  const [address, setAddress] = useState(emptyAddress);
  const [emergency, setEmergency] = useState(emptyEmergency);
  const [bank, setBank] = useState(emptyBank);
  const [tax, setTax] = useState(emptyTax);
  const [documents, setDocuments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [docTitle, setDocTitle] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/candidate/onboarding/${encodeURIComponent(token)}`);
      const fetched = res.data;
      setData(fetched);
      const ob = fetched.onboarding || {};
      setPersonal({ ...emptyPersonal, ...ob.personalDetails });
      setAddress({ ...emptyAddress, ...ob.residentialAddress });
      setEmergency({ ...emptyEmergency, ...ob.emergencyContact });
      setBank({ ...emptyBank, ...ob.bankDetails });
      setTax({ ...emptyTax, ...ob.taxDetails });
      setDocuments(ob.documents || []);
    } catch (err) {
      setError(err.response?.data?.message || "This onboarding link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const payload = {
    personalDetails: personal,
    residentialAddress: address,
    emergencyContact: emergency,
    bankDetails: bank,
    taxDetails: tax,
  };

  const saveDraft = async () => {
    try {
      setBusy(true);
      await api.put(`/candidate/onboarding/${encodeURIComponent(token)}/draft`, payload);
    } catch (err) {
      setError(err.response?.data?.message || "Could not save draft.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    try {
      setBusy(true);
      const res = await api.post(`/candidate/onboarding/${encodeURIComponent(token)}/submit`, payload);
      setData((prev) => ({ ...prev, onboarding: res.data.onboarding }));
      setSubmitOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Could not submit onboarding.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event) => {
    event.preventDefault();
    if (!file) return;
    try {
      setBusy(true);
      const reader = new FileReader();
      const fileData = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.post(`/candidate/onboarding/${encodeURIComponent(token)}/documents`, {
        documentType: "OTHER",
        title: docTitle.trim() || file.name,
        fileName: file.name,
        fileData,
        mimeType: file.type,
      });
      setDocuments(res.data.documents || []);
      setFile(null);
      setDocTitle("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not upload this document.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="auth-screen"><Skeleton rows={4} /></main>;
  if (error && !data) return <main className="auth-screen"><ErrorState message={error} /><Link to="/login">Go to sign in</Link></main>;

  const submitted = ["SUBMITTED", "APPROVED"].includes(data?.onboarding?.status);

  return (
    <main className="auth-screen" style={{ justifyContent: "flex-start" }}>
      <h1 className="page-title">Candidate onboarding</h1>
      {error ? <div className="alert alert-error">{error}</div> : null}
      <Expandable title="Personal details" defaultOpen>
        <form className="form-grid">
          <label>Full name<input value={personal.fullName} onChange={(event) => setPersonal((prev) => ({ ...prev, fullName: event.target.value }))} /></label>
          <label>Preferred name<input value={personal.preferredName} onChange={(event) => setPersonal((prev) => ({ ...prev, preferredName: event.target.value }))} /></label>
          <label>Phone<input type="tel" value={personal.phoneNumber} onChange={(event) => setPersonal((prev) => ({ ...prev, phoneNumber: event.target.value }))} /></label>
          <label>Date of birth<input type="date" value={personal.dateOfBirth?.substring?.(0, 10) || personal.dateOfBirth} onChange={(event) => setPersonal((prev) => ({ ...prev, dateOfBirth: event.target.value }))} /></label>
          <label>City<input value={personal.city} onChange={(event) => setPersonal((prev) => ({ ...prev, city: event.target.value }))} /></label>
        </form>
      </Expandable>
      <Expandable title="Address">
        <form className="form-grid">
          <label>Street<input value={address.street} onChange={(event) => setAddress((prev) => ({ ...prev, street: event.target.value }))} /></label>
          <label>City<input value={address.city} onChange={(event) => setAddress((prev) => ({ ...prev, city: event.target.value }))} /></label>
          <label>State<input value={address.state} onChange={(event) => setAddress((prev) => ({ ...prev, state: event.target.value }))} /></label>
          <label>Postal code<input value={address.postalCode} onChange={(event) => setAddress((prev) => ({ ...prev, postalCode: event.target.value }))} /></label>
        </form>
      </Expandable>
      <Expandable title="Emergency contact">
        <form className="form-grid">
          <label>Name<input value={emergency.name} onChange={(event) => setEmergency((prev) => ({ ...prev, name: event.target.value }))} /></label>
          <label>Relationship<input value={emergency.relationship} onChange={(event) => setEmergency((prev) => ({ ...prev, relationship: event.target.value }))} /></label>
          <label>Phone<input type="tel" value={emergency.phone} onChange={(event) => setEmergency((prev) => ({ ...prev, phone: event.target.value }))} /></label>
        </form>
      </Expandable>
      <Expandable title="Bank and tax">
        <form className="form-grid">
          <label>Account holder<input value={bank.accountHolderName} onChange={(event) => setBank((prev) => ({ ...prev, accountHolderName: event.target.value }))} /></label>
          <label>Bank<input value={bank.bankName} onChange={(event) => setBank((prev) => ({ ...prev, bankName: event.target.value }))} /></label>
          <label>Account number<input value={bank.accountNumber} onChange={(event) => setBank((prev) => ({ ...prev, accountNumber: event.target.value }))} /></label>
          <label>IFSC<input value={bank.ifscCode} onChange={(event) => setBank((prev) => ({ ...prev, ifscCode: event.target.value }))} /></label>
          <label>PAN<input value={tax.panNumber} onChange={(event) => setTax((prev) => ({ ...prev, panNumber: event.target.value }))} /></label>
        </form>
      </Expandable>
      <Expandable title="Documents">
        {documents.length === 0 ? <EmptyState message="No documents uploaded yet." /> : documents.map((doc) => (
          <p key={doc._id}>{doc.title || doc.fileName}</p>
        ))}
        <form className="form-grid" onSubmit={upload} style={{ marginTop: 12 }}>
          <label>Title<input value={docTitle} onChange={(event) => setDocTitle(event.target.value)} /></label>
          <label>File<input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          <button type="submit" className="btn-secondary" disabled={busy}>Upload document</button>
        </form>
      </Expandable>
      {!submitted ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={saveDraft}>Save draft</button>
          <button type="button" className="btn-primary" onClick={() => setSubmitOpen(true)}>Submit onboarding</button>
        </div>
      ) : (
        <p className="caption" style={{ marginTop: 16 }}>Submitted for HR review.</p>
      )}
      <ConfirmDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit onboarding"
        message="HR will review the details you send."
        confirmLabel="Submit onboarding"
        busy={busy}
        onConfirm={submit}
      />
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import HrPortalHeader from "../../components/HrPortalHeader";
import StatusBadge from "../../components/StatusBadge";
import SegmentedTabs from "../../components/SegmentedTabs";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { initialsFrom } from "../../components/SummaryRow";
import api from "../../services/api";

export default function HrOnboardingPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("progress");
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/onboarding/submissions");
      setItems(res.data?.submissions || res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load onboarding.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (tab === "completed") return items.filter((item) => ["APPROVED", "COMPLETED"].includes(item.status));
    return items.filter((item) => !["APPROVED", "COMPLETED", "REJECTED"].includes(item.status));
  }, [items, tab]);

  const openDetails = async (item) => {
    try {
      const res = await api.get(`/onboarding/submissions/${item._id}`);
      setSelected(res.data?.submission || item);
    } catch {
      setSelected(item);
    }
  };

  const runAction = async () => {
    if (busy || !selected?._id) return;
    if ((action === "reject" || action === "corrections") && !notes.trim()) {
      setError("Notes are required for this action.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      if (action === "approve") await api.post(`/onboarding/submissions/${selected._id}/approve`);
      if (action === "reject") await api.post(`/onboarding/submissions/${selected._id}/reject`, { reason: notes.trim() });
      if (action === "corrections") await api.post(`/onboarding/submissions/${selected._id}/request-corrections`, { remarks: notes.trim() });
      if (action === "resend") await api.post(`/onboarding/submissions/${selected._id}/resend-activation`);
      toast.push("Onboarding updated.");
      setAction(null);
      setSelected(null);
      setNotes("");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update onboarding.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hr-onboarding">
      <HrPortalHeader title="Onboarding" />
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
        ]}
      />
      {loading ? <Skeleton /> : error && items.length === 0 ? <ErrorState message={error} onRetry={load} /> : visible.length === 0 ? (
        <EmptyState message="No onboarding records in this view." />
      ) : visible.map((item) => (
        <div key={item._id} className="card" style={{ padding: 12 }}>
          <button type="button" className="summary-row" style={{ border: "none", padding: 0, margin: 0 }} onClick={() => openDetails(item)}>
            <span className="summary-avatar">{initialsFrom(item.fullName || item.candidateName)}</span>
            <span className="summary-body">
              <span className="summary-title">{item.fullName || item.candidateName}</span>
              <span className="summary-sub">
                {item.jobTitle || item.candidateEmail || item.email || ""}
              </span>
            </span>
            <StatusBadge status={item.status} />
          </button>
          {item.status === "SUBMITTED" ? (
            <div className="row-actions">
              <button type="button" className="btn-danger" onClick={() => { setSelected(item); setAction("reject"); setNotes(""); }}>Reject</button>
              <button type="button" className="btn-primary" onClick={() => { setSelected(item); setAction("approve"); }}>Approve</button>
            </div>
          ) : null}
        </div>
      ))}
      {error && items.length > 0 ? <div className="alert alert-error">{error}</div> : null}
      <Modal open={Boolean(selected) && !action} onClose={() => setSelected(null)} title="Onboarding details">
        {selected ? (
          <>
            <StatusBadge status={selected.status} />
            <p style={{ marginTop: 12 }}>{selected.fullName || selected.candidateName}</p>
            <p className="caption">{selected.candidateEmail || selected.email || "—"}</p>
          </>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => setAction(null)}
        title="Update onboarding"
        message="This uses the same onboarding APIs as the web app."
        confirmLabel="Confirm"
        danger={action === "reject"}
        busy={busy}
        onConfirm={runAction}
      >
        {action === "reject" || action === "corrections" ? (
          <label className="form-grid" style={{ marginTop: 12 }}>
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { useAssetsQuery } from "../../hooks/useEmployeeQueries";
import { invalidateAssets } from "../../app/queryKeys";

function ackStatus(asset) {
  return asset.currentAssignment?.acknowledgementStatus || asset.acknowledgementStatus || "";
}

export default function EmployeeAssetsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const assetsQuery = useAssetsQuery();
  const items = assetsQuery.data || [];
  const [ack, setAck] = useState(null);
  const [error, setError] = useState("");

  const acknowledge = async () => {
    try {
      await api.post(`/assets/my-assets/${ack._id}/acknowledge`);
      toast.push("Asset confirmed.");
      setAck(null);
      await invalidateAssets(queryClient);
    } catch (err) {
      setError(err.response?.data?.message || "Could not confirm this asset.");
    }
  };

  if (assetsQuery.isLoading && items.length === 0) {
    return <><PageHeader title="My assets" back /><Skeleton /></>;
  }
  if (assetsQuery.isError && items.length === 0) {
    return (
      <>
        <PageHeader title="My assets" back />
        <ErrorState
          message={assetsQuery.error?.response?.data?.message || "Could not load assets."}
          onRetry={() => assetsQuery.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="My assets" back />
      {assetsQuery.isFetching && items.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}
      {items.length === 0 ? (
        <EmptyState message="No assets assigned to you." />
      ) : (
        items.map((asset) => (
          <div key={asset._id} className="card compact-card">
            <div className="summary-row" style={{ padding: 0, border: "none" }}>
              <span className="asset-thumb" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></svg>
              </span>
              <span className="summary-body">
                <span className="summary-title">{asset.name}</span>
                <span className="summary-sub">{asset.assetType || asset.type} · {asset.serialNumber || asset.serial || "No serial"}</span>
              </span>
              <StatusBadge status={asset.status} />
            </div>
            {ackStatus(asset) !== "ACKNOWLEDGED" ? (
              <button type="button" className="btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setAck(asset)}>
                Confirm received
              </button>
            ) : (
              <p className="caption" style={{ marginTop: 8 }}>Receipt confirmed</p>
            )}
          </div>
        ))
      )}
      <ConfirmDialog
        open={Boolean(ack)}
        onClose={() => setAck(null)}
        title="Confirm asset"
        message={`Confirm that you have received ${ack?.name}?`}
        confirmLabel="Confirm received"
        onConfirm={acknowledge}
      />
    </>
  );
}

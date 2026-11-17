import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, ToggleLeft, ToggleRight } from "lucide-react";
import ActionFeedbackModal from "../../components/ActionFeedbackModal";
import platformApi from "../../services/platformApi";
import {
  PaLoadingState,
  PaPageHeader,
  formatPaDate,
} from "../../components/platform/paUi";

export default function PlatformModules() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState(null); // { mode, title, message, details }
  const [pendingDisable, setPendingDisable] = useState(null);
  const [impact, setImpact] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["platform", "modules"],
    queryFn: async () => (await platformApi.get("/platform/modules")).data,
  });

  const historyQuery = useQuery({
    queryKey: ["platform", "modules", "history"],
    queryFn: async () => (await platformApi.get("/platform/modules/history")).data,
  });

  const mutation = useMutation({
    mutationFn: async (body) => (await platformApi.patch("/platform/modules", body)).data,
    onSuccess: async (result) => {
      setPendingDisable(null);
      setImpact(null);
      setFeedback({
        mode: "success",
        title: "Settings saved",
        message: result?.unchanged
          ? "No changes were needed — settings already matched."
          : "Global feature settings saved. Tenant APIs enforce the change immediately.",
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["platform", "modules"] }),
        qc.invalidateQueries({ queryKey: ["platform", "modules", "history"] }),
        qc.invalidateQueries({ queryKey: ["platform", "companies"] }),
      ]);
    },
    onError: (err) => {
      setFeedback({
        mode: "error",
        title: "Unable to update features",
        message: err?.response?.data?.message || "Unable to update features.",
      });
    },
  });

  const modules = data?.global?.modules || [];
  const busy = mutation.isPending || previewLoading;

  const onToggleModule = async (mod, nextEnabled) => {
    if (busy) return;
    if (!nextEnabled) {
      setPreviewLoading(true);
      setFeedback({ mode: "loading", title: "Preparing disable", message: "Loading impact…" });
      try {
        const preview = await platformApi.get(`/platform/modules/${mod.key}/impact`, {
          params: { enabled: "false" },
        });
        setImpact(preview.data);
        setPendingDisable({ type: "module", key: mod.key, label: mod.label });
        setFeedback(null);
      } catch (err) {
        setFeedback({
          mode: "error",
          title: "Unable to preview impact",
          message: err?.response?.data?.message || "Unable to preview impact.",
        });
      } finally {
        setPreviewLoading(false);
      }
      return;
    }
    mutation.mutate({ modules: { [mod.key]: true }, confirm: true });
  };

  const onToggleCapability = async (cap, nextEnabled) => {
    if (busy) return;
    if (!nextEnabled) {
      setPendingDisable({ type: "capability", key: cap.key, label: cap.label });
      setImpact(null);
      return;
    }
    mutation.mutate({ capabilities: { [cap.key]: true }, confirm: true });
  };

  const confirmDisable = () => {
    if (!pendingDisable || busy) return;
    if (pendingDisable.type === "module") {
      mutation.mutate({ modules: { [pendingDisable.key]: false }, confirm: true });
    } else {
      mutation.mutate({ capabilities: { [pendingDisable.key]: false }, confirm: true });
    }
  };

  const history = useMemo(() => historyQuery.data?.history || [], [historyQuery.data]);

  return (
    <div>
      <PaPageHeader
        title="Modules & Features"
        description="Global availability controls. Company overrides and subscription plans cannot bypass a global disable."
      />

      <ActionFeedbackModal
        open={Boolean(pendingDisable)}
        mode="confirm"
        danger
        busy={mutation.isPending}
        title={`Disable ${pendingDisable?.label || ""}`}
        message="Restrictive changes take effect immediately for tenant APIs and navigation."
        details={
          impact ? (
            <p className="action-feedback-message" style={{ marginTop: 10 }}>
              Affected companies: <strong>{impact.affectedCompanies}</strong> of {impact.totalCompanies}
            </p>
          ) : null
        }
        confirmLabel={mutation.isPending ? "Disabling…" : "Confirm disable"}
        onConfirm={confirmDisable}
        onClose={() => {
          if (mutation.isPending) return;
          setPendingDisable(null);
          setImpact(null);
        }}
      />

      <ActionFeedbackModal
        open={Boolean(feedback)}
        mode={feedback?.mode || "success"}
        title={feedback?.title || ""}
        message={feedback?.message || ""}
        onClose={() => setFeedback(null)}
      />

      {isLoading ? <PaLoadingState title="Loading catalogue" message="Fetching global module settings…" /> : null}

      {(modules || []).map((mod) => (
        <div className="pa-panel" key={mod.key}>
          <div className="pa-toolbar is-between" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{mod.label}</h2>
              <div className="pa-entity-meta">
                <code className="pa-code">{mod.key}</code>
                {isFetching && !isLoading ? <span className="pa-muted"> · Refreshing…</span> : null}
              </div>
            </div>
            <button
              type="button"
              className="pa-btn pa-btn-secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => onToggleModule(mod, !mod.enabled)}
              title={mod.enabled ? "Disable globally" : "Enable globally"}
            >
              {mod.enabled ? <ToggleRight size={18} strokeWidth={2} /> : <ToggleLeft size={18} strokeWidth={2} />}
              {mod.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>HR permission</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(mod.capabilities || []).map((cap) => (
                  <tr key={cap.key}>
                    <td>
                      <div className="pa-entity-name">{cap.label}</div>
                      <div className="pa-entity-meta">{cap.key}</div>
                    </td>
                    <td>{cap.hrPermission || "—"}</td>
                    <td>
                      <span className={`pa-badge ${cap.enabled ? "is-success" : "is-danger"}`}>
                        {cap.enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pa-btn pa-btn-secondary"
                        disabled={busy || (!mod.enabled && !cap.enabled)}
                        onClick={() => onToggleCapability(cap, !cap.enabled)}
                      >
                        {cap.enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>
            <History size={16} strokeWidth={2} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
            Change history
          </h2>
        </div>
        {(history || []).length === 0 ? (
          <p className="pa-muted">No feature changes recorded yet.</p>
        ) : (
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Details</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.action}</td>
                    <td>{row.actorEmail || "—"}</td>
                    <td>
                      <code className="pa-code">
                        {JSON.stringify(row.metadata?.changes || row.metadata || {})}
                      </code>
                    </td>
                    <td>{formatPaDate(row.timestamp, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

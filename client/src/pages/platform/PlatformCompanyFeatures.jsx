import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ActionFeedbackModal from "../../components/ActionFeedbackModal";
import platformApi from "../../services/platformApi";

export default function PlatformCompanyFeatures({ companyId }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["platform", "company-features", companyId],
    queryFn: async () =>
      (await platformApi.get(`/platform/companies/${companyId}/features`)).data,
    enabled: Boolean(companyId),
  });

  const mutation = useMutation({
    mutationFn: async (body) =>
      (await platformApi.patch(`/platform/companies/${companyId}/features`, body)).data,
    onSuccess: async () => {
      setPending(null);
      setFeedback({
        mode: "success",
        title: "Feature access updated",
        message: "Company feature access updated. Effective entitlements apply immediately.",
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["platform", "company-features", companyId] }),
        qc.invalidateQueries({ queryKey: ["platform", "company", companyId] }),
      ]);
    },
    onError: (err) => {
      setFeedback({
        mode: "error",
        title: "Update failed",
        message: err?.response?.data?.message || "Update failed.",
      });
    },
  });

  if (isLoading) return <p className="pa-muted">Loading feature access…</p>;
  if (!data) return <p className="pa-error">Unable to load feature access.</p>;

  const busy = mutation.isPending;

  const confirmPending = () => {
    if (!pending || busy) return;
    if (pending.type === "module") {
      mutation.mutate({ modules: { [pending.key]: pending.enabled }, confirm: true });
    } else {
      mutation.mutate({ capabilities: { [pending.key]: pending.enabled }, confirm: true });
    }
  };

  return (
    <div className="pa-panel">
      <h2>Feature Access</h2>
      <p className="pa-muted">
        Plan: <strong>{data.company?.plan}</strong>. Effective availability = global AND company AND
        plan. Company overrides cannot bypass a global restriction.
        {isFetching && !isLoading ? " · Refreshing…" : null}
      </p>

      <ActionFeedbackModal
        open={Boolean(pending)}
        mode="confirm"
        danger={!pending?.enabled}
        busy={busy}
        title={`${pending?.enabled ? "Enable" : "Disable"} ${pending?.label || ""}`}
        message={`Confirm ${pending?.enabled ? "enable" : "disable"} for this company?`}
        confirmLabel={busy ? "Saving…" : "Confirm"}
        onConfirm={confirmPending}
        onClose={() => {
          if (busy) return;
          setPending(null);
        }}
      />

      <ActionFeedbackModal
        open={Boolean(feedback)}
        mode={feedback?.mode || "success"}
        title={feedback?.title || ""}
        message={feedback?.message || ""}
        onClose={() => setFeedback(null)}
      />

      {(data.modules || []).map((mod) => (
        <div key={mod.key} style={{ marginBottom: 18 }}>
          <div className="pa-toolbar" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{mod.label}</strong>
              <div className="pa-muted">
                {mod.effective ? "Available" : mod.reasonLabel || "Unavailable"}
                {!mod.globalEnabled ? " · Global off" : ""}
                {!mod.planEntitled ? " · Plan excludes" : ""}
                {mod.companyOverride === false ? " · Company off" : ""}
                {mod.companyOverride === true ? " · Company on" : ""}
              </div>
            </div>
            <div className="pa-toolbar">
              <button
                type="button"
                className="pa-btn pa-btn-secondary"
                disabled={busy || !mod.globalEnabled || !mod.planEntitled}
                onClick={() =>
                  setPending({
                    type: "module",
                    key: mod.key,
                    label: mod.label,
                    enabled: mod.companyOverride === false,
                  })
                }
              >
                {mod.companyOverride === false ? "Enable for company" : "Disable for company"}
              </button>
            </div>
          </div>
          {(mod.capabilities || []).length ? (
            <div className="pa-table-wrap" style={{ marginTop: 8 }}>
              <table className="pa-table">
                <tbody>
                  {(mod.capabilities || []).map((cap) => (
                    <tr key={cap.key}>
                      <td>{cap.label}</td>
                      <td className="pa-muted">
                        {cap.effective ? "Available" : cap.reasonLabel || "Unavailable"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pa-btn pa-btn-secondary"
                          disabled={busy || !cap.globalEnabled || !mod.globalEnabled}
                          onClick={() =>
                            setPending({
                              type: "capability",
                              key: cap.key,
                              label: cap.label,
                              enabled: cap.companyOverride === false,
                            })
                          }
                        >
                          {cap.companyOverride === false ? "Enable" : "Disable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

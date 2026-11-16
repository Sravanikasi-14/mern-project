import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import platformApi from "../../services/platformApi";
import { PaAlert } from "../../components/platform/paUi";

export default function PlatformCompanyFeatures({ companyId }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
      setMessage("Company feature access updated. Effective entitlements apply immediately.");
      setError("");
      setPending(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["platform", "company-features", companyId] }),
        qc.invalidateQueries({ queryKey: ["platform", "company", companyId] }),
      ]);
    },
    onError: (err) => {
      setMessage("");
      setError(err?.response?.data?.message || "Update failed.");
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
      {message ? <PaAlert tone="success">{message}</PaAlert> : null}
      {error ? <PaAlert tone="error">{error}</PaAlert> : null}
      {busy ? <PaAlert tone="info">Saving company feature access…</PaAlert> : null}

      {pending ? (
        <div className="pa-toolbar">
          <span>
            Confirm {pending.enabled ? "enable" : "disable"} <strong>{pending.label}</strong>?
          </span>
          <button
            type="button"
            className="pa-btn pa-btn-danger"
            disabled={busy}
            onClick={confirmPending}
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button
            type="button"
            className="pa-btn pa-btn-secondary"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

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
              <span className={`pa-badge${mod.effective ? "" : " is-danger"}`}>
                {mod.effective ? "Effective on" : "Effective off"}
              </span>
              <button
                type="button"
                className="pa-btn pa-btn-secondary"
                disabled={busy || !mod.globalEnabled || !mod.planEntitled}
                title={
                  !mod.globalEnabled
                    ? "Blocked by global restriction"
                    : !mod.planEntitled
                      ? "Not in subscription plan"
                      : ""
                }
                onClick={() =>
                  setPending({
                    type: "module",
                    key: mod.key,
                    label: mod.label,
                    enabled: mod.companyOverride === false ? true : false,
                  })
                }
              >
                {mod.companyOverride === false ? "Clear company disable" : "Disable for company"}
              </button>
            </div>
          </div>
          <table className="pa-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Effective</th>
                <th>Why</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(mod.capabilities || []).map((cap) => (
                <tr key={cap.key}>
                  <td>
                    {cap.label}
                    <div className="pa-muted">{cap.key}</div>
                  </td>
                  <td>
                    <span className={`pa-badge${cap.effective ? "" : " is-warn"}`}>
                      {cap.effective ? "On" : "Off"}
                    </span>
                  </td>
                  <td className="pa-muted">{cap.effective ? "—" : cap.reasonLabel}</td>
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
                      {cap.companyOverride === false ? "Clear override" : "Disable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import platformApi from "../../services/platformApi";
import { PaAlert, PaLoadingState, PaPageHeader } from "../../components/platform/paUi";

export default function PlatformSettingsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [general, setGeneral] = useState(null);
  const [security, setSecurity] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [auditFilters, setAuditFilters] = useState({
    action: "",
    targetType: "",
    targetId: "",
    from: "",
    to: "",
  });

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ["platform", "settings"],
    queryFn: async () => (await platformApi.get("/platform/settings")).data,
  });

  const auditQuery = useQuery({
    queryKey: ["platform", "audit", auditFilters],
    queryFn: async () =>
      (
        await platformApi.get("/platform/audit", {
          params: {
            action: auditFilters.action || undefined,
            targetType: auditFilters.targetType || undefined,
            targetId: auditFilters.targetId || undefined,
            from: auditFilters.from || undefined,
            to: auditFilters.to || undefined,
            limit: 40,
          },
        })
      ).data,
  });

  useEffect(() => {
    if (!data?.settings) return;
    setGeneral({ ...data.settings.general });
    setSecurity({ ...data.settings.security });
    setMaintenance({ ...data.settings.maintenance });
  }, [data?.settings]);

  const saveMutation = useMutation({
    mutationFn: async (body) => (await platformApi.patch("/platform/settings", body)).data,
    onSuccess: () => {
      setMessage("Settings saved.");
      setError("");
      qc.invalidateQueries({ queryKey: ["platform", "settings"] });
      qc.invalidateQueries({ queryKey: ["platform", "audit"] });
      qc.invalidateQueries({ queryKey: ["platform", "insights"] });
    },
    onError: (err) => setError(err?.response?.data?.message || "Save failed."),
  });

  if (isLoading && !general) {
    return (
      <div>
        <PaPageHeader title="Settings" description="Platform-wide configuration and append-only audit history." />
        <PaLoadingState title="Loading settings" message="Fetching platform configuration…" />
      </div>
    );
  }

  if (isError || (!isLoading && (!general || !security || !maintenance))) {
    return (
      <div>
        <PaPageHeader title="Settings" description="Platform-wide configuration and append-only audit history." />
        <PaAlert tone="error">
          {loadError?.response?.data?.message || loadError?.message || "Unable to load platform settings."}
        </PaAlert>
        <button type="button" className="pa-btn pa-btn-secondary" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <PaPageHeader
        title="Settings"
        description="Platform-wide configuration. Audit log is append-only. Tenant APIs cannot change these settings."
      />
      {message ? <PaAlert tone="success">{message}</PaAlert> : null}
      {error ? <PaAlert tone="error">{error}</PaAlert> : null}

      <div className="pa-panel">
        <h2>General</h2>
        <div className="pa-form-grid">
          <label>
            Platform name
            <input
              className="pa-input"
              value={general.platformName || ""}
              onChange={(e) => setGeneral((p) => ({ ...p, platformName: e.target.value }))}
            />
          </label>
          <label>
            Support email
            <input
              className="pa-input"
              value={general.supportEmail || ""}
              onChange={(e) => setGeneral((p) => ({ ...p, supportEmail: e.target.value }))}
            />
          </label>
          <label>
            Default timezone
            <input
              className="pa-input"
              value={general.defaultTimezone || ""}
              onChange={(e) => setGeneral((p) => ({ ...p, defaultTimezone: e.target.value }))}
            />
          </label>
          <label>
            Default currency
            <input
              className="pa-input"
              value={general.defaultCurrency || ""}
              onChange={(e) => setGeneral((p) => ({ ...p, defaultCurrency: e.target.value }))}
            />
          </label>
          <label className="pa-span-2">
            Branding tagline
            <input
              className="pa-input"
              value={general.brandingTagline || ""}
              onChange={(e) => setGeneral((p) => ({ ...p, brandingTagline: e.target.value }))}
            />
          </label>
        </div>
        <button
          type="button"
          className="pa-btn pa-btn-primary"
          onClick={() => saveMutation.mutate({ general })}
        >
          Save general
        </button>
      </div>

      <div className="pa-panel">
        <h2>Security</h2>
        <p className="pa-muted">
          Platform Admin MFA is mandatory and cannot be disabled. Rate-limit fields document policy;
          middleware enforces limits.
        </p>
        <div className="pa-form-grid">
          <label>
            MFA required
            <input className="pa-input" value="Always required" disabled />
          </label>
          <label>
            Platform session hours
            <input
              className="pa-input"
              type="number"
              min={1}
              max={72}
              value={security.platformSessionHours || 8}
              onChange={(e) =>
                setSecurity((p) => ({ ...p, platformSessionHours: Number(e.target.value) }))
              }
            />
          </label>
          <label>
            Login attempts / window
            <input
              className="pa-input"
              type="number"
              min={1}
              value={security.loginRateLimitPerWindow || 10}
              onChange={(e) =>
                setSecurity((p) => ({ ...p, loginRateLimitPerWindow: Number(e.target.value) }))
              }
            />
          </label>
          <label>
            Login window (minutes)
            <input
              className="pa-input"
              type="number"
              min={1}
              value={security.loginRateLimitWindowMinutes || 15}
              onChange={(e) =>
                setSecurity((p) => ({
                  ...p,
                  loginRateLimitWindowMinutes: Number(e.target.value),
                }))
              }
            />
          </label>
          <label>
            MFA attempts / window
            <input
              className="pa-input"
              type="number"
              min={1}
              value={security.mfaRateLimitPerWindow || 20}
              onChange={(e) =>
                setSecurity((p) => ({ ...p, mfaRateLimitPerWindow: Number(e.target.value) }))
              }
            />
          </label>
        </div>
        <button
          type="button"
          className="pa-btn pa-btn-primary"
          onClick={() => saveMutation.mutate({ security })}
        >
          Save security
        </button>
      </div>

      <div className="pa-panel">
        <h2>Maintenance</h2>
        <p className="pa-muted">
          When enabled, tenant login and authenticated tenant APIs return 503. Platform Admin remains
          available. Company data is not modified.
        </p>
        <label className="pa-check">
          <input
            type="checkbox"
            checked={Boolean(maintenance.enabled)}
            onChange={(e) => setMaintenance((p) => ({ ...p, enabled: e.target.checked }))}
          />
          Enable maintenance mode
        </label>
        <label>
          Message
          <textarea
            className="pa-input"
            rows={3}
            value={maintenance.message || ""}
            onChange={(e) => setMaintenance((p) => ({ ...p, message: e.target.value }))}
          />
        </label>
        <div className="pa-form-grid">
          <label>
            Planned start
            <input
              className="pa-input"
              type="datetime-local"
              value={
                maintenance.plannedStart
                  ? new Date(maintenance.plannedStart).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                setMaintenance((p) => ({
                  ...p,
                  plannedStart: e.target.value ? new Date(e.target.value).toISOString() : null,
                }))
              }
            />
          </label>
          <label>
            Planned end
            <input
              className="pa-input"
              type="datetime-local"
              value={
                maintenance.plannedEnd
                  ? new Date(maintenance.plannedEnd).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                setMaintenance((p) => ({
                  ...p,
                  plannedEnd: e.target.value ? new Date(e.target.value).toISOString() : null,
                }))
              }
            />
          </label>
        </div>
        <button
          type="button"
          className="pa-btn pa-btn-danger"
          onClick={() => {
            if (
              !window.confirm(
                maintenance.enabled
                  ? "Enable maintenance mode? Tenant access will be blocked."
                  : "Disable maintenance mode?"
              )
            ) {
              return;
            }
            saveMutation.mutate({
              maintenance: {
                enabled: maintenance.enabled,
                message: maintenance.message,
                plannedStart: maintenance.plannedStart,
                plannedEnd: maintenance.plannedEnd,
              },
              confirm: true,
            });
          }}
        >
          Save maintenance
        </button>
      </div>

      <div className="pa-panel">
        <h2>Administrative activity</h2>
        <div className="pa-toolbar">
          <select
            className="pa-select"
            value={auditFilters.action}
            onChange={(e) => setAuditFilters((p) => ({ ...p, action: e.target.value }))}
          >
            <option value="">All actions</option>
            {(auditQuery.data?.actions || []).map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <input
            className="pa-input"
            placeholder="Target type"
            value={auditFilters.targetType}
            onChange={(e) => setAuditFilters((p) => ({ ...p, targetType: e.target.value }))}
          />
          <input
            className="pa-input"
            placeholder="Target id"
            value={auditFilters.targetId}
            onChange={(e) => setAuditFilters((p) => ({ ...p, targetId: e.target.value }))}
          />
          <input
            className="pa-input"
            type="date"
            value={auditFilters.from}
            onChange={(e) => setAuditFilters((p) => ({ ...p, from: e.target.value }))}
          />
          <input
            className="pa-input"
            type="date"
            value={auditFilters.to}
            onChange={(e) => setAuditFilters((p) => ({ ...p, to: e.target.value }))}
          />
        </div>
        <table className="pa-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Actor</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {(auditQuery.data?.entries || []).map((row) => (
              <tr key={row.id}>
                <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</td>
                <td>{row.action}</td>
                <td>{row.outcome}</td>
                <td>{row.actorEmail}</td>
                <td>
                  {row.targetType} {row.targetId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(auditQuery.data?.entries || []).length === 0 ? (
          <p className="pa-muted">No audit entries for this filter.</p>
        ) : null}
      </div>
    </div>
  );
}

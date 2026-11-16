import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import platformApi from "../../services/platformApi";
import PlatformCompanyFeatures from "./PlatformCompanyFeatures";
import PlatformCompanySubscription from "./PlatformCompanySubscription";
import {
  PaAlert,
  PaErrorState,
  PaLoadingState,
  PaPageHeader,
  PaStatusBadge,
} from "../../components/platform/paUi";

export default function PlatformCompanyDetail() {
  const { companyId } = useParams();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ["platform", "company", companyId],
    queryFn: async () => (await platformApi.get(`/platform/companies/${companyId}`)).data,
    enabled: Boolean(companyId),
    retry: 1,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["platform", "company", companyId] });
    qc.invalidateQueries({ queryKey: ["platform", "companies"] });
    qc.invalidateQueries({ queryKey: ["platform", "overview"] });
  };

  const statusMutation = useMutation({
    mutationFn: async (status) =>
      (
        await platformApi.post(`/platform/companies/${companyId}/status`, {
          status,
          confirm: true,
        })
      ).data,
    onSuccess: () => {
      setMessage("Status updated.");
      setError("");
      invalidate();
    },
    onError: (err) => setError(err?.response?.data?.message || "Status update failed."),
  });

  const reprovisionMutation = useMutation({
    mutationFn: async () =>
      (await platformApi.post(`/platform/companies/${companyId}/reprovision`)).data,
    onSuccess: (result) => {
      setMessage(result.provisioning?.message || "Provisioning finished.");
      setError("");
      invalidate();
    },
    onError: (err) => setError(err?.response?.data?.message || "Provisioning failed."),
  });

  if (isLoading) {
    return (
      <div>
        <PaPageHeader title="Company" description="Loading company metadata…" />
        <PaLoadingState title="Loading company" />
      </div>
    );
  }

  if (isError) {
    const status = loadError?.response?.status;
    const title = status === 404 ? "Company not found" : "Unable to load company";
    const message =
      loadError?.response?.data?.message ||
      (status === 404
        ? "This company may have been removed or the link is invalid."
        : "A temporary error occurred while loading company metadata.");
    return (
      <div>
        <PaPageHeader title="Company" />
        <PaErrorState title={title} message={message} />
        <div className="pa-toolbar">
          <button type="button" className="pa-btn pa-btn-secondary" onClick={() => refetch()}>
            Retry
          </button>
          <Link className="pa-link" to="/platform/companies">
            Back to companies
          </Link>
        </div>
      </div>
    );
  }

  const company = data?.company;
  if (!company) {
    return (
      <div>
        <PaPageHeader title="Company" />
        <PaErrorState title="Company not found" message="This company may have been removed or the link is invalid." />
        <Link className="pa-link" to="/platform/companies">
          Back to companies
        </Link>
      </div>
    );
  }

  return (
    <div>
      <nav className="pa-breadcrumb" aria-label="Breadcrumb">
        <Link to="/platform/companies">Companies</Link>
        <span aria-hidden>/</span>
        <span>{company.slug}</span>
      </nav>
      <PaPageHeader
        title={company.companyName}
        description="Approved company metadata only — no employee or payroll data."
      />

      {message ? <PaAlert tone="success">{message}</PaAlert> : null}
      {error ? <PaAlert tone="error">{error}</PaAlert> : null}

      <div className="pa-grid-stats">
        <div className="pa-stat">
          <div className="pa-stat-label">Status</div>
          <div className="pa-stat-value" style={{ fontSize: "1.35rem" }}>
            <PaStatusBadge status={company.status} />
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Plan</div>
          <div className="pa-stat-value" style={{ fontSize: "1.45rem" }}>
            {company.subscription?.plan || "—"}
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Seats</div>
          <div className="pa-stat-value" style={{ fontSize: "1.45rem" }}>
            {company.subscription?.maxEmployeeSeats ?? "—"}
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Provisioning</div>
          <div className="pa-stat-value" style={{ fontSize: "1.35rem" }}>
            <PaStatusBadge status={company.provisioning?.lastStatus || "UNKNOWN"} />
          </div>
        </div>
      </div>

      <div className="pa-toolbar">
        {company.status !== "ACTIVE" ? (
          <button
            type="button"
            className="pa-btn pa-btn-primary"
            disabled={statusMutation.isPending}
            onClick={() => {
              if (window.confirm("Activate this company?")) statusMutation.mutate("ACTIVE");
            }}
          >
            Activate
          </button>
        ) : null}
        {company.status !== "SUSPENDED" ? (
          <button
            type="button"
            className="pa-btn pa-btn-danger"
            disabled={statusMutation.isPending}
            onClick={() => {
              if (window.confirm("Suspend this company? Tenant data will not be deleted.")) {
                statusMutation.mutate("SUSPENDED");
              }
            }}
          >
            Suspend
          </button>
        ) : null}
        <button
          type="button"
          className="pa-btn pa-btn-secondary"
          disabled={reprovisionMutation.isPending}
          onClick={() => reprovisionMutation.mutate()}
        >
          {reprovisionMutation.isPending ? "Reprovisioning…" : "Re-run provisioning"}
        </button>
      </div>

      <div className="pa-panel">
        <h2>Metadata</h2>
        <table className="pa-table">
          <tbody>
            <tr>
              <th>Code</th>
              <td>{company.slug}</td>
            </tr>
            <tr>
              <th>Timezone</th>
              <td>{company.config?.timezone || "—"}</td>
            </tr>
            <tr>
              <th>Currency</th>
              <td>{company.config?.currencyCode || "—"}</td>
            </tr>
            <tr>
              <th>Primary contact</th>
              <td>
                {company.primaryContact?.fullName || "—"}
                <div className="pa-muted">{company.primaryContact?.email}</div>
              </td>
            </tr>
            <tr>
              <th>Provisioning message</th>
              <td>{company.provisioning?.lastMessage || "—"}</td>
            </tr>
            <tr>
              <th>Index schema version</th>
              <td>{company.provisioning?.tenantIndexSchemaVersion ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <PlatformCompanySubscription companyId={companyId} />
      <PlatformCompanyFeatures companyId={companyId} />

      <div className="pa-panel">
        <h2>Lifecycle history</h2>
        {(company.lifecycleHistory || []).length === 0 ? (
          <p className="pa-muted">No lifecycle events yet.</p>
        ) : (
          <table className="pa-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...company.lifecycleHistory].reverse().map((row, idx) => (
                <tr key={`${row.action}-${idx}`}>
                  <td>{row.action}</td>
                  <td>{row.at ? new Date(row.at).toLocaleString() : "—"}</td>
                  <td>{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="pa-panel">
        <h2>Audit trail</h2>
        {(data.auditHistory || []).length === 0 ? (
          <p className="pa-muted">No audit rows.</p>
        ) : (
          <table className="pa-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Outcome</th>
                <th>Actor</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.auditHistory.map((row) => (
                <tr key={row.id}>
                  <td>{row.action}</td>
                  <td>{row.outcome}</td>
                  <td>{row.actorEmail || "—"}</td>
                  <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, Building2, Database, Server } from "lucide-react";
import platformApi from "../../services/platformApi";
import {
  PaEmptyState,
  PaErrorState,
  PaLoadingState,
  PaPageHeader,
  PaStatusBadge,
  PaUnavailableMetrics,
  formatPaDate,
} from "../../components/platform/paUi";

export default function PlatformOverview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: async () => (await platformApi.get("/platform/overview")).data,
  });

  if (isLoading) {
    return (
      <div>
        <PaPageHeader
          title="Overview"
          description="Central platform metadata and operational health."
        />
        <PaLoadingState title="Loading overview" message="Fetching company and provisioning metrics…" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PaPageHeader title="Overview" description="Central platform metadata and operational health." />
        <PaErrorState message={error?.response?.data?.message || "Failed to load overview."} />
      </div>
    );
  }

  const byStatus = data.companies?.byStatus || {};
  const ops = data.operationalStatus || {};
  const recent = data.recentlyRegistered || [];

  return (
    <div>
      <PaPageHeader
        title="Overview"
        description="Central metadata only. Employee and usage totals that require tenant databases are listed as unavailable — never invented."
        actions={
          <Link to="/platform/companies" className="pa-btn pa-btn-secondary">
            <Building2 size={16} strokeWidth={2} />
            View companies
          </Link>
        }
      />

      <div className="pa-grid-stats">
        <div className="pa-stat is-accent">
          <div className="pa-stat-label">Total companies</div>
          <div className="pa-stat-value">{data.companies?.total ?? 0}</div>
          <div className="pa-stat-hint">Registered in central database</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Active</div>
          <div className="pa-stat-value">{byStatus.ACTIVE ?? 0}</div>
          <div className="pa-stat-hint">Can sign in to tenant portals</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Suspended</div>
          <div className="pa-stat-value">{byStatus.SUSPENDED ?? 0}</div>
          <div className="pa-stat-hint">Tenant data retained</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Trial</div>
          <div className="pa-stat-value">{byStatus.TRIAL ?? 0}</div>
          <div className="pa-stat-hint">Company lifecycle status</div>
        </div>
      </div>

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>Operational status</h2>
          <p className="pa-panel-desc">Live connectivity signals from this API process.</p>
        </div>
        <div className="pa-health-row">
          <span className="pa-health-pill">
            <Server size={14} strokeWidth={2} aria-hidden />
            API
            <span className={`pa-health-dot${ops.api === "ok" ? "" : " is-warn"}`} />
            <strong>{ops.api || "—"}</strong>
          </span>
          <span className="pa-health-pill">
            <Database size={14} strokeWidth={2} aria-hidden />
            Central DB
            <span className={`pa-health-dot${ops.centralDb === "connected" ? "" : " is-warn"}`} />
            <strong>{ops.centralDb || "—"}</strong>
          </span>
          <span className="pa-health-pill">
            <Activity size={14} strokeWidth={2} aria-hidden />
            As of {formatPaDate(ops.timestamp, true)}
          </span>
        </div>
      </div>

      <div className="pa-panel-split">
        <section className="pa-panel" style={{ marginBottom: 0 }}>
          <div className="pa-panel-head">
            <h2>Subscription summary</h2>
            <p className="pa-panel-desc">From Company.subscription.plan in the central database.</p>
          </div>
          {(data.subscriptionSummary?.byPlan || []).length === 0 ? (
            <PaEmptyState title="No subscription metadata" message="Plan codes will appear once companies have subscription.plan set." />
          ) : (
            <div className="pa-table-wrap">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Companies</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptionSummary.byPlan.map((row) => (
                    <tr key={row.plan}>
                      <td>
                        <PaStatusBadge status={row.plan} tone={row.plan === "TRIAL" ? "info" : "neutral"} />
                      </td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.subscriptionSummary?.note ? (
            <p className="pa-section-note">{data.subscriptionSummary.note}</p>
          ) : null}
        </section>

        <section className="pa-panel" style={{ marginBottom: 0 }}>
          <div className="pa-panel-head">
            <h2>Tenant provisioning</h2>
            <p className="pa-panel-desc">Central provisioning stamps only — no live tenant probes.</p>
          </div>
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.provisioning?.byStatus || {}).map(([status, count]) => (
                  <tr key={status}>
                    <td>
                      <PaStatusBadge status={status} />
                    </td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.provisioning?.note ? <p className="pa-section-note">{data.provisioning.note}</p> : null}
        </section>
      </div>

      <section className="pa-panel">
        <div className="pa-panel-head">
          <h2>Recently registered</h2>
          <p className="pa-panel-desc">Newest company records from the central registry.</p>
        </div>
        {recent.length === 0 ? (
          <PaEmptyState
            title="No companies yet"
            message="Register a company to provision a tenant database."
            action={
              <Link to="/platform/companies" className="pa-btn pa-btn-primary" style={{ marginTop: 10 }}>
                Register company
              </Link>
            }
          />
        ) : (
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Provisioning</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="pa-link" to={`/platform/companies/${c.id}`}>
                        {c.companyName}
                      </Link>
                      <div className="pa-entity-meta">{c.slug}</div>
                    </td>
                    <td>
                      <PaStatusBadge status={c.status} />
                    </td>
                    <td>{c.plan || "—"}</td>
                    <td>
                      <PaStatusBadge status={c.provisioningStatus} />
                    </td>
                    <td>{formatPaDate(c.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PaUnavailableMetrics metrics={data.unavailableMetrics || []} title="Unavailable metrics" />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Database, Server } from "lucide-react";
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

function MiniBars({ series, valueKey = "count" }) {
  const rows = series || [];
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  return (
    <div className="pa-bars" aria-hidden>
      {rows.map((row) => {
        const value = Number(row[valueKey]) || 0;
        const height = Math.max(2, Math.round((value / max) * 56));
        return (
          <div key={row.date} className="pa-bar-col" title={`${row.date}: ${value}`}>
            <div className="pa-bar" style={{ height }} />
          </div>
        );
      })}
    </div>
  );
}

function MetricOrUnavailable({ available, children, reason }) {
  if (available === false) {
    return (
      <div className="pa-alert is-info" style={{ marginTop: 4 }}>
        <div>
          <strong>Unavailable</strong>
          <div className="pa-muted" style={{ marginTop: 2 }}>
            {reason || "No reliable measurement source."}
          </div>
        </div>
      </div>
    );
  }
  return children;
}

export default function PlatformInsights() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "insights"],
    queryFn: async () => (await platformApi.get("/platform/insights")).data,
  });

  if (isLoading) {
    return (
      <div>
        <PaPageHeader
          title="Platform Insights"
          description="Central metadata and safe aggregates only."
        />
        <PaLoadingState title="Loading insights" message="Aggregating platform metrics…" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PaPageHeader title="Platform Insights" description="Central metadata and safe aggregates only." />
        <PaErrorState message={error?.response?.data?.message || "Failed to load insights."} />
      </div>
    );
  }

  const companies = data.companies || {};
  const subs = data.subscriptions || {};
  const usage = data.usage || {};
  const health = data.systemHealth || {};

  return (
    <div>
      <PaPageHeader
        title="Platform Insights"
        description="Central metadata and safe aggregates only. Unavailable metrics are labeled — never shown as zero."
      />

      <div className="pa-grid-stats">
        <div className="pa-stat is-accent">
          <div className="pa-stat-label">Companies</div>
          <div className="pa-stat-value">{companies.total ?? "—"}</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Active</div>
          <div className="pa-stat-value">{companies.byStatus?.ACTIVE ?? "—"}</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Suspended</div>
          <div className="pa-stat-value">{companies.byStatus?.SUSPENDED ?? "—"}</div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">New (30d)</div>
          <div className="pa-stat-value">{companies.growth?.last30Days ?? "—"}</div>
        </div>
      </div>

      <div className="pa-panel-split">
        <section className="pa-panel" style={{ marginBottom: 0 }}>
          <div className="pa-panel-head">
            <h2>Company registrations (30 days)</h2>
          </div>
          <MiniBars series={companies.registrationsLast30Days} />
        </section>
        <section className="pa-panel" style={{ marginBottom: 0 }}>
          <div className="pa-panel-head">
            <h2>Companies by plan</h2>
          </div>
          {(companies.byPlan || []).length === 0 ? (
            <PaEmptyState title="No plan distribution" message="Plan codes appear from central subscription.plan." />
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
                  {companies.byPlan.map((row) => (
                    <tr key={row.plan}>
                      <td>{row.plan}</td>
                      <td>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>Subscription analytics</h2>
          <p className="pa-panel-desc">Lifecycle and billing signals from central company and invoice records.</p>
        </div>
        <div className="pa-grid-stats">
          {Object.entries(subs.byStatus || {}).map(([status, count]) => (
            <div className="pa-stat" key={status}>
              <div className="pa-stat-label">{status}</div>
              <div className="pa-stat-value" style={{ fontSize: "1.35rem" }}>
                {count}
              </div>
            </div>
          ))}
        </div>
        <h3>Subscription changes (30 days)</h3>
        <MiniBars series={subs.changesLast30Days} />
        <h3>Upcoming renewals (14 days)</h3>
        {(subs.upcomingRenewals || []).length === 0 ? (
          <p className="pa-muted">No renewals in the next 14 days.</p>
        ) : (
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Renewal</th>
                </tr>
              </thead>
              <tbody>
                {subs.upcomingRenewals.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="pa-entity-name">{row.companyName}</div>
                      <div className="pa-entity-meta">{row.slug}</div>
                    </td>
                    <td>{row.plan}</td>
                    <td>
                      <PaStatusBadge status={row.status} />
                    </td>
                    <td>{formatPaDate(row.renewalDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3>Invoice totals by payment status</h3>
        {(subs.invoiceTotalsByPaymentStatus || []).length === 0 ? (
          <p className="pa-muted">No invoices yet.</p>
        ) : (
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Payment status</th>
                  <th>Count</th>
                  <th>Total amount</th>
                </tr>
              </thead>
              <tbody>
                {subs.invoiceTotalsByPaymentStatus.map((row) => (
                  <tr key={row.paymentStatus}>
                    <td>
                      <PaStatusBadge status={row.paymentStatus} />
                    </td>
                    <td>{row.count}</td>
                    <td>{row.totalAmount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>Platform usage</h2>
          <p className="pa-panel-desc">Seat counters are central reservations — not live employee headcounts.</p>
        </div>
        <h3>Seat utilization</h3>
        <MetricOrUnavailable available={usage.seatUtilization?.available !== false}>
          <p>
            Used {usage.seatUtilization?.usedSeats ?? 0} / allocated{" "}
            {usage.seatUtilization?.allocatedSeats ?? 0} seats across{" "}
            {usage.seatUtilization?.companiesReportingUsage ?? 0} companies reporting usage.
          </p>
          <p className="pa-section-note">{usage.seatUtilization?.note}</p>
        </MetricOrUnavailable>

        <h3>Storage consumption</h3>
        <MetricOrUnavailable
          available={usage.storageConsumption?.available}
          reason={usage.storageConsumption?.reason}
        />

        <h3>API usage</h3>
        <MetricOrUnavailable available={usage.apiUsage?.available} reason={usage.apiUsage?.reason} />

        <h3>Module adoption (company overrides)</h3>
        <MetricOrUnavailable available={usage.moduleAdoption?.available !== false}>
          {(usage.moduleAdoption?.companyOverrides || []).length === 0 ? (
            <p className="pa-muted">No company module overrides recorded.</p>
          ) : (
            <div className="pa-table-wrap">
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Companies with override</th>
                    <th>Explicitly disabled</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.moduleAdoption.companyOverrides.map((row) => (
                    <tr key={row.moduleKey}>
                      <td>
                        <code className="pa-code">{row.moduleKey}</code>
                      </td>
                      <td>{row.companiesWithOverride}</td>
                      <td>{row.explicitlyDisabled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MetricOrUnavailable>
      </div>

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>System health</h2>
        </div>
        <div className="pa-health-row">
          <span className="pa-health-pill">
            <Server size={14} strokeWidth={2} aria-hidden />
            Backend <strong>{health.backend}</strong>
          </span>
          <span className="pa-health-pill">
            <Database size={14} strokeWidth={2} aria-hidden />
            Central DB <strong>{health.centralDb}</strong>
          </span>
          <span className="pa-health-pill">
            Maintenance <strong>{health.maintenanceMode ? "ON" : "OFF"}</strong>
          </span>
        </div>
        <div style={{ marginTop: 12 }}>
          <MetricOrUnavailable
            available={health.cronExecution?.available}
            reason={health.cronExecution?.reason}
          />
          <MetricOrUnavailable
            available={health.apiResponseTimes?.available}
            reason={health.apiResponseTimes?.reason}
          />
        </div>
        <h3>Recent operational failures</h3>
        {(health.recentOperationalFailures || []).length === 0 ? (
          <p className="pa-muted">No recent FAILURE/DENIED audit entries.</p>
        ) : (
          <div className="pa-table-wrap">
            <table className="pa-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>Target</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {health.recentOperationalFailures.map((row, idx) => (
                  <tr key={`${row.action}-${idx}`}>
                    <td>{row.action}</td>
                    <td>
                      <PaStatusBadge status={row.outcome} />
                    </td>
                    <td>
                      {row.targetType} {row.targetId}
                    </td>
                    <td>{formatPaDate(row.timestamp, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PaUnavailableMetrics metrics={data.unavailableMetrics || []} />
    </div>
  );
}

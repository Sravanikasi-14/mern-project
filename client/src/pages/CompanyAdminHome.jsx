import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  Landmark,
  Package,
  RefreshCw,
  Users,
  UserCog,
  Activity,
} from "lucide-react";
import SoftRefresh from "../components/SoftRefresh";
import { useAuth } from "../context/AuthContext";
import { useCompanyAdminDashboardQuery } from "../hooks/useCompanyAdminQueries";
import { getCompanyBrandName } from "../utils/companyBrand";
import {
  isModuleEmpty,
  resolveCompanyAdminDashboardViewState,
} from "../utils/companyAdminDashboardView";
import api from "../services/api";
import "./CompanyAdminHome.css";

function formatMoney(amount, symbol = "₹") {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return `${symbol}${Math.round(Number(amount)).toLocaleString("en-IN")}`;
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function MetricCard({ label, value, hint, unavailable }) {
  return (
    <div className="ca-metric">
      <p className="ca-metric-label">{label}</p>
      {unavailable ? (
        <p className="ca-metric-unavailable">Unavailable</p>
      ) : (
        <p className="ca-metric-value">{value}</p>
      )}
      {hint ? <p className="ca-metric-hint">{hint}</p> : null}
    </div>
  );
}

function Section({ title, icon: Icon, children, action }) {
  return (
    <section className="ca-section">
      <header className="ca-section-head">
        <div className="ca-section-title-row">
          {Icon ? <Icon size={18} strokeWidth={2} aria-hidden="true" /> : null}
          <h2>{title}</h2>
        </div>
        {action || null}
      </header>
      <div className="ca-section-body">{children}</div>
    </section>
  );
}

function EmptyNote({ children }) {
  return <p className="ca-empty">{children}</p>;
}

function BarList({ items, max }) {
  const peak = max || Math.max(...items.map((i) => i.count || 0), 1);
  if (!items.length) return <EmptyNote>No distribution data yet.</EmptyNote>;
  return (
    <ul className="ca-bar-list">
      {items.map((item) => (
        <li key={item.name || item.status}>
          <div className="ca-bar-meta">
            <span>{item.name || item.status}</span>
            <strong>{item.count}</strong>
          </div>
          <div className="ca-bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max(4, (item.count / peak) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TrendBars({ days }) {
  if (!days?.length) return <EmptyNote>No attendance trend available.</EmptyNote>;
  const peak = Math.max(...days.map((d) => d.present || 0), 1);
  return (
    <div className="ca-trend" role="img" aria-label="Attendance trend for the last 7 days">
      {days.map((day) => (
        <div key={day.date} className="ca-trend-col">
          <div className="ca-trend-bars">
            <span
              className="ca-trend-present"
              style={{ height: `${Math.max(6, (day.present / peak) * 100)}%` }}
              title={`Present ${day.present}`}
            />
          </div>
          <span className="ca-trend-label">{day.label?.split(" ")[0] || day.date}</span>
        </div>
      ))}
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="ca-dash ca-dash--loading" aria-busy="true" aria-live="polite">
      <div className="ca-skel ca-skel--hero" />
      <div className="ca-skel-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="ca-skel ca-skel--card" />
        ))}
      </div>
      <div className="ca-skel-grid ca-skel-grid--2">
        <div className="ca-skel ca-skel--panel" />
        <div className="ca-skel ca-skel--panel" />
      </div>
    </div>
  );
}

export default function CompanyAdminHome() {
  const { company } = useAuth();
  const brand = getCompanyBrandName(company) || company?.companyName || "Company";
  const query = useCompanyAdminDashboardQuery();
  const [logoSrc, setLogoSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    async function loadLogo() {
      if (!company?.branding?.logoUrl) {
        setLogoSrc(null);
        return;
      }
      try {
        const res = await api.get("/auth/company-logo", {
          responseType: "blob",
          params: { v: company.branding.logoUrl },
        });
        if (cancelled) return;
        if (!res.data || res.data.size === 0) {
          setLogoSrc(null);
          return;
        }
        objectUrl = URL.createObjectURL(res.data);
        setLogoSrc(objectUrl);
      } catch {
        if (!cancelled) setLogoSrc(null);
      }
    }

    loadLogo();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [company?.branding?.logoUrl]);

  const viewState = resolveCompanyAdminDashboardViewState({
    isLoading: query.isLoading,
    isError: query.isError,
    data: query.data,
    error: query.error,
  });

  if (viewState.state === "loading") {
    return (
      <div className="ca-page">
        <SkeletonDashboard />
      </div>
    );
  }

  if (viewState.state === "error") {
    return (
      <div className="ca-page">
        <div className="ca-error" role="alert">
          <AlertCircle size={22} strokeWidth={2} />
          <div>
            <h1>Unable to load company dashboard</h1>
            <p>{viewState.message}</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const data = query.data;
  const overview = data?.overview || {};
  const workforce = data?.workforce || {};
  const attendance = data?.attendance || {};
  const leave = data?.leave || {};
  const payroll = data?.payroll || {};
  const hiring = data?.hiring || {};
  const assets = data?.assets || {};
  const activity = data?.recentActivity || [];
  const quickAccess = data?.quickAccess || [];
  const displayName = data?.company?.displayName || brand;

  return (
    <div className="ca-page">
      <header className="ca-hero">
        <div className="ca-hero-brand">
          <div className={`ca-hero-logo ${logoSrc ? "has-image" : ""}`}>
            {logoSrc ? (
              <img src={logoSrc} alt="" />
            ) : (
              <Building2 size={28} strokeWidth={2} aria-hidden="true" />
            )}
          </div>
          <div>
            <p className="ca-eyebrow">Company Admin overview</p>
            <h1>{displayName}</h1>
            <p className="ca-hero-sub">
              Company-wide visibility for {data?.businessDate || "today"}
              {data?.timezone ? ` · ${data.timezone}` : ""}
            </p>
          </div>
        </div>
        <div className="ca-hero-actions">
          <SoftRefresh active={query.isFetching && !query.isLoading} />
          <button
            type="button"
            className="btn-secondary ca-refresh-btn"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={16} strokeWidth={2} />
            Refresh
          </button>
        </div>
      </header>

      <div className="ca-metric-grid">
        <MetricCard label="Active employees" value={overview.activeEmployeeCount ?? "—"} />
        <MetricCard label="Total employees" value={overview.totalEmployeeCount ?? "—"} />
        <MetricCard label="Departments" value={overview.departmentCount ?? "—"} />
        <MetricCard label="Active HR Admins" value={overview.activeHrAdminCount ?? "—"} />
      </div>

      <div className="ca-dash-grid">
        <Section title="Workforce overview" icon={Users}>
          <div className="ca-split">
            <div>
              <h3 className="ca-subhead">By department</h3>
              <BarList items={workforce.byDepartment || []} />
            </div>
            <div>
              <h3 className="ca-subhead">By status</h3>
              <BarList
                items={(workforce.byStatus || []).map((s) => ({
                  name: s.status,
                  count: s.count,
                }))}
              />
            </div>
          </div>
          <div className="ca-subblock">
            <h3 className="ca-subhead">Recent additions</h3>
            {(workforce.recentAdditions || []).length === 0 ? (
              <EmptyNote>No recent employee records.</EmptyNote>
            ) : (
              <ul className="ca-simple-list">
                {workforce.recentAdditions.map((emp) => (
                  <li key={emp.id}>
                    <div>
                      <strong>{emp.fullName}</strong>
                      <span>
                        {[emp.employeeCode, emp.department, emp.status]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <time>{formatWhen(emp.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {workforce.trends?.available ? (
            <p className="ca-trend-note">
              {workforce.trends.additionsLast30Days} employee
              {workforce.trends.additionsLast30Days === 1 ? "" : "s"} added in the last 30 days.
            </p>
          ) : (
            <EmptyNote>Workforce trend history is not available yet.</EmptyNote>
          )}
        </Section>

        <Section title="Attendance overview" icon={CalendarDays}>
          {!attendance.available ? (
            <EmptyNote>Attendance data is unavailable for this company.</EmptyNote>
          ) : (
            <>
              <div className="ca-metric-grid ca-metric-grid--compact">
                <MetricCard label="Present today" value={attendance.presentToday} />
                <MetricCard label="Absent today" value={attendance.absentToday} />
                <MetricCard label="Late today" value={attendance.lateToday} />
                <MetricCard label="On leave today" value={attendance.onLeaveToday} />
              </div>
              <h3 className="ca-subhead">7-day present trend</h3>
              <TrendBars days={attendance.trend} />
            </>
          )}
        </Section>

        <Section title="Leave overview" icon={ClipboardList}>
          {isModuleEmpty("leave", data) ? (
            <EmptyNote>
              {!leave.available
                ? "Leave data is unavailable for this company."
                : "No leave requests recorded yet."}
            </EmptyNote>
          ) : (
            <div className="ca-metric-grid ca-metric-grid--compact">
              <MetricCard label="Pending" value={leave.pending} />
              <MetricCard label="Approved" value={leave.approved} />
              <MetricCard label="Rejected" value={leave.rejected} />
            </div>
          )}
        </Section>

        <Section title="Payroll overview" icon={Landmark}>
          {isModuleEmpty("payroll", data) ? (
            <EmptyNote>
              {!payroll.available
                ? "Payroll module data is unavailable."
                : "No payroll cycles have been created yet."}
            </EmptyNote>
          ) : (
            <div className="ca-metric-grid ca-metric-grid--compact">
              <MetricCard label="Latest period" value={payroll.periodLabel || "—"} />
              <MetricCard label="Processing status" value={payroll.status || "—"} />
              <MetricCard
                label="Total net payable"
                value={formatMoney(payroll.totalNetPayable, payroll.currencySymbol) || "—"}
              />
              <MetricCard
                label="Paid / payment status"
                value={
                  formatMoney(payroll.totalPaidAmount, payroll.currencySymbol)
                    ? `${formatMoney(payroll.totalPaidAmount, payroll.currencySymbol)} · ${payroll.paymentStatus || "—"}`
                    : payroll.paymentStatus || "—"
                }
              />
            </div>
          )}
        </Section>

        <Section title="Hiring overview" icon={Briefcase}>
          {isModuleEmpty("hiring", data) ? (
            <EmptyNote>Hiring data is unavailable for this company.</EmptyNote>
          ) : (
            <>
              <div className="ca-metric-grid ca-metric-grid--compact">
                <MetricCard label="Open positions" value={hiring.openPositions} />
                <MetricCard label="Active candidates" value={hiring.activeCandidates} />
                <MetricCard label="Accepted offers" value={hiring.pipeline?.accepted ?? 0} />
                <MetricCard label="Draft offers" value={hiring.pipeline?.draft ?? 0} />
              </div>
              <h3 className="ca-subhead">Recent hiring activity</h3>
              {(hiring.recentActivity || []).length === 0 ? (
                <EmptyNote>No recent hiring activity.</EmptyNote>
              ) : (
                <ul className="ca-simple-list">
                  {hiring.recentActivity.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.candidateName}</strong>
                        <span>
                          {[item.jobTitle, item.department, item.status]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <time>{formatWhen(item.updatedAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Section>

        <Section title="Assets overview" icon={Package}>
          {isModuleEmpty("assets", data) ? (
            <EmptyNote>
              {!assets.available
                ? "Asset data is unavailable for this company."
                : "No company assets recorded yet."}
            </EmptyNote>
          ) : (
            <div className="ca-metric-grid ca-metric-grid--compact">
              <MetricCard label="Total assets" value={assets.total} />
              <MetricCard label="Assigned" value={assets.assigned} />
              <MetricCard label="Available" value={assets.availableCount} />
              <MetricCard label="Under maintenance" value={assets.underMaintenance} />
            </div>
          )}
        </Section>

        <Section title="Recent company activity" icon={Activity}>
          {isModuleEmpty("activity", data) ? (
            <EmptyNote>No recent company activity in the audit feed.</EmptyNote>
          ) : (
            <ul className="ca-simple-list">
              {activity.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {[item.actorRole, item.actorEmail, item.targetType]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <time>{formatWhen(item.timestamp)}</time>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Quick access" icon={UserCog}>
          <div className="ca-quick-grid">
            {quickAccess.map((item) => {
              const isAvailable = item.status === "available" && item.to;
              const content = (
                <>
                  <span>{item.label}</span>
                  <em>{isAvailable ? "Open" : "Upcoming"}</em>
                </>
              );
              if (isAvailable) {
                return (
                  <Link
                    key={item.key}
                    to={item.to}
                    className="ca-quick-card ca-quick-card--link"
                  >
                    {content}
                  </Link>
                );
              }
              return (
                <div key={item.key} className="ca-quick-card is-upcoming">
                  {content}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Briefcase,
  CalendarDays,
  Clock,
  MapPinned,
  Settings2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../app/AuthContext";
import HrPortalHeader from "../../components/HrPortalHeader";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import AttendanceCapsuleChart from "../../components/AttendanceCapsuleChart";
import ProfileAvatar from "../../components/ProfileAvatar";
import { formatMoney } from "../../utils/payrollUtils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "attendance", label: "Attendance" },
  { id: "finance", label: "Finance" },
  { id: "more", label: "More" },
];

function monthOptions(count = 12) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({
      value: `${y}-${m}`,
      label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

function greetingForHour(h) {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HrHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const months = useMemo(() => monthOptions(12), []);
  const [month, setMonth] = useState(months[0]?.value || "");
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trackingHint, setTrackingHint] = useState(null);

  const firstName = String(user?.fullName || user?.name || "Admin")
    .trim()
    .split(/\s+/)[0] || "Admin";
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [y, m] = String(month).split("-");
      const { data: res } = await api.get("/admin/dashboard", {
        params: { month: Number(m), year: Number(y) },
      });
      setData(res);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load dashboard");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: ov } = await api.get("/admin/attendance/overview");
        if (cancelled) return;
        const s = ov?.summary || {};
        setTrackingHint({
          live: Number(s.liveTrackingCount || 0),
          withLoc: Number(s.withLocationCount || 0),
        });
      } catch {
        if (!cancelled) setTrackingHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = data?.summary || {};
  const weekDays = Array.isArray(data?.attendanceOverview?.days) ? data.attendanceOverview.days : [];
  const calendarDays = Array.isArray(data?.attendanceCalendar?.days) ? data.attendanceCalendar.days : [];
  const chartDays = weekDays.length > 0 ? weekDays : calendarDays.slice(-7);
  const recentLeaves = Array.isArray(data?.recentLeaves) ? data.recentLeaves : [];
  const payroll = data?.payrollCycleSummary || {};
  const companyAssets = data?.companyAssets || {};
  const currency = data?.meta?.currencySymbol || "₹";

  const activeEmployees = Number(summary.activeEmployees ?? 0);
  const totalMonthlySalary = Number(summary.monthlyPayroll ?? 0);
  const todayOnLeave = Number(summary.onLeave ?? 0);
  const pendingLeaveCount = recentLeaves.filter(
    (lv) => String(lv.status || "").toUpperCase() === "PENDING"
  ).length;

  const openLiveTracking = () => navigate("/admin/attendance/live");

  return (
    <div className="hr-dash">
      <HrPortalHeader title="Dashboard" />

      <div className="hr-dash-body">
        <header className="hr-dash-hero">
          <div className="hr-dash-hero-text">
            <p className="hr-dash-kicker">{greeting}</p>
            <h1 className="hr-dash-title">{firstName}</h1>
            <p className="hr-dash-sub">Here&apos;s what&apos;s happening today</p>
          </div>
          <label className="hr-dash-month">
            <CalendarDays size={16} strokeWidth={1.85} aria-hidden="true" />
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Select month">
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        {error && !data ? <ErrorState message={error} onRetry={load} /> : null}

        {loading && !data ? (
          <div className="hr-dash-skel" aria-busy="true" aria-label="Loading dashboard">
            <Skeleton rows={6} />
          </div>
        ) : data ? (
          <>
            <section className="hr-kpi-row" aria-label="Key metrics">
              <article className="hr-kpi-card">
                <div className="hr-kpi-icon" aria-hidden="true">
                  <Users size={22} strokeWidth={1.85} />
                </div>
                <div className="hr-kpi-copy">
                  <p className="hr-kpi-label">Active Employees</p>
                  <p className="hr-kpi-value">{activeEmployees}</p>
                </div>
              </article>
              <article className="hr-kpi-card">
                <div className="hr-kpi-icon hr-kpi-icon--mint" aria-hidden="true">
                  <Wallet size={22} strokeWidth={1.85} />
                </div>
                <div className="hr-kpi-copy">
                  <p className="hr-kpi-label">Total Monthly Salary</p>
                  <p className="hr-kpi-value hr-kpi-value--sm">
                    {formatMoney(totalMonthlySalary, currency)}
                  </p>
                </div>
              </article>
            </section>

            <section className="hr-track-spotlight" aria-label="Live Employee Tracking">
              <div className="hr-track-spotlight__visual" aria-hidden="true">
                <div className="hr-spot-map">
                  <span className="hr-spot-pin" />
                  <span className="hr-spot-ring" />
                  <span className="hr-spot-route" />
                </div>
              </div>
              <div className="hr-track-spotlight__body">
                <div className="hr-track-spotlight__head">
                  <span className="hr-track-badge">
                    <span className="hr-spot-live-dot" aria-hidden="true" />
                    Live Tracking
                  </span>
                  {trackingHint && trackingHint.live > 0 ? (
                    <span className="hr-track-hint">{trackingHint.live} active now</span>
                  ) : trackingHint && trackingHint.withLoc > 0 ? (
                    <span className="hr-track-hint is-muted">{trackingHint.withLoc} with location</span>
                  ) : null}
                </div>
                <h2 className="hr-track-title">Live Employee Tracking</h2>
                <p className="hr-track-desc">
                  View an employee&apos;s current location and travelled routes.
                </p>
                <button type="button" className="btn-primary hr-track-cta" onClick={openLiveTracking}>
                  <MapPinned size={18} strokeWidth={1.85} aria-hidden="true" />
                  View Live Tracking
                </button>
              </div>
            </section>

            <div className="hr-dash-tabs" role="tablist" aria-label="Dashboard sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`hr-dash-tab${tab === t.id ? " is-active" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="hr-dash-panel" role="tabpanel">
              {tab === "overview" ? (
                <div className="hr-panel-stack">
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Today at a glance</h3>
                      <Link to="/admin/attendance" className="hr-text-link">
                        View all
                      </Link>
                    </div>
                    <div className="hr-stat-grid">
                      <div className="hr-stat">
                        <span>Present</span>
                        <strong>{summary.todayPresent ?? 0}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>Late</span>
                        <strong>{summary.todayLate ?? 0}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>Absent</span>
                        <strong>{summary.todayAbsent ?? 0}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>On Leave</span>
                        <strong>{todayOnLeave}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Pending actions</h3>
                    </div>
                    <div className="hr-action-list">
                      <Link to="/admin/leave" className="hr-action-row">
                        <span className="hr-action-icon">
                          <CalendarDays size={20} strokeWidth={1.85} />
                        </span>
                        <span className="hr-action-copy">
                          <strong>Leave requests</strong>
                          <small>Review and approve</small>
                        </span>
                        {pendingLeaveCount > 0 ? (
                          <span className="hr-action-count">{pendingLeaveCount}</span>
                        ) : (
                          <span className="hr-action-chevron" aria-hidden="true">
                            ›
                          </span>
                        )}
                      </Link>
                      <Link to="/admin/attendance" className="hr-action-row">
                        <span className="hr-action-icon">
                          <Clock size={20} strokeWidth={1.85} />
                        </span>
                        <span className="hr-action-copy">
                          <strong>Attendance</strong>
                          <small>Reviews &amp; exceptions</small>
                        </span>
                        <span className="hr-action-chevron" aria-hidden="true">
                          ›
                        </span>
                      </Link>
                      <Link to="/admin/work-management" className="hr-action-row">
                        <span className="hr-action-icon">
                          <Briefcase size={20} strokeWidth={1.85} />
                        </span>
                        <span className="hr-action-copy">
                          <strong>Work submissions</strong>
                          <small>Pending approvals</small>
                        </span>
                        <span className="hr-action-chevron" aria-hidden="true">
                          ›
                        </span>
                      </Link>
                    </div>
                  </section>

                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Recent leave</h3>
                      <Link to="/admin/leave" className="hr-text-link">
                        See all
                      </Link>
                    </div>
                    {recentLeaves.length === 0 ? (
                      <p className="hr-empty-inline">No recent leave activity</p>
                    ) : (
                      <ul className="hr-leave-list">
                        {recentLeaves.slice(0, 5).map((lv) => (
                          <li key={lv.id || `${lv.employeeCode}-${lv.fromDate}`}>
                            <div className="hr-leave-identity">
                              <ProfileAvatar
                                name={lv.employeeName || "Employee"}
                                photo={lv.avatar}
                                size={36}
                              />
                              <div>
                                <strong>{lv.employeeName || "Employee"}</strong>
                                <small>
                                  {lv.leaveType || "Leave"} · {lv.fromDate}
                                  {lv.toDate && lv.toDate !== lv.fromDate ? ` → ${lv.toDate}` : ""}
                                </small>
                              </div>
                            </div>
                            <span
                              className={`hr-status-pill is-${String(lv.status || "pending")
                                .toLowerCase()
                                .replace(/_/g, "-")}`}
                            >
                              {lv.status || "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              ) : null}

              {tab === "attendance" ? (
                <div className="hr-panel-stack">
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Attendance Trends</h3>
                      <Link to="/admin/attendance" className="hr-text-link">
                        Open module
                      </Link>
                    </div>
                    <AttendanceCapsuleChart
                      days={chartDays}
                      activeEmployees={activeEmployees}
                      todaySummary={summary}
                    />
                  </section>
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Quick links</h3>
                    </div>
                    <div className="hr-dash-quick-grid">
                      <Link to="/admin/attendance" className="hr-dash-quick-tile">
                        <CalendarDays size={22} strokeWidth={1.85} />
                        <span>Calendar</span>
                      </Link>
                      <Link to="/admin/attendance/live" className="hr-dash-quick-tile">
                        <MapPinned size={22} strokeWidth={1.85} />
                        <span>Live Tracking</span>
                      </Link>
                      <Link to="/admin/reports" className="hr-dash-quick-tile">
                        <BarChart3 size={22} strokeWidth={1.85} />
                        <span>Reports</span>
                      </Link>
                      <Link to="/admin/policies" className="hr-dash-quick-tile">
                        <Settings2 size={22} strokeWidth={1.85} />
                        <span>Policies</span>
                      </Link>
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "finance" ? (
                <div className="hr-panel-stack">
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Payroll snapshot</h3>
                      <Link to="/admin/payroll" className="hr-text-link">
                        Open payroll
                      </Link>
                    </div>
                    <div className="hr-stat-grid">
                      <div className="hr-stat">
                        <span>Status</span>
                        <strong className="hr-stat-text">{payroll.statusLabel || "—"}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>Net pay</span>
                        <strong className="hr-stat-text">
                          {formatMoney(payroll.totalNetSalary || 0, currency)}
                        </strong>
                      </div>
                      <div className="hr-stat">
                        <span>Gross</span>
                        <strong className="hr-stat-text">
                          {formatMoney(payroll.totalGrossSalary || 0, currency)}
                        </strong>
                      </div>
                      <div className="hr-stat">
                        <span>Paid</span>
                        <strong className="hr-stat-text">
                          {formatMoney(payroll.totalPaidAmount || 0, currency)}
                        </strong>
                      </div>
                    </div>
                  </section>
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Salary liability</h3>
                    </div>
                    <p className="hr-finance-hero">{formatMoney(totalMonthlySalary, currency)}</p>
                    <p className="hr-section-sub">Total monthly salary for active employees</p>
                  </section>
                </div>
              ) : null}

              {tab === "more" ? (
                <div className="hr-panel-stack">
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Workforce insights</h3>
                    </div>
                    <div className="hr-stat-grid">
                      <div className="hr-stat">
                        <span>Active</span>
                        <strong>{activeEmployees}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>With assets</span>
                        <strong>{companyAssets.employeesWithAssets ?? 0}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>Without assets</span>
                        <strong>{companyAssets.employeesWithoutAssets ?? 0}</strong>
                      </div>
                      <div className="hr-stat">
                        <span>On leave today</span>
                        <strong>{todayOnLeave}</strong>
                      </div>
                    </div>
                  </section>
                  <section className="hr-panel-card">
                    <div className="hr-panel-card__head">
                      <h3>Modules</h3>
                    </div>
                    <div className="hr-dash-quick-grid">
                      <Link to="/admin" className="hr-dash-quick-tile">
                        <Users size={22} strokeWidth={1.85} />
                        <span>People</span>
                      </Link>
                      <Link to="/admin/onboarding" className="hr-dash-quick-tile">
                        <UserPlus size={22} strokeWidth={1.85} />
                        <span>Onboarding</span>
                      </Link>
                      <Link to="/admin/reports" className="hr-dash-quick-tile">
                        <BarChart3 size={22} strokeWidth={1.85} />
                        <span>Reports</span>
                      </Link>
                      <Link to="/admin/settings" className="hr-dash-quick-tile">
                        <Settings2 size={22} strokeWidth={1.85} />
                        <span>Settings</span>
                      </Link>
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

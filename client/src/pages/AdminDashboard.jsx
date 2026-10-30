import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import WorkforceAllocation from "../components/WorkforceAllocation";
import SoftRefresh from "../components/SoftRefresh";
import { IconArrowLeft, IconArrowRight } from "../components/Icons";
import MobileExpandable from "../components/mobile/MobileExpandable";
import { getCompanyBrandName } from "../utils/companyBrand";
import { parseCivilDate, weekdaySunday0 } from "../utils/dateUtils";
import {
  useAdminDashboardQuery,
  buildAdminDashboardFallback,
} from "../hooks/useAdminQueries";
import "./AdminDashboard.css";
import "../pages/PeopleManagement.css";

function formatShortCurrency(amount, symbol = "₹") {
  if (amount == null || isNaN(amount)) return `${symbol}0`;
  const val = Number(amount);
  if (val >= 10000000) {
    return `${symbol}${(val / 10000000).toFixed(2)} Cr`;
  }
  if (val >= 100000) {
    return `${symbol}${(val / 100000).toFixed(2)} L`;
  }
  if (val >= 1000) {
    return `${symbol}${(val / 1000).toFixed(1)}k`;
  }
  return `${symbol}${val.toLocaleString("en-IN")}`;
}

function formatFullINR(amount, symbol = "₹") {
  if (amount == null || isNaN(amount)) return `${symbol}0`;
  const val = Math.round(Number(amount));
  return `${symbol}${val.toLocaleString("en-IN")}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const PASTEL_AVATAR_COLORS = [
  { bg: "#f6c6c2", text: "#7a2721" },
  { bg: "#cdeccf", text: "#1b5e20" },
  { bg: "#cfd6f7", text: "#1e3a8a" },
  { bg: "#f5dfb5", text: "#78350f" },
  { bg: "#fbcfe8", text: "#831843" },
  { bg: "#fed7aa", text: "#7c2d12" },
];

export default function AdminDashboard() {
  const { user, company } = useAuth();

  // Month & Year Filter states
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedDept, setSelectedDept] = useState("ALL");
  const [fallbackData, setFallbackData] = useState(null);

  // Attendance Analytics Range ("TODAY" | "7D" | "30D")
  const [attendanceRange, setAttendanceRange] = useState("7D");
  const [hoveredDay, setHoveredDay] = useState(null);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dashboardQuery = useAdminDashboardQuery({
    month: selectedMonth,
    year: selectedYear,
    department: selectedDept,
  });

  useEffect(() => {
    let cancelled = false;
    if (dashboardQuery.data?.source === "fallback") {
      buildAdminDashboardFallback({
        company,
        selectedMonth,
        selectedYear,
        selectedDept,
      }).then((d) => {
        if (!cancelled) setFallbackData(d);
      });
    } else {
      setFallbackData(null);
    }
    return () => {
      cancelled = true;
    };
  }, [dashboardQuery.data, company, selectedMonth, selectedYear, selectedDept]);

  const data =
    dashboardQuery.data?.source === "aggregated"
      ? dashboardQuery.data.data
      : fallbackData;
  const loading = !data && (dashboardQuery.isLoading || dashboardQuery.isFetching || dashboardQuery.data?.source === "fallback");

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((prev) => prev - 1);
    } else {
      setSelectedMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((prev) => prev + 1);
    } else {
      setSelectedMonth((prev) => prev + 1);
    }
  };

  // Safe unpacked data
  const meta = data?.meta || {};
  const summary = data?.summary || {};
  const funnel = data?.recruitmentFunnel || {};
  const payrollCycle = data?.payrollCycleSummary || {};
  const recentLeaves = data?.recentLeaves || [];
  const upcomingHolidays = data?.upcomingHolidays || [];
  const projectTeams = data?.projectTeams || {};
  const salaryExpenses = useMemo(() => {
    if (Array.isArray(data?.salaryExpenses)) {
      return data.salaryExpenses;
    }
    if (Array.isArray(data?.salaryExpenses?.months)) {
      return data.salaryExpenses.months;
    }
    return [];
  }, [data?.salaryExpenses]);
  const currencySym = meta.currencySymbol || "₹";

  const totalEmployees = summary.activeEmployees ?? 0;
  const attendanceRate = totalEmployees > 0
    ? Math.min(100, Math.round(((summary.todayPresent ?? 0) / totalEmployees) * 100))
    : 0;

  // Genuine Pending HR Actions
  const pendingLeaves = useMemo(() => {
    return recentLeaves.filter((l) => l.status === "PENDING");
  }, [recentLeaves]);

  const pendingOffersCount = funnel.pending || 0;
  const hasPayrollAction = payrollCycle.status !== "PAID" && payrollCycle.status !== "CANCELLED";
  const totalPendingActions = pendingLeaves.length + pendingOffersCount + (hasPayrollAction ? 1 : 0);

  // 7-day capsule bar data for Weekly Attendance Chart
  const weeklyBars = useMemo(() => {
    const calendarDays = data?.attendanceCalendar?.days || [];
    const daysOfWeekLetters = ["S", "M", "T", "W", "T", "F", "S"];

    if (calendarDays.length === 0) {
      return daysOfWeekLetters.map((letter, idx) => ({
        dayLetter: letter,
        pct: 0,
        heightVal: 0.15,
        present: 0,
        isWeekend: idx === 0 || idx === 6,
        isToday: false,
      }));
    }

    // Take the last 7 days from calendarData
    const sliceDays = calendarDays.slice(-7);
    const maxVal = Math.max(1, totalEmployees);

    return sliceDays.map((d) => {
      const parts = parseCivilDate(d.date);
      const dayIdx = d.dayOfWeek != null ? d.dayOfWeek : (parts ? weekdaySunday0(parts.year, parts.month, parts.day) : 0);
      const pct = maxVal > 0 ? Math.min(100, Math.round(((d.presentCount || 0) / maxVal) * 100)) : 0;
      const heightVal = Math.max(0.18, pct / 100);

      return {
        date: d.date,
        dayLetter: daysOfWeekLetters[dayIdx] || "•",
        pct,
        heightVal,
        present: d.presentCount || 0,
        absent: d.absentCount || 0,
        late: d.lateCount || 0,
        onLeave: d.leaveCount || 0,
        isWeekend: Boolean(d.isWeekend),
        isToday: Boolean(d.isToday),
      };
    });
  }, [data?.attendanceCalendar?.days, totalEmployees]);

  const payrollHistoryBars = useMemo(
    () => salaryExpenses.filter((s) => Number(s.amount || 0) > 0 && s.hasCycle !== false),
    [salaryExpenses]
  );

  const maxExpense = useMemo(() => {
    if (payrollHistoryBars.length === 0) return 1;
    return Math.max(1, ...payrollHistoryBars.map((s) => Number(s.amount || 0)));
  }, [payrollHistoryBars]);

  const hasSalaryHistory = payrollHistoryBars.length > 0;

  return (
    <div className="board-container admin-dashboard-page">
      {/* ====================================================================
          1. Board Head: Greeting, Controls, Sync Button
          ==================================================================== */}
      <div className="board__head">
        <div>
          <h1 className="board__title">{getGreeting()}, {user?.name || "Eleanor"}</h1>
          <p className="board__sub">
            {getCompanyBrandName({ ...(company || {}), companyName: meta.companyName || company?.companyName })}
          </p>
        </div>

        <div className="board__actions">
          {/* Department Filter */}
          {meta.departments && meta.departments.length > 0 && (
            <div className="dash-filter-pill">
              <span>Dept:</span>
              <select
                className="dash-filter-select"
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                aria-label="Filter by department"
              >
                <option value="ALL">All Departments</option>
                {meta.departments.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          )}

          {/* Month Navigator Pill */}
          <div className="month-picker-pill" role="group" aria-label="Select month">
            <button
              type="button"
              className="month-nav-arrow"
              onClick={handlePrevMonth}
              title="Previous Month"
              aria-label="Previous Month"
            >
              <IconArrowLeft size={20} />
            </button>
            <span className="month-nav-label">
              {monthNames[selectedMonth - 1]?.slice(0, 3)} {selectedYear}
            </span>
            <button
              type="button"
              className="month-nav-arrow"
              onClick={handleNextMonth}
              title="Next Month"
              aria-label="Next Month"
            >
              <IconArrowRight size={20} />
            </button>
          </div>

          {/* Primary Action Button */}
          <Link to="/admin" className="btn--primary-fern">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add Employee</span>
          </Link>

          <SoftRefresh active={Boolean(dashboardQuery.isFetching && data)} />

          {/* Sync / Refresh Button */}
          <button
            type="button"
            className="btn--ghost-sync"
            onClick={() => dashboardQuery.refetch()}
            title="Sync live dashboard metrics"
            disabled={dashboardQuery.isFetching}
            aria-label="Refresh dashboard"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={dashboardQuery.isFetching ? "spin-icon" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* ====================================================================
          2. Asymmetric Bento Grid
          ==================================================================== */}
      <div className="fernly-bento-grid">
        {/* ====================================================================
            ROW 1: WORKFORCE OVERVIEW (4 COMPACT KPI CARDS, SPAN 3 EACH)
            ==================================================================== */}
        {/* Card 1: Total Workforce (Hero Deep Green Gradient) */}
        <Link to="/admin" className="card stat stat--hero stat-kpi">
          <div className="stat__head">
            <h2 className="stat__title"><span className="m-title-full">Total Workforce</span><span className="m-title-short">Team</span></h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{totalEmployees}</p>
          <p className="stat__note">
            <span className="trend-badge is-green">Active</span>
          </p>
        </Link>

        {/* Card 2: Present Today */}
        <Link to="/admin/attendance?filter=PRESENT" className="card stat stat-kpi">
          <div className="stat__head">
            <h2 className="stat__title"><span className="m-title-full">Present Today</span><span className="m-title-short">Present</span></h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{summary.todayPresent ?? 0}</p>
          <p className="stat__note">
            <span className="trend-badge is-green">{attendanceRate}%</span>
            <span>present</span>
          </p>
        </Link>

        {/* Card 3: Absent / Late / On Leave */}
        <Link to="/admin/leave" className="card stat stat-kpi">
          <div className="stat__head">
            <h2 className="stat__title"><span className="m-title-full">On Leave & Exceptions</span><span className="m-title-short">Time off</span></h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{(summary.onLeave ?? 0) + (summary.todayLate ?? 0)}</p>
          <p className="stat__note">
            <span>{summary.onLeave ?? 0} on leave · {summary.todayLate ?? 0} late</span>
          </p>
        </Link>

        {/* Card 4: Pending HR Actions */}
        <Link to="/admin/leave?status=PENDING" className="card stat stat-kpi">
          <div className="stat__head">
            <h2 className="stat__title"><span className="m-title-full">Pending HR Actions</span><span className="m-title-short">To review</span></h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{totalPendingActions}</p>
          <p className="stat__note">
            <span className="trend-badge is-amber">Review</span>
          </p>
        </Link>

        {/* ====================================================================
            ROW 2: ASYMMETRIC 8 / 4 SPLIT
            - Left (Span 8): Attendance & Work Hours Analytics (Capsule Bar Chart)
            - Right (Span 4): Pending HR Actions List
            ==================================================================== */}
        <MobileExpandable title="Insights and reports">
        <div className="dash-stack dash-stack--primary">
        <section className="card analytics-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Attendance Trends</h2>
            </div>

            <div className="analytics-toolbar">
              <div className="seg-control" role="tablist" aria-label="Select date range">
                <button
                  type="button"
                  className={`seg-btn ${attendanceRange === "TODAY" ? "is-active" : ""}`}
                  onClick={() => setAttendanceRange("TODAY")}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`seg-btn ${attendanceRange === "7D" ? "is-active" : ""}`}
                  onClick={() => setAttendanceRange("7D")}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  className={`seg-btn ${attendanceRange === "30D" ? "is-active" : ""}`}
                  onClick={() => setAttendanceRange("30D")}
                >
                  30 Days
                </button>
              </div>

              <Link to="/admin/attendance?tab=tracking" className="card-shortcut-pill" title="Live Attendance Tracking">
                <span className="pulse-dot" />
                <span>Live Tracking</span>
              </Link>
              <Link to="/admin/attendance" className="card-shortcut-link" title="Open Attendance Hub">
                <span>Attendance Hub</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {/* Fernly Signature Capsule Bar Chart */}
          <div className="capsule-bars-container" role="img" aria-label="Weekly attendance capsule bars">
            {weeklyBars.map((bar, idx) => {
              const isPeak = bar.pct >= 90 && !bar.isWeekend;
              const isLight = bar.pct < 70 && !bar.isWeekend;
              const barClass = bar.isWeekend
                ? "bar--weekend"
                : isPeak
                ? "bar--peak"
                : isLight
                ? "bar--light"
                : "bar--mid";

              return (
                <div
                  key={`${bar.dayLetter}-${idx}`}
                  className={`capsule-bar-item ${bar.isToday ? "is-today" : ""}`}
                  onMouseEnter={() => setHoveredDay(bar)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  <div className="capsule-bar-track">
                    <button
                      type="button"
                      className={`capsule-bar ${barClass}`}
                      style={{ "--h": bar.heightVal }}
                      aria-label={`${bar.date || "Day"}: ${bar.present} present (${bar.pct}%)`}
                    >
                      <span className="bar-fill" />
                    </button>
                  </div>
                  <span className="bar-day-label">{bar.dayLetter}</span>
                </div>
              );
            })}
          </div>

          {/* Breakdown Indicators and Shift Status */}
          <div className="attendance-breakdown-row">
            <div className="attendance-legend-group">
              <span className="legend-item">
                <span className="legend-dot dot-present" />
                <span>Present: <b>{hoveredDay ? hoveredDay.present : (summary.todayPresent ?? 0)}</b></span>
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-late" />
                <span>Late: <b>{hoveredDay ? hoveredDay.late : (summary.todayLate ?? 0)}</b></span>
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-absent" />
                <span>Absent: <b>{hoveredDay ? hoveredDay.absent : (summary.todayAbsent ?? 0)}</b></span>
              </span>
              <span className="legend-item">
                <span className="legend-dot dot-leave" />
                <span>On Leave: <b>{hoveredDay ? hoveredDay.onLeave : (summary.onLeave ?? 0)}</b></span>
              </span>
            </div>

            <div className="shift-status-pill">
              <span className="pulse-dot" />
              <span>{hoveredDay ? hoveredDay.date : `Starts ${meta.officeStartTime || "09:30 AM"}`}</span>
            </div>
          </div>
        </section>

        <section className="card recruitment-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Offer Letters</h2>
            </div>
            <div className="analytics-toolbar">
              <span className="funnel-rate-badge">{funnel.acceptanceRate || 0}% accepted</span>
              <Link to="/admin/offers" className="card-shortcut-link">
                <span>View</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <div className="funnel-process-row">
            <Link to="/admin/offers" className="funnel-stage-tile" title="View all generated offers">
              <div className="stage-top">
                <span className="stage-dot dot-dark" />
                <span className="stage-name">Offers Generated</span>
              </div>
              <span className="stage-number">{funnel.offersGenerated || 0}</span>
              <div className="stage-meter">
                <div className="stage-fill fill-dark" style={{ width: `${funnel.offersGenerated > 0 ? 100 : 0}%` }} />
              </div>
            </Link>

            <Link to="/admin/offers?status=SENT" className="funnel-stage-tile" title="View pending candidate offers">
              <div className="stage-top">
                <span className="stage-dot dot-amber" />
                <span className="stage-name">Pending Review</span>
              </div>
              <span className="stage-number">{funnel.pending || 0}</span>
              <div className="stage-meter">
                <div className="stage-fill fill-amber" style={{ width: `${funnel.pendingPct || 0}%` }} />
              </div>
            </Link>

            <Link to="/admin/offers?status=ACCEPTED" className="funnel-stage-tile" title="View accepted offers">
              <div className="stage-top">
                <span className="stage-dot dot-green" />
                <span className="stage-name">Accepted</span>
              </div>
              <span className="stage-number">{funnel.accepted || 0}</span>
              <div className="stage-meter">
                <div className="stage-fill fill-green" style={{ width: `${funnel.acceptedPct || 0}%` }} />
              </div>
            </Link>

            <Link to="/admin/offers?status=REJECTED" className="funnel-stage-tile" title="View declined offers">
              <div className="stage-top">
                <span className="stage-dot dot-rose" />
                <span className="stage-name">Declined</span>
              </div>
              <span className="stage-number">{funnel.declined || 0}</span>
              <div className="stage-meter">
                <div className="stage-fill fill-rose" style={{ width: `${funnel.declinedPct || 0}%` }} />
              </div>
            </Link>
          </div>
        </section>

        <section className="card dash-workforce-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Workforce Allocation</h2>
            </div>
            <Link to="/admin" className="card-shortcut-link" title="Open employees directory">
              <span>Directory</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          <WorkforceAllocation
            hideTitle
            compact
            loading={loading}
            total={totalEmployees}
            departments={Array.isArray(data?.workforce?.departments) ? data.workforce.departments : []}
          />
        </section>
        </div>
        </MobileExpandable>

        <div className="dash-stack dash-stack--secondary">
        <section className="card pending-actions-card">
          <div className="card__head">
            <div>
              <h2 className="card__title"><span className="m-title-full">Action Center</span><span className="m-title-short">Needs you</span></h2>
            </div>
            <span className="pending-count-chip">{totalPendingActions} pending</span>
            <Link to="/admin/leave" className="m-view-all">View all</Link>
          </div>

          <div className="pending-task-list">
            {/* 1. Leave Approval */}
            <Link to="/admin/leave?status=PENDING" className="pending-task-item" title="Approve pending leaves">
              <div className="task-icon-circle icon-leave">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Leave Approvals ({pendingLeaves.length})</p>
                <p className="task-desc">
                  {pendingLeaves.length > 0 ? `${pendingLeaves.length} waiting` : "None pending"}
                </p>
              </div>
              <span className={`task-action-pill ${pendingLeaves.length > 0 ? "is-urgent" : ""}`}>Review</span>
            </Link>

            {/* 2. Offer Letters */}
            <Link to="/admin/offers?status=SENT" className="pending-task-item" title="Review candidate offers">
              <div className="task-icon-circle icon-offer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Candidate Offers ({pendingOffersCount})</p>
                <p className="task-desc">{pendingOffersCount > 0 ? `${pendingOffersCount} awaiting response` : "None waiting"}</p>
              </div>
              <span className="task-action-pill">Track</span>
            </Link>

            {/* 3. Candidate Onboarding */}
            <Link to="/admin/onboarding" className="pending-task-item" title="Onboarding checks">
              <div className="task-icon-circle icon-onboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Onboarding</p>
                <p className="task-desc">Profile and credential checks</p>
              </div>
              <span className="task-action-pill">Verify</span>
            </Link>

            {/* 4. Payroll Cycle Action */}
            <Link to="/admin/payroll" className="pending-task-item" title="Monthly payroll register">
              <div className="task-icon-circle icon-payroll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="7" cy="15" r="1.5"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Payroll ({payrollCycle.statusLabel || "Draft"})</p>
                <p className="task-desc">{payrollCycle.pendingAction || "Open this month’s register"}</p>
              </div>
              <span className="task-action-pill">Process</span>
            </Link>
          </div>
        </section>

        <MobileExpandable title="Payroll history">
        <section className="card payroll-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Payroll</h2>
              <p className="card__sub">{monthNames[selectedMonth - 1]} {selectedYear}</p>
            </div>
            <Link to="/admin/payroll" className="card-shortcut-link">
              <span>Open</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="payroll-cycle-box">
            <div>
              <span className="payroll-net-amount">
                {formatFullINR(payrollCycle.totalNetSalary || summary.monthlyPayroll, currencySym)}
              </span>
              <p className="payroll-sub-info">
                {payrollCycle.employeeCount || 0} of {totalEmployees} active employees in register
              </p>
            </div>
            <span className={`payroll-status-pill status-${(payrollCycle.status || "draft").toLowerCase()}`}>
              {payrollCycle.statusLabel || "Draft"}
            </span>
          </div>

          {hasSalaryHistory ? (
            <div className="expense-mini-bars" role="img" aria-label="Processed payroll totals by month">
              {payrollHistoryBars.map((exp, idx) => {
                const val = Number(exp.amount || 0);
                const heightPct = Math.max(12, Math.min(100, Math.round((val / maxExpense) * 100)));
                return (
                  <div
                    key={`${exp.month}-${idx}`}
                    className="expense-bar-col"
                    title={`${exp.month}: ${formatShortCurrency(val, currencySym)}`}
                    aria-label={`${exp.month} ${formatShortCurrency(val, currencySym)}`}
                  >
                    <div className="expense-bar-fill" style={{ height: `${heightPct}%` }} />
                    <span className="expense-bar-month">{exp.month}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="payroll-history-empty">No processed payroll history for {selectedYear}.</p>
          )}
        </section>
        </MobileExpandable>
        </div>

        <MobileExpandable title="Recent activity and holidays">
        <section className="card team-activity-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Recent Activity</h2>
            </div>
            <Link to="/admin" className="card-shortcut-link">
              <span>Directory</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="activity-list">
            {recentLeaves.length === 0 ? (
              <p className="activity-empty">
                No recent activity recorded for this period.
              </p>
            ) : (
              recentLeaves.slice(0, 4).map((l, idx) => {
                const colorPair = PASTEL_AVATAR_COLORS[idx % PASTEL_AVATAR_COLORS.length];
                const initials = (l.employeeName || "TM")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                const isDone = l.status === "APPROVED";
                const isProg = l.status === "PENDING";
                const pillClass = isDone ? "pill--done" : isProg ? "pill--prog" : "pill--pend";
                const pillLabel = isDone ? "Approved" : isProg ? "Pending" : "Declined";

                return (
                  <div key={l.id || idx} className="activity-item">
                    <span
                      className="activity-avatar"
                      style={{ background: colorPair.bg, color: colorPair.text }}
                      aria-hidden="true"
                    >
                      {initials}
                    </span>
                    <div className="activity-body">
                      <span className="activity-name">{l.employeeName}</span>
                      <span className="activity-task">
                        {l.department} · {l.leaveType} ({l.daysCount} {l.daysCount === 1 ? "day" : "days"})
                      </span>
                    </div>
                    <span className={`pill ${pillClass}`}>{pillLabel}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ====================================================================
            Holidays footer strip
            ==================================================================== */}
        <section className="card holidays-strip-card">
          <div className="card__head" style={{ marginBottom: 8 }}>
            <h3 className="card__title" style={{ fontSize: "15px" }}>Holidays</h3>
            <Link to="/admin/policies" className="card-shortcut-link">
              <span>Policy Calendar</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="holidays-strip-row" role="list" aria-label="Upcoming holidays list">
            {upcomingHolidays.length === 0 ? (
              <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                None remaining this month.
              </span>
            ) : (
              upcomingHolidays.map((h, idx) => (
                <div key={`${h.name}-${idx}`} className="holiday-chip" role="listitem">
                  <span className="holiday-chip-date">{formatDisplayDate(h.date)}</span>
                  <div>
                    <span className="holiday-chip-name">{h.name}</span>
                    <span className="holiday-chip-type"> · {h.isPaid ? "Paid Holiday" : "Observance"}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        </MobileExpandable>
      </div>
    </div>
  );
}

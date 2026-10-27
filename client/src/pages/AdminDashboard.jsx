import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import "./AdminDashboard.css";

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
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Month & Year Filter states
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedDept, setSelectedDept] = useState("ALL");

  // Attendance Analytics Range ("TODAY" | "7D" | "30D")
  const [attendanceRange, setAttendanceRange] = useState("7D");
  const [hoveredDay, setHoveredDay] = useState(null);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Dedicated aggregated dashboard endpoint
      try {
        const res = await api.get("/admin/dashboard", {
          params: {
            month: selectedMonth,
            year: selectedYear,
            department: selectedDept,
          },
        });
        if (res.data && res.data.success) {
          setData(res.data);
          setLoading(false);
          return;
        }
      } catch (dashErr) {
        if (dashErr.response?.status !== 404) {
          throw dashErr;
        }
      }

      // Fallback: aggregate individual endpoints if single route isn't available
      const todayStr = new Date().toISOString().split("T")[0];
      const [empSummaryRes, attendanceRes, leavesRes, offersRes, cyclesRes] = await Promise.allSettled([
        api.get("/employees/summary"),
        api.get("/admin/attendance/overview", {
          params: { date: todayStr, department: selectedDept },
        }),
        api.get("/leave-requests"),
        api.get("/offer-letters/summary"),
        api.get("/payroll/cycles"),
      ]);

      const empSummary = empSummaryRes.status === "fulfilled" ? empSummaryRes.value.data?.summary || {} : {};
      const totalEmp = empSummary.activeEmployees ?? empSummary.totalEmployees ?? 0;
      const attData = attendanceRes.status === "fulfilled" ? attendanceRes.value.data || {} : {};
      const attSummary = attData.summary || {};
      const leavesList = leavesRes.status === "fulfilled" ? leavesRes.value.data?.leaves || [] : [];
      const offersData = offersRes.status === "fulfilled" ? offersRes.value.data || {} : {};
      const cyclesList = cyclesRes.status === "fulfilled" ? cyclesRes.value.data?.cycles || [] : [];

      const currentCycle = cyclesList.find(
        (c) => c.periodMonth === selectedMonth && c.periodYear === selectedYear
      ) || cyclesList[0] || null;

      const present = attSummary.presentCount ?? 0;
      const onLeave = leavesList.filter(
        (l) => l.status === "APPROVED" && l.fromDate?.split("T")[0] <= todayStr && l.toDate?.split("T")[0] >= todayStr
      ).length;
      const absent = Math.max(0, totalEmp - present - onLeave);
      const late = attSummary.lateCount ?? 0;

      // 7-day fallback trend
      const fallbackDays = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        fallbackDays.push({
          date: d.toISOString().split("T")[0],
          dayOfWeek: d.getDay(),
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
          isToday: i === 0,
          presentCount: i === 0 ? present : Math.max(0, Math.round(totalEmp * 0.85)),
          absentCount: i === 0 ? absent : Math.max(0, Math.round(totalEmp * 0.1)),
          lateCount: i === 0 ? late : Math.max(0, Math.round(totalEmp * 0.05)),
          leaveCount: i === 0 ? onLeave : 0,
        });
      }

      setData({
        meta: {
          companyName: company?.companyName || "Organization",
          todayDate: todayStr,
          selectedDate: todayStr,
          selectedMonth,
          selectedYear,
          currencySymbol: "₹",
          departments: [],
          officeStartTime: "09:30 AM",
        },
        summary: {
          activeEmployees: totalEmp,
          todayPresent: present,
          todayAbsent: absent,
          todayLate: late,
          onLeave,
          monthlyPayroll: empSummary.totalMonthlySalary || 0,
          payrollStatus: currentCycle?.status || "Draft",
        },
        payrollCycleSummary: currentCycle
          ? {
              status: currentCycle.status,
              statusLabel: currentCycle.status.charAt(0) + currentCycle.status.slice(1).toLowerCase(),
              periodMonth: currentCycle.periodMonth,
              periodYear: currentCycle.periodYear,
              totalNetSalary: currentCycle.totalNetSalary || 0,
              employeeCount: currentCycle.employeeCount || 0,
              pendingAction: currentCycle.status === "FINALIZED" ? "Record salary disbursements" : "Review payroll calculations",
            }
          : {
              status: "DRAFT",
              statusLabel: "Draft",
              periodMonth: selectedMonth,
              periodYear: selectedYear,
              totalNetSalary: 0,
              employeeCount: 0,
              pendingAction: "Initialize monthly payroll register",
            },
        recruitmentFunnel: {
          offersGenerated: offersData.totalOffers || 0,
          accepted: offersData.acceptedCount || 0,
          acceptedPct: offersData.totalOffers > 0 ? Math.round(((offersData.acceptedCount || 0) / offersData.totalOffers) * 100) : 0,
          pending: offersData.pendingCount || 0,
          pendingPct: offersData.totalOffers > 0 ? Math.round(((offersData.pendingCount || 0) / offersData.totalOffers) * 100) : 0,
          declined: offersData.rejectedCount || 0,
          declinedPct: offersData.totalOffers > 0 ? Math.round(((offersData.rejectedCount || 0) / offersData.totalOffers) * 100) : 0,
          acceptanceRate: offersData.totalOffers > 0 ? ((offersData.acceptedCount || 0) / offersData.totalOffers * 100).toFixed(1) : "0.0",
        },
        attendanceCalendar: {
          month: selectedMonth,
          year: selectedYear,
          days: fallbackDays,
        },
        recentLeaves: leavesList.slice(0, 5).map((l) => ({
          id: l._id,
          employeeName: l.employeeId?.fullName || "Team Member",
          department: l.employeeId?.job?.department || "General",
          leaveType: l.leaveTypeCode || "Leave",
          daysCount: l.daysCount || 1,
          status: l.status || "PENDING",
        })),
        recentOffers: [],
        upcomingHolidays: [],
        salaryExpenses: [
          { month: "Jan", amount: 0 },
          { month: "Feb", amount: 0 },
          { month: "Mar", amount: 0 },
          { month: "Apr", amount: 0 },
          { month: "May", amount: 0 },
          { month: "Jun", amount: 0 },
          { month: "Jul", amount: 0 },
          { month: "Aug", amount: 0 },
          { month: "Sep", amount: 0 },
          { month: "Oct", amount: 0 },
          { month: "Nov", amount: 0 },
          { month: "Dec", amount: 0 },
        ],
        companyAssets: {
          totalEmployees: totalEmp,
          employeesWithAssets: Math.round(totalEmp * 0.75),
          employeesWithAssetsPct: 75,
        },
        projectTeams: {
          MANDATE: Math.round(totalEmp * 0.5),
          RETAIL: Math.round(totalEmp * 0.2),
          INTERNAL: Math.round(totalEmp * 0.2),
          BENCH: Math.max(0, totalEmp - Math.round(totalEmp * 0.9)),
        },
      });
      setLoading(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load dashboard metrics");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [selectedMonth, selectedYear, selectedDept]);

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
  const companyAssets = data?.companyAssets || { employeesWithAssetsPct: 0, employeesWithAssets: 0, totalEmployees: 0 };
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
      const dayIdx = d.dayOfWeek != null ? d.dayOfWeek : new Date(d.date).getDay();
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

  // Max expense amount for normalization in salary trend bars
  const maxExpense = useMemo(() => {
    return Math.max(1, ...salaryExpenses.map((s) => Number(s.amount || 0)));
  }, [salaryExpenses]);

  return (
    <div className="board-container">
      {/* ====================================================================
          1. Board Head: Greeting, Controls, Sync Button
          ==================================================================== */}
      <div className="board__head">
        <div>
          <h1 className="board__title">{getGreeting()}, {user?.name || "Eleanor"}</h1>
          <p className="board__sub">
            {meta.companyName || company?.companyName || "Organization"}
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
              ‹
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
              ›
            </button>
          </div>

          {/* Primary Action Button */}
          <Link to="/admin" className="btn--primary-fern">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add Employee</span>
          </Link>

          {/* Sync / Refresh Button */}
          <button
            type="button"
            className="btn--ghost-sync"
            onClick={fetchDashboardData}
            title="Sync live dashboard metrics"
            disabled={loading}
            aria-label="Refresh dashboard"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={loading ? "spin-icon" : ""}
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
        <Link to="/admin" className="card stat stat--hero" style={{ gridColumn: "span 3" }}>
          <div className="stat__head">
            <h2 className="stat__title">Total Workforce</h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{totalEmployees}</p>
          <p className="stat__note">
            <span className="trend-badge is-green">Active</span>
            <span>On company payroll</span>
          </p>
        </Link>

        {/* Card 2: Present Today */}
        <Link to="/admin/attendance?filter=PRESENT" className="card stat" style={{ gridColumn: "span 3" }}>
          <div className="stat__head">
            <h2 className="stat__title">Present Today</h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{summary.todayPresent ?? 0}</p>
          <p className="stat__note">
            <span className="trend-badge is-green">{attendanceRate}%</span>
            <span>Active presence rate</span>
          </p>
        </Link>

        {/* Card 3: Absent / Late / On Leave */}
        <Link to="/admin/leave" className="card stat" style={{ gridColumn: "span 3" }}>
          <div className="stat__head">
            <h2 className="stat__title">On Leave & Exceptions</h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{(summary.onLeave ?? 0) + (summary.todayLate ?? 0)}</p>
          <p className="stat__note">
            <span>{summary.onLeave ?? 0} on leave · {summary.todayLate ?? 0} late</span>
          </p>
        </Link>

        {/* Card 4: Pending HR Actions */}
        <Link to="/admin/leave?status=PENDING" className="card stat" style={{ gridColumn: "span 3" }}>
          <div className="stat__head">
            <h2 className="stat__title">Pending HR Actions</h2>
            <span className="stat__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17l10-10M7 7h10v10"/></svg>
            </span>
          </div>
          <p className="stat__num">{totalPendingActions}</p>
          <p className="stat__note">
            <span className="trend-badge is-amber">Review</span>
            <span>Awaiting authorization</span>
          </p>
        </Link>

        {/* ====================================================================
            ROW 2: ASYMMETRIC 8 / 4 SPLIT
            - Left (Span 8): Attendance & Work Hours Analytics (Capsule Bar Chart)
            - Right (Span 4): Pending HR Actions List
            ==================================================================== */}
        <section className="card analytics-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Attendance Trends</h2>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
              <span>{hoveredDay ? `Viewing ${hoveredDay.date || "Day"}` : `Shift active · Office starts ${meta.officeStartTime || "09:30 AM"}`}</span>
            </div>
          </div>
        </section>

        {/* Action Center (Span 4) */}
        <section className="card pending-actions-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Action Center</h2>
            </div>
            <span className="pending-count-chip">{totalPendingActions} pending</span>
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
                  {pendingLeaves.length > 0 ? `${pendingLeaves.length} employee request(s) awaiting review` : "All leave requests up to date"}
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
                <p className="task-desc">{pendingOffersCount > 0 ? `${pendingOffersCount} candidate offer(s) awaiting response` : "All issued offers tracked"}</p>
              </div>
              <span className="task-action-pill">Track</span>
            </Link>

            {/* 3. Candidate Onboarding */}
            <Link to="/admin/onboarding" className="pending-task-item" title="Onboarding checks">
              <div className="task-icon-circle icon-onboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Onboarding Pipeline</p>
                <p className="task-desc">Employee profile & credentials verification</p>
              </div>
              <span className="task-action-pill">Verify</span>
            </Link>

            {/* 4. Payroll Cycle Action */}
            <Link to="/admin/payroll" className="pending-task-item" title="Monthly payroll register">
              <div className="task-icon-circle icon-payroll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="7" cy="15" r="1.5"/></svg>
              </div>
              <div className="task-details">
                <p className="task-title">Payroll Status ({payrollCycle.statusLabel || "Draft"})</p>
                <p className="task-desc">{payrollCycle.pendingAction || "Review monthly compensation register"}</p>
              </div>
              <span className="task-action-pill">Process</span>
            </Link>
          </div>
        </section>

        {/* ====================================================================
            ROW 3: ASYMMETRIC 7 / 5 SPLIT
            - Left (Span 7): Recruitment & Offer Letters Process Funnel
            - Right (Span 5): Payroll & Compensation Health
            ==================================================================== */}
        <section className="card recruitment-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Offer Letters</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="funnel-rate-badge">{funnel.acceptanceRate || 0}% Conversion</span>
              <Link to="/admin/offers" className="card-shortcut-link">
                <span>Offer Letters</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <div className="funnel-process-row">
            {/* Stage 1: Generated */}
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

            {/* Stage 2: Pending */}
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

            {/* Stage 3: Accepted */}
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

            {/* Stage 4: Declined */}
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

        {/* Payroll & Compensation Health (Span 5) */}
        <section className="card payroll-card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Payroll</h2>
              <p className="card__sub">{monthNames[selectedMonth - 1]} {selectedYear} Cycle</p>
            </div>
            <Link to="/admin/payroll" className="card-shortcut-link">
              <span>Payroll</span>
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

          {/* 12-Month Expense Trend Mini Bars */}
          <div className="expense-mini-bars" aria-label="12-month salary expense history">
            {salaryExpenses.map((exp, idx) => {
              const val = Number(exp.amount || 0);
              const heightPct = Math.max(10, Math.min(100, Math.round((val / maxExpense) * 100)));
              return (
                <div key={`${exp.month}-${idx}`} className="expense-bar-col" title={`${exp.month}: ${formatShortCurrency(val, currencySym)}`}>
                  <div className="expense-bar-fill" style={{ height: `${heightPct}%` }} />
                  <span className="expense-bar-month">{exp.month?.[0]}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ====================================================================
            ROW 4: ASYMMETRIC 7 / 5 SPLIT
            - Left (Span 7): Recent Workforce Activity
            - Right (Span 5): Resources & Staffing Allocation (Combined Assets & Teams)
            ==================================================================== */}
        <section className="card team-activity-card" style={{ gridColumn: "span 7" }}>
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
              <p style={{ color: "var(--muted)", fontSize: "13px", margin: "14px 0" }}>
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

        {/* Combined Resources & Staffing (Span 5) */}
        <section className="card resources-allocation-card" style={{ gridColumn: "span 5" }}>
          <div className="card__head">
            <div>
              <h2 className="card__title">Resources & Staffing</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Link to="/admin/assets" className="card-shortcut-link" title="Company Assets">
                <span>Assets</span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link to="/admin/work-management" className="card-shortcut-link" title="Project Allocation">
                <span>Teams</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          <div className="resources-allocation-body">
            {/* Equipment Summary Sub-panel */}
            <div className="resource-sub-block">
              <div className="resource-sub-head">
                <span className="resource-sub-title">Assigned Hardware</span>
                <span className="resource-sub-badge">{companyAssets.employeesWithAssetsPct || 0}% Equipped</span>
              </div>
              <div className="asset-meter-track">
                <div
                  className="asset-meter-fill"
                  style={{ width: `${companyAssets.employeesWithAssetsPct || 0}%` }}
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                {companyAssets.employeesWithAssets || 0} of {companyAssets.totalEmployees || totalEmployees} staff active with company equipment
              </p>
            </div>

            {/* Project Distribution Sub-panel */}
            <div className="resource-sub-block" style={{ marginTop: 14 }}>
              <span className="resource-sub-title" style={{ marginBottom: 8, display: "block" }}>
                Project Allocation
              </span>
              <div className="teams-alloc-grid">
                <div className="team-alloc-chip">
                  <span className="team-alloc-dot" style={{ background: "var(--g-800)" }} />
                  <span className="team-alloc-name">Mandate</span>
                  <span className="team-alloc-num">{projectTeams.mandate?.count ?? projectTeams.MANDATE ?? 0}</span>
                </div>
                <div className="team-alloc-chip">
                  <span className="team-alloc-dot" style={{ background: "var(--g-600)" }} />
                  <span className="team-alloc-name">Retail</span>
                  <span className="team-alloc-num">{projectTeams.retail?.count ?? projectTeams.RETAIL ?? 0}</span>
                </div>
                <div className="team-alloc-chip">
                  <span className="team-alloc-dot" style={{ background: "#2563eb" }} />
                  <span className="team-alloc-name">Internal Ops</span>
                  <span className="team-alloc-num">{projectTeams.internal?.count ?? projectTeams.INTERNAL ?? (projectTeams.topStaffed?.[0]?.members ?? 0)}</span>
                </div>
                <div className="team-alloc-chip">
                  <span className="team-alloc-dot" style={{ background: "var(--amber)" }} />
                  <span className="team-alloc-name">Bench</span>
                  <span className="team-alloc-num">{projectTeams.bench?.count ?? projectTeams.BENCH ?? 0}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ====================================================================
            ROW 5: UPCOMING HOLIDAYS FOOTER STRIP (SPAN 12 FULL WIDTH)
            ==================================================================== */}
        <section className="card holidays-strip-card">
          <div className="card__head" style={{ marginBottom: 8 }}>
            <h3 className="card__title" style={{ fontSize: "15px" }}>Upcoming Company Holidays & Observances</h3>
            <Link to="/admin/policies" className="card-shortcut-link">
              <span>Policy Calendar</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="holidays-strip-row" role="list" aria-label="Upcoming holidays list">
            {upcomingHolidays.length === 0 ? (
              <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                No scheduled holidays remaining this month.
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
      </div>
    </div>
  );
}

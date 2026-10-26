import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";
import HrIntelligenceSection from "../components/HrIntelligenceSection";
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

function formatFullWeekdayDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    return dateStr;
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

export default function AdminDashboard() {
  const { user, company } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Month & Year Filter states
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [selectedDept, setSelectedDept] = useState("ALL");

  // Graph 1: Attendance Distribution Range ("TODAY" | "7D" | "30D")
  const [attendanceRange, setAttendanceRange] = useState("TODAY");

  // Graph 1: Interactive series visibility toggles for Donut Chart
  const [seriesVisibility, setSeriesVisibility] = useState({
    present: true,
    late: true,
    absent: true,
    leave: true,
  });

  // Graph 1: Active hover slice for donut center readout
  const [hoveredSlice, setHoveredSlice] = useState(null);

  // Calendar: Selected Date string (e.g. "2026-10-23")
  const [selectedCalendarDateStr, setSelectedCalendarDateStr] = useState(null);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Primary: call dedicated aggregated dashboard endpoint
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
          if (!selectedCalendarDateStr) {
            setSelectedCalendarDateStr(res.data.meta?.todayDate || res.data.meta?.selectedDate);
          }
          setLoading(false);
          return;
        }
      } catch (dashErr) {
        const is404 = dashErr.response?.status === 404;
        if (!is404) {
          throw dashErr;
        }
        console.warn("[Dashboard] /admin/dashboard returned 404, falling back to individual endpoints...");
      }

      // Fallback: aggregate individual endpoints
      const todayStr = new Date().toISOString().split("T")[0];
      const [empSummaryRes, attendanceRes, leavesRes, offersRes, policyRes, cyclesRes] = await Promise.allSettled([
        api.get("/employees/summary"),
        api.get("/admin/attendance/overview", {
          params: { date: todayStr, department: selectedDept },
        }),
        api.get("/leave-requests"),
        api.get("/offer-letters/summary"),
        api.get("/policies/active"),
        api.get("/payroll/cycles"),
      ]);

      const empSummary = empSummaryRes.status === "fulfilled" ? empSummaryRes.value.data?.summary || {} : {};
      const totalEmp = empSummary.activeEmployees ?? empSummary.totalEmployees ?? 0;
      const attData = attendanceRes.status === "fulfilled" ? attendanceRes.value.data || {} : {};
      const attSummary = attData.summary || {};
      const leavesList = leavesRes.status === "fulfilled" ? leavesRes.value.data?.leaves || [] : [];
      const offersData = offersRes.status === "fulfilled" ? offersRes.value.data || {} : {};
      const activePolicy = policyRes.status === "fulfilled" ? policyRes.value.data?.policy || {} : {};
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
          label: d.toLocaleDateString("en-US", { weekday: "short" }),
          present: i === 0 ? present : Math.max(0, Math.round(totalEmp * 0.85)),
          absent: i === 0 ? absent : Math.max(0, Math.round(totalEmp * 0.1)),
          late: i === 0 ? late : Math.max(0, Math.round(totalEmp * 0.05)),
          onLeave: i === 0 ? onLeave : 0,
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
              isFinalized: Boolean(currentCycle.isFinalized),
              totalNetSalary: currentCycle.totalNetSalary || 0,
              totalPaidAmount: currentCycle.totalPaidAmount || 0,
              exists: true,
              employeeCount: currentCycle.employeeCount || 0,
              pendingAction: currentCycle.status === "FINALIZED" ? "Record salary disbursements" : "Review payroll calculations",
            }
          : {
              status: "NOT_STARTED",
              statusLabel: "Not Started",
              periodMonth: selectedMonth,
              periodYear: selectedYear,
              isFinalized: false,
              totalNetSalary: 0,
              totalPaidAmount: 0,
              exists: false,
              employeeCount: 0,
              pendingAction: "Initialize payroll register for this cycle",
            },
        payrollActionCentre: {
          currentCycle: currentCycle || { status: "NOT_STARTED", periodMonth: selectedMonth, periodYear: selectedYear },
          lastCompletedCycle: null,
          hasPendingAction: true,
          pendingAction: "Review and process monthly payroll",
          isPaymentPending: false,
          pendingPaymentAmount: 0,
          employeesAwaitingProcessing: totalEmp,
        },
        recruitmentFunnel: {
          offersGenerated: offersData.totalOffers || 0,
          accepted: offersData.acceptedOffers || 0,
          acceptedPct: offersData.totalOffers > 0 ? Math.round((offersData.acceptedOffers / offersData.totalOffers) * 100) : 0,
          pending: offersData.sentOffers || 0,
          pendingPct: offersData.totalOffers > 0 ? Math.round((offersData.sentOffers / offersData.totalOffers) * 100) : 0,
          declined: offersData.rejectedOffers || 0,
          declinedPct: offersData.totalOffers > 0 ? Math.round((offersData.rejectedOffers / offersData.totalOffers) * 100) : 0,
          acceptanceRate: offersData.totalOffers > 0 ? ((offersData.acceptedOffers / offersData.totalOffers) * 100).toFixed(1) : "0.0",
        },
        attendanceOverview: {
          period: "This Week",
          days: fallbackDays,
        },
        attendanceCalendar: {
          month: selectedMonth,
          year: selectedYear,
          firstDayWeekday: new Date(selectedYear, selectedMonth - 1, 1).getDay(),
          daysInMonth: new Date(selectedYear, selectedMonth, 0).getDate(),
          days: fallbackDays.map((d, idx) => ({
            day: idx + 1,
            date: d.date,
            dayOfWeek: new Date(d.date).getDay(),
            isToday: d.date === todayStr,
            isFuture: false,
            isWeekend: new Date(d.date).getDay() === 0 || new Date(d.date).getDay() === 6,
            isHoliday: false,
            holidayName: null,
            presentCount: d.present,
            absentCount: d.absent,
            lateCount: d.late,
            leaveCount: d.onLeave,
          })),
        },
        recentLeaves: leavesList.slice(0, 5).map((l) => ({
          id: l._id,
          employeeName: l.employeeName || l.employeeId?.fullName || "Employee",
          department: l.employeeId?.job?.department || "General",
          avatar: l.employeeId?.avatar || "",
          leaveType: l.leaveType || l.leaveTypeCode || "Leave",
          fromDate: l.fromDate?.split("T")[0] || "",
          toDate: l.toDate?.split("T")[0] || "",
          daysCount: l.daysCount || 1,
          status: l.status || "PENDING",
        })),
        recentOffers: [],
        upcomingHolidays: (activePolicy?.holidays || []).slice(0, 5).map((h) => ({
          name: h.name,
          date: h.date?.split("T")[0] || "",
          isPaid: Boolean(h.isPaid),
        })),
      });
      if (!selectedCalendarDateStr) {
        setSelectedCalendarDateStr(todayStr);
      }
    } catch (err) {
      console.error("[Dashboard] Fetch error:", err);
      setError(err.response?.data?.message || err.message || "Failed to load dashboard data.");
    } finally {
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

  // Keyboard navigation handler for KPI cards
  const handleCardKeyDown = (e, destination) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(destination);
    }
  };

  // Derived payload objects
  const meta = data?.meta || {};
  const summary = data?.summary || {};
  const payrollCycle = data?.payrollCycleSummary || summary.payrollCycle || {};
  const payrollAction = data?.payrollActionCentre || {};
  const lastCompleted = data?.lastCompletedCycle || payrollAction.lastCompletedCycle || null;
  const funnel = data?.recruitmentFunnel || {};
  const weeklyAttendance = data?.attendanceOverview || {};
  const calendarData = data?.attendanceCalendar || {};
  const recentOffers = data?.recentOffers || [];
  const upcomingHolidays = data?.upcomingHolidays || [];

  const currencySym = meta.currencySymbol || "₹";
  const displayName = user?.name || user?.email?.split("@")[0] || "Admin";

  // Filter pending leaves for HR attention
  const pendingLeaves = useMemo(() => {
    return (data?.recentLeaves || []).filter((l) => l.status === "PENDING").slice(0, 5);
  }, [data?.recentLeaves]);

  // Overall attendance rate (% of active employees present today)
  const attendanceRate = useMemo(() => {
    const active = summary.activeEmployees || 0;
    const present = summary.todayPresent || 0;
    if (active === 0) return 0;
    return Math.min(Math.round((present / active) * 100), 100);
  }, [summary.activeEmployees, summary.todayPresent]);

  // Graph 1: Dynamic attendance distribution data based on range ("TODAY" | "7D" | "30D")
  const attendanceDistribution = useMemo(() => {
    if (attendanceRange === "TODAY") {
      const p = summary.todayPresent || 0;
      const l = summary.todayLate || 0;
      const a = summary.todayAbsent || 0;
      const lv = summary.onLeave || 0;
      return { present: p, late: l, absent: a, leave: lv };
    }

    if (attendanceRange === "7D") {
      const days = weeklyAttendance.days || [];
      let p = 0, l = 0, a = 0, lv = 0;
      days.forEach((d) => {
        p += d.present || 0;
        l += d.late || 0;
        a += d.absent || 0;
        lv += d.onLeave || 0;
      });
      return { present: p, late: l, absent: a, leave: lv };
    }

    // 30D: sum up all calendar days of the month
    const days = calendarData.days || [];
    let p = 0, l = 0, a = 0, lv = 0;
    days.forEach((d) => {
      p += d.presentCount || 0;
      l += d.lateCount || 0;
      a += d.absentCount || 0;
      lv += d.leaveCount || 0;
    });
    return { present: p, late: l, absent: a, leave: lv };
  }, [attendanceRange, summary, weeklyAttendance.days, calendarData.days]);

  // Graph 1: Donut Chart Slices computation
  const donutSlices = useMemo(() => {
    const categories = [
      { key: "present", label: "Present", count: attendanceDistribution.present, color: "#10b981", filterParam: "PRESENT" },
      { key: "late", label: "Late", count: attendanceDistribution.late, color: "#f59e0b", filterParam: "PRESENT" },
      { key: "absent", label: "Absent", count: attendanceDistribution.absent, color: "#ef4444", filterParam: "TOTAL_STAFF" },
      { key: "leave", label: "On Leave", count: attendanceDistribution.leave, color: "#6366f1", filterParam: "APPROVED", route: "/admin/leave" },
    ];

    const visibleCategories = categories.filter((c) => seriesVisibility[c.key]);
    const totalCount = visibleCategories.reduce((acc, c) => acc + c.count, 0);

    const circumference = 2 * Math.PI * 70; // r = 70
    let accumulatedOffset = 0;

    const slices = visibleCategories.map((c) => {
      const pct = totalCount > 0 ? (c.count / totalCount) * 100 : 0;
      const strokeLength = totalCount > 0 ? (c.count / totalCount) * circumference : 0;
      const dashArray = `${strokeLength.toFixed(2)} ${(circumference - strokeLength).toFixed(2)}`;
      const dashOffset = -accumulatedOffset;
      accumulatedOffset += strokeLength;

      return {
        ...c,
        percentage: pct,
        dashArray,
        dashOffset,
        totalCount,
      };
    });

    return { slices, totalCount, circumference };
  }, [attendanceDistribution, seriesVisibility]);

  // Calendar: Active selected day record
  const selectedCalendarDay = useMemo(() => {
    const days = calendarData.days || [];
    if (!days || days.length === 0) return null;
    const found = days.find((d) => d.date === selectedCalendarDateStr);
    return found || days.find((d) => d.isToday) || days[0];
  }, [calendarData.days, selectedCalendarDateStr]);

  // Calendar weekday alignment (Monday-first: Mon=0, Tue=1, ..., Sun=6)
  const calendarBlankSlots = useMemo(() => {
    const firstWeekday = calendarData.firstDayWeekday ?? 1; // 0=Sun, 1=Mon
    return (firstWeekday + 6) % 7;
  }, [calendarData.firstDayWeekday]);

  // Toggle single series visibility in legend
  const toggleSeries = (seriesKey) => {
    setSeriesVisibility((prev) => ({
      ...prev,
      [seriesKey]: !prev[seriesKey],
    }));
  };

  const payrollStatusLabel = payrollCycle.statusLabel || summary.payrollStatus || "Draft";

  return (
    <div className="admin-dashboard-page">
      {/* ====================================================================
          1. Welcome Header Section (Clean, Minimal, Modern)
          ==================================================================== */}
      <header className="dash-header">
        <div className="dash-header-welcome">
          <div className="dash-greeting-row">
            <h1 className="dash-greeting-title">
              {getGreeting()}, {displayName}
            </h1>
            <span className="dash-identity-pill">HR Workspace</span>
          </div>
          <p className="dash-greeting-subtitle">
            {meta.companyName || company?.companyName || "Organization"} · {meta.todayDate ? formatDisplayDate(meta.todayDate) : "Today"}
          </p>
        </div>

        <div className="dash-header-controls">
          {/* Department Filter */}
          {(meta.departments && meta.departments.length > 0) && (
            <div className="dash-ctrl-item" title="Filter by department">
              <label htmlFor="deptFilterSelect" className="dash-ctrl-label">Dept:</label>
              <select
                id="deptFilterSelect"
                className="dash-ctrl-select"
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
              >
                <option value="ALL">All Departments</option>
                {meta.departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Month / Year Navigator */}
          <div className="dash-month-selector" role="group" aria-label="Select month and year">
            <button
              type="button"
              className="dash-month-nav-btn"
              onClick={handlePrevMonth}
              title="Previous Month"
              aria-label="Previous Month"
            >
              ‹
            </button>
            <span className="dash-month-nav-text">
              {monthNames[selectedMonth - 1]} {selectedYear}
            </span>
            <button
              type="button"
              className="dash-month-nav-btn"
              onClick={handleNextMonth}
              title="Next Month"
              aria-label="Next Month"
            >
              ›
            </button>
          </div>

          {/* Quick Action: Add Employee */}
          <Link
            to="/admin"
            className="dash-action-btn-primary"
            title="Manage or add employees"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add Employee</span>
          </Link>

          {/* Refresh Action */}
          <button
            type="button"
            className="dash-action-btn-secondary"
            onClick={fetchDashboardData}
            title="Sync live dashboard metrics"
            disabled={loading}
            aria-label="Sync live metrics"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={loading ? "dash-icon-spin" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="dash-alert dash-alert-error" role="alert">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
          <button type="button" className="dash-alert-retry" onClick={fetchDashboardData}>
            Retry
          </button>
        </div>
      )}

      {/* ====================================================================
          2. Top KPI Cards — STRICT MAXIMUM FOUR
          Every card is a fully clickable, keyboard-accessible link to its feature.
          ==================================================================== */}
      <section className="dash-kpi-grid" aria-label="Key Performance Indicators">
        {/* KPI 1: Active Employees */}
        <Link
          to="/admin?status=ACTIVE"
          className="dash-kpi-card"
          role="link"
          tabIndex={0}
          onKeyDown={(e) => handleCardKeyDown(e, "/admin?status=ACTIVE")}
          aria-label={`Active Employees: ${summary.activeEmployees ?? 0}. Click to view active employee directory.`}
        >
          <div className="dash-kpi-header">
            <span className="dash-kpi-label">Active Employees</span>
            <div className="dash-kpi-icon-wrap dash-kpi-icon-blue" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
          </div>
          <div className="dash-kpi-body">
            <span className="dash-kpi-value">{summary.activeEmployees ?? 0}</span>
            <div className="dash-kpi-meta">
              <span className="dash-kpi-tagline">On active company payroll</span>
              <span className="dash-kpi-arrow" aria-hidden="true">→</span>
            </div>
          </div>
        </Link>

        {/* KPI 2: Present Today */}
        <Link
          to="/admin/attendance?filter=PRESENT"
          className="dash-kpi-card"
          role="link"
          tabIndex={0}
          onKeyDown={(e) => handleCardKeyDown(e, "/admin/attendance?filter=PRESENT")}
          aria-label={`Present Today: ${summary.todayPresent ?? 0}. Click to view today's attendance records.`}
        >
          <div className="dash-kpi-header">
            <span className="dash-kpi-label">Present Today</span>
            <div className="dash-kpi-icon-wrap dash-kpi-icon-green" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="dash-kpi-body">
            <span className="dash-kpi-value">{summary.todayPresent ?? 0}</span>
            <div className="dash-kpi-meta">
              <span className="dash-kpi-tagline">
                {summary.todayLate > 0 ? `${summary.todayLate} late arrivals` : "Checked in on shift"}
              </span>
              <span className="dash-kpi-arrow" aria-hidden="true">→</span>
            </div>
          </div>
        </Link>

        {/* KPI 3: On Leave Today */}
        <Link
          to="/admin/leave?status=APPROVED"
          className="dash-kpi-card"
          role="link"
          tabIndex={0}
          onKeyDown={(e) => handleCardKeyDown(e, "/admin/leave?status=APPROVED")}
          aria-label={`On Leave Today: ${summary.onLeave ?? 0}. Click to view approved leave records.`}
        >
          <div className="dash-kpi-header">
            <span className="dash-kpi-label">On Leave Today</span>
            <div className="dash-kpi-icon-wrap dash-kpi-icon-purple" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <div className="dash-kpi-body">
            <span className="dash-kpi-value">{summary.onLeave ?? 0}</span>
            <div className="dash-kpi-meta">
              <span className="dash-kpi-tagline">Approved scheduled leaves</span>
              <span className="dash-kpi-arrow" aria-hidden="true">→</span>
            </div>
          </div>
        </Link>

        {/* KPI 4: Payroll Status */}
        <Link
          to="/admin/payroll?tab=payroll_registers"
          className="dash-kpi-card"
          role="link"
          tabIndex={0}
          onKeyDown={(e) => handleCardKeyDown(e, "/admin/payroll?tab=payroll_registers")}
          aria-label={`Payroll Status: ${payrollStatusLabel}. Click to view monthly payroll registers.`}
        >
          <div className="dash-kpi-header">
            <span className="dash-kpi-label">Payroll Status</span>
            <div className="dash-kpi-icon-wrap dash-kpi-icon-amber" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
          </div>
          <div className="dash-kpi-body">
            <span className="dash-kpi-value dash-kpi-value-text">{payrollStatusLabel}</span>
            <div className="dash-kpi-meta">
              <span className="dash-kpi-tagline">
                {monthNames[selectedMonth - 1]?.slice(0, 3)} {selectedYear} · {formatShortCurrency(summary.monthlyPayroll || payrollCycle.totalNetSalary, currencySym)}
              </span>
              <span className="dash-kpi-arrow" aria-hidden="true">→</span>
            </div>
          </div>
        </Link>
      </section>

      {/* HR Intelligence Section: Proactive Action Items & Bottlenecks */}
      <HrIntelligenceSection />

      {/* ====================================================================
          3. Modernized Graphs Section — EXACTLY TWO PRIMARY GRAPHS
          Graph 1: Interactive Donut Attendance Overview with Attendance Rate
          Graph 2: Polished Compact Recruitment Funnel
          (Vertical monthly payroll graph has been completely removed)
          ==================================================================== */}
      <section className="dash-graphs-row" aria-label="Attendance and Recruitment Analytics">
        {/* Graph 1: Modern Interactive Donut Attendance Overview */}
        <article className="dash-chart-card dash-chart-card-attendance">
          <div className="dash-card-header">
            <div className="dash-card-title-group">
              <div className="dash-card-title-badge-row">
                <h2 className="dash-card-title">Attendance Overview</h2>
                {/* Selectable Range Toggle */}
                <div className="dash-range-toggle" role="tablist" aria-label="Select attendance range">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={attendanceRange === "TODAY"}
                    className={`dash-range-btn ${attendanceRange === "TODAY" ? "is-active" : ""}`}
                    onClick={() => setAttendanceRange("TODAY")}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={attendanceRange === "7D"}
                    className={`dash-range-btn ${attendanceRange === "7D" ? "is-active" : ""}`}
                    onClick={() => setAttendanceRange("7D")}
                  >
                    7 Days
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={attendanceRange === "30D"}
                    className={`dash-range-btn ${attendanceRange === "30D" ? "is-active" : ""}`}
                    onClick={() => setAttendanceRange("30D")}
                  >
                    30 Days
                  </button>
                </div>
              </div>
              <span className="dash-card-subtitle">
                {attendanceRange === "TODAY"
                  ? "Live distribution for current shift"
                  : attendanceRange === "7D"
                  ? "Aggregated distribution for past 7 days"
                  : `Monthly distribution for ${monthNames[selectedMonth - 1]} ${selectedYear}`}
              </span>
            </div>

            <div className="dash-rate-badge-pill" title="Present rate across active workforce">
              <span className="dash-rate-number">{attendanceRate}%</span>
              <span className="dash-rate-tag">Present Rate</span>
            </div>
          </div>

          {/* Interactive Donut Visualization + Metrics Breakdown */}
          <div className="dash-donut-content-layout">
            {/* SVG Donut Chart with Interactive Center Readout */}
            <div className="dash-donut-svg-wrap">
              <svg className="dash-donut-svg" viewBox="0 0 200 200">
                {/* Background Track */}
                <circle
                  cx="100"
                  cy="100"
                  r="70"
                  stroke="#f1f5f9"
                  strokeWidth="22"
                  fill="none"
                />

                {/* Render Donut Slices */}
                {donutSlices.totalCount === 0 ? (
                  <circle
                    cx="100"
                    cy="100"
                    r="70"
                    stroke="#e2e8f0"
                    strokeWidth="22"
                    fill="none"
                  />
                ) : (
                  donutSlices.slices.map((slice) => (
                    <circle
                      key={slice.key}
                      cx="100"
                      cy="100"
                      r="70"
                      stroke={slice.color}
                      strokeWidth={hoveredSlice === slice.key ? "25" : "22"}
                      strokeDasharray={slice.dashArray}
                      strokeDashoffset={slice.dashOffset}
                      fill="none"
                      transform="rotate(-90 100 100)"
                      cursor="pointer"
                      className="dash-donut-slice"
                      onMouseEnter={() => setHoveredSlice(slice.key)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      onClick={() => {
                        if (slice.route) {
                          navigate(`${slice.route}?status=${slice.filterParam}`);
                        } else {
                          navigate(`/admin/attendance?filter=${slice.filterParam}`);
                        }
                      }}
                    />
                  ))
                )}
              </svg>

              {/* Dynamic Center Readout on Hover or Default to Attendance Rate */}
              <div className="dash-donut-center" aria-live="polite">
                {hoveredSlice ? (
                  (() => {
                    const activeSlice = donutSlices.slices.find((s) => s.key === hoveredSlice);
                    if (!activeSlice) return null;
                    return (
                      <>
                        <span className="dash-center-number" style={{ color: activeSlice.color }}>
                          {activeSlice.count}
                        </span>
                        <span className="dash-center-label">{activeSlice.label}</span>
                        <span className="dash-center-pct">({activeSlice.percentage.toFixed(1)}%)</span>
                      </>
                    );
                  })()
                ) : (
                  <>
                    <span className="dash-center-number">{summary.todayPresent ?? 0}</span>
                    <span className="dash-center-label">Present</span>
                    <span className="dash-center-pct">{attendanceRate}% active</span>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Legend with Toggle Controls & Exact Counts */}
            <div className="dash-donut-legend-list" role="list" aria-label="Attendance categories">
              {donutSlices.slices.map((slice) => {
                const isHovered = hoveredSlice === slice.key;

                return (
                  <div
                    key={slice.key}
                    role="listitem"
                    className={`dash-donut-legend-item ${isHovered ? "is-hovered" : ""}`}
                    onMouseEnter={() => setHoveredSlice(slice.key)}
                    onMouseLeave={() => setHoveredSlice(null)}
                  >
                    <button
                      type="button"
                      className="dash-legend-toggle-btn"
                      onClick={() => toggleSeries(slice.key)}
                      title={`Toggle ${slice.label} slice`}
                      aria-label={`Toggle ${slice.label}`}
                    >
                      <span className="dash-legend-dot" style={{ background: slice.color }} />
                      <span className="dash-legend-label">{slice.label}</span>
                    </button>
                    <div className="dash-legend-values">
                      <span className="dash-legend-count">{slice.count}</span>
                      <span className="dash-legend-pct">({slice.percentage.toFixed(0)}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-card-footer">
            <span className="dash-card-footer-info">
              Click any category or slice to view filtered attendance records
            </span>
            <Link to="/admin/attendance" className="dash-card-link">
              View Attendance Hub →
            </Link>
          </div>
        </article>

        {/* Graph 2: Polished Compact Recruitment Funnel */}
        <article className="dash-chart-card dash-chart-card-funnel">
          <div className="dash-card-header">
            <div className="dash-card-title-group">
              <h2 className="dash-card-title">Recruitment Funnel</h2>
              <span className="dash-card-subtitle">Active hiring pipeline conversion</span>
            </div>
            <span className="dash-funnel-rate-pill" title="Conversion rate of accepted candidates">
              {funnel.acceptanceRate || "0.0"}% Conversion
            </span>
          </div>

          <div className="dash-funnel-stages-wrap">
            {/* Stage 1: Offers Generated */}
            <Link
              to="/admin/offers"
              className="dash-funnel-stage-card is-interactive"
              title="Click to view all offers"
            >
              <div className="dash-funnel-stage-header">
                <div className="dash-funnel-stage-left">
                  <div className="dash-stage-icon-dot dash-dot-dark" />
                  <span className="dash-stage-name">Offers Generated</span>
                </div>
                <div className="dash-stage-right">
                  <span className="dash-stage-number">{funnel.offersGenerated || 0}</span>
                  <span className="dash-stage-sub">total</span>
                </div>
              </div>
              <div className="dash-funnel-meter-track">
                <div
                  className="dash-funnel-meter-fill dash-fill-neutral"
                  style={{ width: `${funnel.offersGenerated > 0 ? 100 : 0}%` }}
                />
              </div>
            </Link>

            {/* Stage 2: Accepted */}
            <Link
              to="/admin/offers?status=ACCEPTED"
              className="dash-funnel-stage-card is-interactive"
              title="Click to view Accepted offers"
            >
              <div className="dash-funnel-stage-header">
                <div className="dash-funnel-stage-left">
                  <div className="dash-stage-icon-dot dash-dot-green" />
                  <span className="dash-stage-name">Accepted</span>
                </div>
                <div className="dash-stage-right">
                  <span className="dash-stage-number">{funnel.accepted || 0}</span>
                  <span className="dash-stage-sub">({funnel.acceptedPct || 0}%)</span>
                </div>
              </div>
              <div className="dash-funnel-meter-track">
                <div
                  className="dash-funnel-meter-fill dash-fill-green"
                  style={{ width: `${Math.min(funnel.acceptedPct || 0, 100)}%` }}
                />
              </div>
            </Link>

            {/* Stage 3: Pending Candidate Review */}
            <Link
              to="/admin/offers?status=SENT"
              className="dash-funnel-stage-card is-interactive"
              title="Click to view Sent & Pending offers"
            >
              <div className="dash-funnel-stage-header">
                <div className="dash-funnel-stage-left">
                  <div className="dash-stage-icon-dot dash-dot-amber" />
                  <span className="dash-stage-name">Pending Candidate Review</span>
                </div>
                <div className="dash-stage-right">
                  <span className="dash-stage-number">{funnel.pending || 0}</span>
                  <span className="dash-stage-sub">({funnel.pendingPct || 0}%)</span>
                </div>
              </div>
              <div className="dash-funnel-meter-track">
                <div
                  className="dash-funnel-meter-fill dash-fill-amber"
                  style={{ width: `${Math.min(funnel.pendingPct || 0, 100)}%` }}
                />
              </div>
            </Link>

            {/* Stage 4: Declined */}
            <Link
              to="/admin/offers?status=REJECTED"
              className="dash-funnel-stage-card is-interactive"
              title="Click to view Declined offers"
            >
              <div className="dash-funnel-stage-header">
                <div className="dash-funnel-stage-left">
                  <div className="dash-stage-icon-dot dash-dot-red" />
                  <span className="dash-stage-name">Declined / Rejected</span>
                </div>
                <div className="dash-stage-right">
                  <span className="dash-stage-number">{funnel.declined || 0}</span>
                  <span className="dash-stage-sub">({funnel.declinedPct || 0}%)</span>
                </div>
              </div>
              <div className="dash-funnel-meter-track">
                <div
                  className="dash-funnel-meter-fill dash-fill-red"
                  style={{ width: `${Math.min(funnel.declinedPct || 0, 100)}%` }}
                />
              </div>
            </Link>
          </div>

          <div className="dash-card-footer">
            <span className="dash-card-footer-info">
              Stages link directly to filtered offer letters
            </span>
            <Link to="/admin/offers" className="dash-card-link">
              Manage Offers →
            </Link>
          </div>
        </article>
      </section>

      {/* ====================================================================
          4. Useful Payroll Action Centre & Compact Attendance Calendar
          - Left: Payroll Action Centre (What do I need to do about payroll?)
          - Right: Compact Attendance Calendar (Conventional 7-column monthly widget)
          ==================================================================== */}
      <section className="dash-payroll-calendar-row" aria-label="Payroll Action Centre and Attendance Calendar">
        {/* Payroll Action Centre */}
        <article className="dash-payroll-action-card">
          <div className="dash-card-header">
            <div className="dash-card-title-group">
              <div className="dash-card-title-badge-row">
                <h3 className="dash-card-title">Payroll Action Centre</h3>
                <span className={`dash-action-status-pill pill-${payrollCycle.status ? payrollCycle.status.toLowerCase() : "draft"}`}>
                  {payrollStatusLabel}
                </span>
              </div>
              <span className="dash-card-subtitle">
                Operational status for {monthNames[selectedMonth - 1]} {selectedYear}
              </span>
            </div>
            <Link to="/admin/payroll?tab=payroll_registers" className="dash-payroll-hub-link">
              Payroll Register →
            </Link>
          </div>

          {/* Primary Action Banner */}
          <div className="dash-payroll-primary-action-box">
            <div className="dash-primary-action-text-group">
              <span className="dash-action-eyebrow">Required HR Action:</span>
              <p className="dash-action-headline">
                {payrollCycle.pendingAction || "Review monthly compensation calculations"}
              </p>
            </div>
            <Link
              to="/admin/payroll?tab=payroll_registers"
              className="dash-action-cta-btn"
              title="Open payroll register to act"
            >
              <span>Take Action</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* Key Payroll Metrics & Breakdown Panel */}
          <div className="dash-payroll-metrics-list">
            {/* Row 1: Cycle Amount */}
            <div className="dash-payroll-metric-row">
              <div className="dash-pm-label-wrap">
                <span className="dash-pm-dot" />
                <span className="dash-pm-label">Net Payable Salary:</span>
              </div>
              <span className="dash-pm-value">
                {formatFullINR(payrollCycle.totalNetSalary || summary.monthlyPayroll || 0, currencySym)}
              </span>
            </div>

            {/* Row 2: Employees Awaiting Processing */}
            <div className="dash-payroll-metric-row">
              <div className="dash-pm-label-wrap">
                <span className="dash-pm-dot" />
                <span className="dash-pm-label">Staff in Active Register:</span>
              </div>
              <span className="dash-pm-value">
                <strong>{payrollCycle.employeeCount || 0}</strong> of {summary.activeEmployees || 0} active employees
                {payrollCycle.employeesAwaitingProcessing > 0 && (
                  <span className="dash-pm-tag-amber"> ({payrollCycle.employeesAwaitingProcessing} pending)</span>
                )}
              </span>
            </div>

            {/* Row 3: Payment Status */}
            <div className="dash-payroll-metric-row">
              <div className="dash-pm-label-wrap">
                <span className="dash-pm-dot" />
                <span className="dash-pm-label">Disbursement Status:</span>
              </div>
              <span className="dash-pm-value">
                {payrollCycle.isPaymentPending ? (
                  <span className="dash-pm-tag-rose">
                    Payment Pending ({formatShortCurrency(payrollCycle.pendingPaymentAmount || payrollCycle.totalNetSalary, currencySym)})
                  </span>
                ) : payrollCycle.status === "PAID" ? (
                  <span className="dash-pm-tag-green">All payouts recorded</span>
                ) : (
                  <span className="dash-pm-tag-neutral">Awaiting cycle finalization</span>
                )}
              </span>
            </div>

            {/* Row 4: Last Completed Cycle */}
            {lastCompleted && (
              <div className="dash-payroll-metric-row">
                <div className="dash-pm-label-wrap">
                  <span className="dash-pm-dot" />
                  <span className="dash-pm-label">Last Completed Cycle:</span>
                </div>
                <span className="dash-pm-value">
                  {monthNames[lastCompleted.periodMonth - 1]?.slice(0, 3)} {lastCompleted.periodYear} · {formatShortCurrency(lastCompleted.totalNetSalary, currencySym)}
                  {lastCompleted.paymentDate && ` (Paid ${formatDisplayDate(lastCompleted.paymentDate)})`}
                </span>
              </div>
            )}
          </div>

          <div className="dash-card-footer">
            <span className="dash-card-footer-info">
              Real-time synchronization with tenant payroll cycle workflows
            </span>
            <Link to="/admin/payroll" className="dash-card-link">
              Open Payroll Hub →
            </Link>
          </div>
        </article>

        {/* Compact Attendance Calendar (Conventional 7-column Monthly Widget) */}
        <article className="dash-calendar-card" aria-label="Monthly Attendance Calendar">
          <div className="dash-calendar-header">
            <div className="dash-calendar-title-wrap">
              <div className="dash-calendar-icon-pill" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <h3 className="dash-calendar-title">Attendance Calendar</h3>
                <span className="dash-calendar-subtitle">
                  {monthNames[selectedMonth - 1]} {selectedYear}
                </span>
              </div>
            </div>

            {/* Month Navigation Controls */}
            <div className="dash-cal-nav-buttons">
              <button
                type="button"
                className="dash-cal-nav-btn"
                onClick={handlePrevMonth}
                title="Previous Month"
                aria-label="Previous Month"
              >
                ‹
              </button>
              <button
                type="button"
                className="dash-cal-nav-btn"
                onClick={handleNextMonth}
                title="Next Month"
                aria-label="Next Month"
              >
                ›
              </button>
            </div>
          </div>

          {/* Weekday Row (Mon - Sun) */}
          <div className="dash-cal-weekdays-row" aria-hidden="true">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>

          {/* Compact Calendar Grid with Rectangular Date Cells */}
          <div className="dash-cal-grid" role="grid" aria-label={`Calendar grid for ${monthNames[selectedMonth - 1]} ${selectedYear}`}>
            {/* Blank offset cells before the 1st of month */}
            {Array.from({ length: calendarBlankSlots }).map((_, idx) => (
              <div key={`blank-${idx}`} className="dash-cal-cell dash-cal-blank" aria-hidden="true" />
            ))}

            {/* Days of the Month */}
            {(calendarData.days || []).map((dayItem) => {
              const isSelected = selectedCalendarDateStr === dayItem.date;
              const hasActivity = dayItem.presentCount > 0 || dayItem.lateCount > 0 || dayItem.leaveCount > 0 || dayItem.absentCount > 0;

              return (
                <button
                  key={dayItem.date}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`dash-cal-cell dash-cal-day ${isSelected ? "is-selected" : ""} ${dayItem.isToday ? "is-today" : ""} ${dayItem.isWeekend ? "is-weekend" : ""} ${dayItem.isHoliday ? "is-holiday" : ""}`}
                  onClick={() => setSelectedCalendarDateStr(dayItem.date)}
                  title={`${dayItem.date}: ${dayItem.isHoliday ? dayItem.holidayName : (dayItem.isWeekend ? "Weekend" : `${dayItem.presentCount} present, ${dayItem.leaveCount} on leave`)}`}
                >
                  <span className="dash-cal-day-num">{dayItem.day}</span>

                  {/* Accessible Status Indicator Dots */}
                  <div className="dash-cal-dots-wrap" aria-hidden="true">
                    {dayItem.isHoliday ? (
                      <span className="dash-cal-holiday-star" title="Holiday">★</span>
                    ) : hasActivity ? (
                      <>
                        {dayItem.presentCount > 0 && <span className="dash-cal-dot dot-present" />}
                        {dayItem.lateCount > 0 && <span className="dash-cal-dot dot-late" />}
                        {dayItem.leaveCount > 0 && <span className="dash-cal-dot dot-leave" />}
                        {dayItem.absentCount > 0 && !dayItem.isWeekend && <span className="dash-cal-dot dot-absent" />}
                      </>
                    ) : (
                      <span className="dash-cal-dot dot-empty" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Compact Calendar Legend */}
          <div className="dash-cal-legend-bar">
            <span className="dash-cal-legend-item">
              <span className="dash-cal-dot dot-present" /> Present
            </span>
            <span className="dash-cal-legend-item">
              <span className="dash-cal-dot dot-late" /> Late
            </span>
            <span className="dash-cal-legend-item">
              <span className="dash-cal-dot dot-leave" /> Leave
            </span>
            <span className="dash-cal-legend-item">
              <span className="dash-cal-dot dot-absent" /> Absent
            </span>
            <span className="dash-cal-legend-item">
              <span className="dash-cal-holiday-star">★</span> Holiday
            </span>
          </div>

          {/* Selected Date Summary Box */}
          {selectedCalendarDay && (
            <div className="dash-cal-selected-summary">
              <div className="dash-selected-header">
                <div>
                  <h4 className="dash-selected-date-text">
                    {formatFullWeekdayDate(selectedCalendarDay.date)}
                  </h4>
                  <span className="dash-selected-tag">
                    {selectedCalendarDay.isToday
                      ? "Today"
                      : selectedCalendarDay.isHoliday
                      ? `Holiday: ${selectedCalendarDay.holidayName}`
                      : selectedCalendarDay.isWeekend
                      ? "Weekend"
                      : "Workday"}
                  </span>
                </div>
                <Link
                  to={`/admin/attendance?date=${selectedCalendarDay.date}`}
                  className="dash-selected-action-btn"
                  title={`View detailed attendance records for ${selectedCalendarDay.date}`}
                >
                  <span>View Attendance</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>

              <div className="dash-selected-badges-grid">
                <div className="dash-selected-badge dash-badge-present">
                  <span className="dash-badge-num">{selectedCalendarDay.presentCount ?? 0}</span>
                  <span className="dash-badge-lbl">Present</span>
                </div>
                <div className="dash-selected-badge dash-badge-late">
                  <span className="dash-badge-num">{selectedCalendarDay.lateCount ?? 0}</span>
                  <span className="dash-badge-lbl">Late</span>
                </div>
                <div className="dash-selected-badge dash-badge-leave">
                  <span className="dash-badge-num">{selectedCalendarDay.leaveCount ?? 0}</span>
                  <span className="dash-badge-lbl">On Leave</span>
                </div>
                <div className="dash-selected-badge dash-badge-absent">
                  <span className="dash-badge-num">{selectedCalendarDay.absentCount ?? 0}</span>
                  <span className="dash-badge-lbl">Absent</span>
                </div>
              </div>
            </div>
          )}
        </article>
      </section>

      {/* ====================================================================
          5. Compact Supporting Operational Information
          - Panel 1: Pending Leave Requests
          - Panel 2: Recent Offer Letters
          - Panel 3: Upcoming Holidays
          ==================================================================== */}
      <section className="dash-operational-grid" aria-label="Operational updates and tasks">
        {/* Panel 1: Pending Leave Requests */}
        <article className="dash-panel-card">
          <div className="dash-panel-header">
            <div className="dash-panel-title-wrap">
              <h3 className="dash-panel-title">Pending Leave Requests</h3>
              <span className="dash-panel-badge dash-badge-amber">
                {pendingLeaves.length} pending
              </span>
            </div>
            <Link to="/admin/leave?status=PENDING" className="dash-panel-link">
              View All
            </Link>
          </div>

          <div className="dash-panel-content">
            {pendingLeaves.length === 0 ? (
              <div className="dash-panel-empty">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#a1a1aa" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <p className="dash-panel-empty-title">All leaves reviewed</p>
                <span className="dash-panel-empty-text">No pending leave requests requiring HR attention.</span>
              </div>
            ) : (
              <ul className="dash-operational-list">
                {pendingLeaves.map((l) => (
                  <li key={l.id} className="dash-operational-item">
                    <div className="dash-avatar-circle">
                      {l.avatar ? (
                        <img src={l.avatar} alt={l.employeeName} className="dash-avatar-img" />
                      ) : (
                        <span>{l.employeeName.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="dash-item-info">
                      <span className="dash-item-primary">{l.employeeName}</span>
                      <span className="dash-item-secondary">
                        {l.leaveType} · {l.daysCount} {l.daysCount === 1 ? "day" : "days"} ({formatDisplayDate(l.fromDate)})
                      </span>
                    </div>
                    <Link
                      to="/admin/leave?status=PENDING"
                      className="dash-item-action-btn"
                      title="Review leave request"
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        {/* Panel 2: Recent Offer Letters */}
        <article className="dash-panel-card">
          <div className="dash-panel-header">
            <div className="dash-panel-title-wrap">
              <h3 className="dash-panel-title">Recent Offer Letters</h3>
              <span className="dash-panel-badge dash-badge-neutral">
                {recentOffers.length} recent
              </span>
            </div>
            <Link to="/admin/offers" className="dash-panel-link">
              View All
            </Link>
          </div>

          <div className="dash-panel-content">
            {recentOffers.length === 0 ? (
              <div className="dash-panel-empty">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#a1a1aa" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <p className="dash-panel-empty-title">No recent activity</p>
                <span className="dash-panel-empty-text">No recent offer letters generated.</span>
              </div>
            ) : (
              <ul className="dash-operational-list">
                {recentOffers.map((o) => (
                  <li key={o.id} className="dash-operational-item">
                    <div className="dash-item-info">
                      <span className="dash-item-primary">{o.candidateName}</span>
                      <span className="dash-item-secondary">
                        {o.position} {o.department ? `· ${o.department}` : ""}
                      </span>
                    </div>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>

        {/* Panel 3: Upcoming Holidays */}
        <article className="dash-panel-card">
          <div className="dash-panel-header">
            <div className="dash-panel-title-wrap">
              <h3 className="dash-panel-title">Upcoming Holidays</h3>
              <span className="dash-panel-badge dash-badge-neutral">
                {upcomingHolidays.length} upcoming
              </span>
            </div>
            <Link to="/admin/policies" className="dash-panel-link">
              Calendar
            </Link>
          </div>

          <div className="dash-panel-content">
            {upcomingHolidays.length === 0 ? (
              <div className="dash-panel-empty">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#a1a1aa" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p className="dash-panel-empty-title">No upcoming holidays</p>
                <span className="dash-panel-empty-text">No company holidays scheduled in the policy calendar.</span>
              </div>
            ) : (
              <ul className="dash-operational-list">
                {upcomingHolidays.map((h, idx) => {
                  const parts = h.date?.split("-") || [];
                  const monthShort = parts[1] ? monthNames[parseInt(parts[1], 10) - 1]?.slice(0, 3) : "—";
                  const dayNum = parts[2] || "—";

                  return (
                    <li key={`${h.name}-${idx}`} className="dash-operational-item">
                      <div className="dash-holiday-date-badge">
                        <span className="dash-holiday-month">{monthShort}</span>
                        <span className="dash-holiday-day">{dayNum}</span>
                      </div>
                      <div className="dash-item-info">
                        <span className="dash-item-primary">{h.name}</span>
                        <span className="dash-item-secondary">
                          {h.isPaid ? "Paid Holiday" : "Company Holiday"}
                        </span>
                      </div>
                      <span className="dash-holiday-tag">Scheduled</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

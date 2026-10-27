import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useSearchParams, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import AttendanceMap from "../components/AttendanceMap";
import EmployeeAttendanceDrawer from "../components/EmployeeAttendanceDrawer";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconClose,
  IconClipboardList,
  IconAlertCircle,
  IconCheck,
  IconClock,
} from "../components/Icons";
import api from "../services/api";
import "./Attendance.css";

const FILTER_TYPES = {
  TOTAL_STAFF: "TOTAL_STAFF",
  PRESENT: "PRESENT",
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
  LIVE_TRACKING: "LIVE_TRACKING",
};

const FILTER_LABELS = {
  [FILTER_TYPES.TOTAL_STAFF]: "All Staff",
  [FILTER_TYPES.PRESENT]: "Present Today",
  [FILTER_TYPES.CHECKED_IN]: "On Duty (Checked In)",
  [FILTER_TYPES.CHECKED_OUT]: "Completed Shift",
  [FILTER_TYPES.LIVE_TRACKING]: "Live Field GPS",
};

export default function AdminAttendanceOverview() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState(() => searchParams.get("date") || new Date().toISOString().split("T")[0]);
  const [department, setDepartment] = useState("ALL");
  const [tableSearch, setTableSearch] = useState("");
  const initialFilter = searchParams.get("filter") === "PRESENT" ? FILTER_TYPES.PRESENT : FILTER_TYPES.TOTAL_STAFF;
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [attendancePage, setAttendancePage] = useState(1);
  const [attendancePageSize, setAttendancePageSize] = useState(25);

  // Drawer State (Part 4)
  const [drawerEmployeeId, setDrawerEmployeeId] = useState(null);
  const [drawerIndex, setDrawerIndex] = useState(-1);

  const [overviewData, setOverviewData] = useState({
    date: "",
    summary: {
      totalEmployees: 0,
      presentCount: 0,
      checkedInCount: 0,
      checkedOutCount: 0,
      notCheckedInCount: 0,
      liveTrackingCount: 0,
      withLocationCount: 0,
    },
    employees: [],
  });

  const isFetchingRef = useRef(false);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchOverview = useCallback(
    async (silent = false) => {
      if (silent && isFetchingRef.current) {
        return;
      }

      const currentReqId = ++requestIdRef.current;

      if (!silent && abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      try {
        if (!silent) setLoading(true);
        setError("");
        const params = { date };
        if (department !== "ALL") {
          params.department = department;
        }

        const res = await api.get("/admin/attendance/overview", {
          params,
          signal: controller.signal,
        });

        if (isMountedRef.current && currentReqId === requestIdRef.current && res.data?.success) {
          setOverviewData(res.data);
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === "CanceledError" || err.name === "AbortError") {
          return;
        }
        if (!silent && isMountedRef.current && currentReqId === requestIdRef.current) {
          setError(err.response?.data?.message || "Failed to load attendance overview.");
        }
      } finally {
        isFetchingRef.current = false;
        if (!silent && isMountedRef.current && currentReqId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [date, department]
  );

  useEffect(() => {
    isMountedRef.current = true;
    let pollInterval = null;

    const startPolling = () => {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (document.visibilityState === "visible") {
          fetchOverview(true);
        }
      }, 15000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchOverview(true);
        startPolling();
      } else {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    };

    fetchOverview(false);
    startPolling();

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      if (pollInterval) clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchOverview]);

  const departments = [
    "ALL",
    ...new Set(
      overviewData.employees
        .map((e) => e.department)
        .filter(Boolean)
    ),
  ];

  // Derived filter logic for employees
  const filteredEmployees = useMemo(() => {
    let list = overviewData.employees || [];

    // Filter by category
    switch (activeFilter) {
      case FILTER_TYPES.PRESENT:
        list = list.filter(
          (e) =>
            e.attendanceStatus === "PRESENT" ||
            e.attendanceStatus === "CHECKED_IN" ||
            e.attendanceStatus === "CHECKED_OUT"
        );
        break;
      case FILTER_TYPES.CHECKED_IN:
        list = list.filter((e) => e.attendanceStatus === "CHECKED_IN");
        break;
      case FILTER_TYPES.CHECKED_OUT:
        list = list.filter((e) => e.attendanceStatus === "CHECKED_OUT");
        break;
      case FILTER_TYPES.LIVE_TRACKING:
        list = list.filter((e) => Boolean(e.isTrackingActive));
        break;
      case FILTER_TYPES.TOTAL_STAFF:
      default:
        break;
    }

    // Filter by table search query
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      list = list.filter(
        (e) =>
          e.fullName.toLowerCase().includes(q) ||
          (e.employeeCode || "").toLowerCase().includes(q) ||
          (e.department || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [overviewData.employees, activeFilter, tableSearch]);

  useEffect(() => {
    setAttendancePage(1);
  }, [tableSearch, activeFilter, date, department]);

  const totalAttendanceEmployees = filteredEmployees.length;
  const totalAttendancePages = Math.ceil((totalAttendanceEmployees || 1) / attendancePageSize);
  const paginatedEmployees = useMemo(() => {
    const start = (attendancePage - 1) * attendancePageSize;
    return filteredEmployees.slice(start, start + attendancePageSize);
  }, [filteredEmployees, attendancePage, attendancePageSize]);

  // Derived summary metrics
  const summary = useMemo(() => {
    const raw = overviewData.summary || {};
    const list = overviewData.employees || [];
    return {
      totalEmployees: raw.totalEmployees ?? list.length,
      presentCount:
        raw.presentCount ??
        list.filter(
          (e) =>
            e.attendanceStatus === "PRESENT" ||
            e.attendanceStatus === "CHECKED_IN" ||
            e.attendanceStatus === "CHECKED_OUT"
        ).length,
      checkedInCount:
        raw.checkedInCount ??
        list.filter((e) => e.attendanceStatus === "CHECKED_IN").length,
      checkedOutCount:
        raw.checkedOutCount ??
        list.filter((e) => e.attendanceStatus === "CHECKED_OUT").length,
      notCheckedInCount:
        raw.notCheckedInCount ??
        list.filter((e) => e.attendanceStatus === "NOT_CHECKED_IN" || !e.checkInTime).length,
      liveTrackingCount:
        raw.liveTrackingCount ??
        list.filter((e) => Boolean(e.isTrackingActive)).length,
    };
  }, [overviewData.summary, overviewData.employees]);

  // Derive real attendance exceptions and active field tasks
  const exceptionsList = useMemo(() => {
    const list = overviewData.employees || [];
    const alerts = [];

    for (const emp of list) {
      if (emp.isTrackingActive) {
        alerts.push({
          id: `track-${emp.employeeId}`,
          employee: emp,
          type: "TRACKING",
          title: "Live GPS Active",
          desc: `${emp.fullName} has an active GPS field tracking session.`,
          time: "Live Now",
        });
      }
      if (emp.checkInTime) {
        const inDate = new Date(emp.checkInTime);
        const inHours = inDate.getHours() + inDate.getMinutes() / 60;
        if (inHours > 9.5) {
          alerts.push({
            id: `late-${emp.employeeId}`,
            employee: emp,
            type: "LATE",
            title: "Late Arrival",
            desc: `${emp.fullName} clocked in at ${inDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
            time: "Today",
          });
        }
      }
      if (emp.attendanceStatus === "ON_LEAVE") {
        alerts.push({
          id: `leave-${emp.employeeId}`,
          employee: emp,
          type: "LEAVE",
          title: "On Approved Leave",
          desc: `${emp.fullName} is scheduled on leave today.`,
          time: "Full Day",
        });
      }
    }

    return alerts.slice(0, 5);
  }, [overviewData.employees]);

  // Handle opening the details drawer
  const handleOpenDrawer = (emp, idx) => {
    setDrawerEmployeeId(emp.employeeId);
    setDrawerIndex(idx);
  };

  const handleSelectDrawerIndex = (newIdx) => {
    if (newIdx >= 0 && newIdx < filteredEmployees.length) {
      setDrawerIndex(newIdx);
      setDrawerEmployeeId(filteredEmployees[newIdx].employeeId);
    }
  };

  const cards = [
    {
      key: FILTER_TYPES.TOTAL_STAFF,
      label: "Total Staff",
      count: summary.totalEmployees,
      badge: "Organization",
      accent: false,
      description: "Employees in selected department/date",
    },
    {
      key: FILTER_TYPES.PRESENT,
      label: "Present Today",
      count: summary.presentCount,
      badge: `${summary.totalEmployees > 0 ? Math.round((summary.presentCount / summary.totalEmployees) * 100) : 0}%`,
      accent: true,
      description: "Checked in or completed shift",
    },
    {
      key: FILTER_TYPES.CHECKED_IN,
      label: "On Duty Now",
      count: summary.checkedInCount,
      badge: "Active",
      accent: false,
      description: "Currently checked in on shift",
    },
    {
      key: FILTER_TYPES.CHECKED_OUT,
      label: "Completed Shift",
      count: summary.checkedOutCount,
      badge: "Punched Out",
      accent: false,
      description: "Completed punch-out for the day",
    },
    {
      key: FILTER_TYPES.LIVE_TRACKING,
      label: "Live GPS Active",
      count: summary.liveTrackingCount,
      badge: "Tracking",
      isLive: true,
      accent: false,
      description: "Transmitting live GPS updates",
    },
  ];

  return (
    <div className="attendance-page-container">
      {/* Page Header */}
      <AppHeader
        title="Attendance"
      />

      {/* Date & Department Filter Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 8,
          padding: "8px 14px",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Date:</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                border: "1px solid var(--hair, #e6ede8)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12.5,
                outline: "none",
                fontWeight: 600,
                background: "#f8faf8",
                color: "var(--ink)",
                height: 32,
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Dept:</span>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{
                border: "1px solid var(--hair, #e6ede8)",
                borderRadius: 6,
                padding: "0 10px",
                fontSize: 12.5,
                outline: "none",
                fontWeight: 600,
                background: "#f8faf8",
                color: "var(--ink)",
                cursor: "pointer",
                height: 32,
              }}
            >
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept === "ALL" ? "All Departments" : dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => fetchOverview(false)}
            title="Refresh attendance records"
            style={{ height: 32, padding: "0 10px", fontSize: 12.5 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Interactive Compact Attendance Metrics Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 8,
          padding: "6px 14px",
          marginBottom: 14,
          fontSize: 12.5,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginRight: 4 }}>
          Status:
        </span>
        {cards.map((c) => {
          const isSelected = activeFilter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setActiveFilter(c.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 6,
                border: isSelected ? "1px solid var(--g-800, #155a37)" : "1px solid transparent",
                background: isSelected ? "var(--g-100, #e3f2e9)" : "#f8faf8",
                color: isSelected ? "var(--g-950, #0d3a23)" : "var(--muted, #646d67)",
                fontWeight: isSelected ? 700 : 500,
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title={`Filter by ${c.label}`}
            >
              <span>{c.label}:</span>
              <strong style={{ color: isSelected ? "var(--g-950, #0d3a23)" : "var(--ink, #131a15)" }}>
                {c.count}
              </strong>
              {c.isLive && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#16a34a",
                    display: "inline-block",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Workspace: Interactive Map (Left) + Activity Exceptions Stream (Right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16,
          marginBottom: 20,
          alignItems: "stretch",
        }}
      >
        {/* Left: Projects & Office Attendance Map */}
        <div
          style={{
            background: "var(--card, #ffffff)",
            border: "1px solid var(--hair, #e6ede8)",
            borderRadius: 10,
            padding: "16px 18px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              Employee Locations
            </h3>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--g-800, #155a37)",
                background: "var(--g-100, #e3f2e9)",
                padding: "2px 8px",
                borderRadius: 10,
              }}
            >
              {overviewData.summary?.withLocationCount || 0} Located
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 380, borderRadius: 8, overflow: "hidden", border: "1px solid var(--hair)" }}>
            <AttendanceMap
              employees={filteredEmployees}
              filterLabel={activeFilter === FILTER_TYPES.TOTAL_STAFF ? "" : FILTER_LABELS[activeFilter]}
              height={380}
            />
          </div>
        </div>

        {/* Right: Exceptions & Live Activity Log */}
        <div
          style={{
            background: "var(--card, #ffffff)",
            border: "1px solid var(--hair, #e6ede8)",
            borderRadius: 10,
            padding: "16px 18px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              Exceptions & Activity
            </h3>
            <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>
              {exceptionsList.length} items
            </span>
          </div>

          {exceptionsList.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#eefaf2", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <IconCheck size={20} />
              </div>
              <p style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>No attendance exceptions today</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>All clocked-in staff are on schedule.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: 380 }}>
              {exceptionsList.map((alert, idx) => (
                <div
                  key={alert.id}
                  onClick={() => handleOpenDrawer(alert.employee, idx)}
                  style={{
                    padding: "12px 14px",
                    background: "#fbfdfc",
                    border: "1px solid var(--hair, #e6ede8)",
                    borderRadius: 12,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(29, 115, 71, 0.3)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--hair, #e6ede8)";
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: alert.type === "TRACKING" ? "#16a34a" : alert.type === "LATE" ? "#b45309" : "#0d9488",
                        textTransform: "uppercase",
                      }}
                    >
                      {alert.title}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--faint)" }}>{alert.time}</span>
                  </div>
                  <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                    {alert.desc}
                  </p>
                  <span style={{ fontSize: 11.5, color: "var(--g-700, #1d7347)", fontWeight: 600 }}>
                    Inspect Details →
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 3: Searchable Employee Attendance Records Table */}
      <div
        style={{
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 10,
          padding: "16px 18px",
          boxShadow: "0 1px 3px rgba(19, 26, 21, 0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          {/* Table Heading and Filter Status Indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
              Employee Attendance Records ({filteredEmployees.length})
            </h3>

            {/* Clean Text-based filter links */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: 8 }}>
              {Object.keys(FILTER_TYPES).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveFilter(k)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "4px 0",
                    borderBottom: activeFilter === k ? "2.5px solid var(--g-700, #1d7347)" : "2.5px solid transparent",
                    color: activeFilter === k ? "var(--g-800, #155a37)" : "var(--muted)",
                    fontWeight: activeFilter === k ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    boxShadow: "none",
                    borderRadius: 0,
                    transition: "all 0.15s ease",
                  }}
                >
                  {FILTER_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {/* Table Search Input */}
          <div className="att-search-box" style={{ background: "#ffffff" }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or code..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              aria-label="Search employees table"
            />
          </div>
        </div>

        {/* Table Content */}
        {loading && overviewData.employees.length === 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--hair)", textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "10px 14px" }}>Employee</th>
                  <th style={{ padding: "10px 14px" }}>Status</th>
                  <th style={{ padding: "10px 14px" }}>Punch In</th>
                  <th style={{ padding: "10px 14px" }}>Punch Out</th>
                  <th style={{ padding: "10px 14px" }}>Working Hours</th>
                  <th style={{ padding: "10px 14px" }}>GPS Location</th>
                  <th style={{ padding: "10px 14px" }}>Live Tracking</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                <TableSkeletonRows rows={6} cols={8} />
              </tbody>
            </table>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--g-100, #e3f2e9)",
                color: "var(--g-800, #155a37)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}
            >
              <IconClipboardList size={22} />
            </div>
            <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 15, marginBottom: 4 }}>
              No employee records match the selected filter
            </div>
            <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 13 }}>
              Try adjusting your department, date, or search criteria.
            </p>
            {activeFilter !== FILTER_TYPES.TOTAL_STAFF && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setActiveFilter(FILTER_TYPES.TOTAL_STAFF)}
              >
                Reset Filter
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--hair, #e6ede8)", textAlign: "left", color: "var(--muted, #646d67)" }}>
                  <th style={{ padding: "12px 14px" }}>Employee</th>
                  <th style={{ padding: "12px 14px" }}>Status</th>
                  <th style={{ padding: "12px 14px" }}>Punch In</th>
                  <th style={{ padding: "12px 14px" }}>Punch Out</th>
                  <th style={{ padding: "12px 14px" }}>Working Hours</th>
                  <th style={{ padding: "12px 14px" }}>GPS Location</th>
                  <th style={{ padding: "12px 14px" }}>Live Tracking</th>
                  <th style={{ padding: "12px 14px", textAlign: "right" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEmployees.map((emp, idx) => {
                  const hasLocation = Boolean(emp.checkInLocation || emp.checkOutLocation);
                  const loc = emp.checkInLocation || emp.checkOutLocation;
                  const empInitial = (emp.fullName || "E")[0].toUpperCase();
                  const absoluteIdx = (attendancePage - 1) * attendancePageSize + idx;

                  return (
                    <tr
                      key={emp.employeeId}
                      style={{
                        borderBottom: "1px solid #f4f6f4",
                        cursor: "pointer",
                        transition: "background 0.12s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#fbfdfc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      onClick={() => handleOpenDrawer(emp, absoluteIdx)}
                    >
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              background: "linear-gradient(135deg, #1d7347, #0d3a23)",
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {empInitial}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--ink)" }}>{emp.fullName}</div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                              {emp.employeeCode} · {emp.department}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <StatusBadge status={emp.attendanceStatus} />
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--ink)", fontWeight: 500 }}>
                        {emp.checkInTime
                          ? new Date(emp.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--ink)", fontWeight: 500 }}>
                        {emp.checkOutTime
                          ? new Date(emp.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--g-800, #155a37)" }}>
                        {emp.workingHours || "—"}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {hasLocation ? (
                          <div style={{ fontSize: 12 }}>
                            <div style={{ color: "var(--g-700, #1d7347)", fontWeight: 600 }}>
                              {loc.latitude?.toFixed(4)}, {loc.longitude?.toFixed(4)}
                            </div>
                            {loc.accuracy && (
                              <div style={{ color: "var(--faint)", fontSize: 10.5 }}>
                                ±{Math.round(loc.accuracy)}m accuracy
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#a1a1aa", fontSize: 12 }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {emp.isTrackingActive ? (
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: 10,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "#dcfce7",
                              color: "#15803d",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
                            ACTIVE
                          </span>
                        ) : (
                          <span style={{ color: "#a1a1aa", fontSize: 12 }}>Inactive</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDrawer(emp, absoluteIdx);
                          }}
                          style={{ padding: "4px 10px", fontSize: 12 }}
                        >
                          View Drawer →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          currentPage={attendancePage}
          totalPages={totalAttendancePages}
          totalItems={totalAttendanceEmployees}
          pageSize={attendancePageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          onPageChange={(p) => setAttendancePage(p)}
          onPageSizeChange={(s) => {
            setAttendancePageSize(s);
            setAttendancePage(1);
          }}
          itemLabel="employees"
        />
      </div>

      {/* Part 4: HR Employee Attendance Details Drawer (Overlay) */}
      {drawerEmployeeId && (
        <EmployeeAttendanceDrawer
          employeeId={drawerEmployeeId}
          employeeList={filteredEmployees}
          currentIndex={drawerIndex}
          onSelectEmployee={handleSelectDrawerIndex}
          onClose={() => {
            setDrawerEmployeeId(null);
            setDrawerIndex(-1);
          }}
        />
      )}
    </div>
  );
}

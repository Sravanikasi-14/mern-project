import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams, useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import DateRangePicker from "../components/DateRangePicker";
import EmployeeAttendanceDrawer from "../components/EmployeeAttendanceDrawer";
import AttendanceLocationWorkspace from "../components/AttendanceLocationWorkspace";
import ModuleToolbar from "../components/ModuleToolbar";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import { IconClipboardList } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { useAttendanceOverviewQuery } from "../hooks/useAdminQueries";
import { getCompanyBusinessDate, resolveCompanyTimezone } from "../utils/dateUtils";
import "./Attendance.css";

const WORKSPACES = [
  { key: "roster", label: "Daily roster" },
  { key: "remote", label: "Remote approvals" },
  { key: "exceptions", label: "Location exceptions" },
];

const FILTER_TYPES = {
  TOTAL_STAFF: "TOTAL_STAFF",
  PRESENT: "PRESENT",
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
  LIVE_TRACKING: "LIVE_TRACKING",
};

export default function AdminAttendanceOverview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);

  const [error, setError] = useState("");
  const todayBusinessDate = getCompanyBusinessDate(new Date(), timeZone);
  const initialDate = searchParams.get("date") || todayBusinessDate;
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const isRangeMode = Boolean(startDate && endDate && startDate !== endDate);
  const [department, setDepartment] = useState("ALL");
  const [tableSearch, setTableSearch] = useState("");
  const initialFilter = searchParams.get("filter") === "PRESENT" ? FILTER_TYPES.PRESENT : FILTER_TYPES.TOTAL_STAFF;
  const [activeFilter, setActiveFilter] = useState(initialFilter);

  // Live Tracking moved to its own page. Old ?tab=tracking links redirect there.
  const requestedTab = (searchParams.get("tab") || "").toLowerCase();
  const redirectToTracking = requestedTab === "tracking";
  const workspaceParam = (searchParams.get("workspace") || "roster").toLowerCase();
  const workspace = WORKSPACES.some((w) => w.key === workspaceParam) ? workspaceParam : "roster";

  // Legacy ?tab=overview / ?tab=records bookmarks: drop the obsolete param.
  useEffect(() => {
    if (requestedTab === "overview" || requestedTab === "records") {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          nextParams.delete("tab");
          return nextParams;
        },
        { replace: true }
      );
    }
  }, [requestedTab, setSearchParams]);

  const setWorkspace = (next) => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        if (!next || next === "roster") nextParams.delete("workspace");
        else nextParams.set("workspace", next);
        return nextParams;
      },
      { replace: true }
    );
  };

  const handleRangeChange = ({ startDate: s, endDate: e }) => {
    const nextStart = s || todayBusinessDate;
    const nextEnd = e || nextStart;
    setStartDate(nextStart);
    setEndDate(nextEnd);
  };

  const [attendancePage, setAttendancePage] = useState(1);
  const [attendancePageSize, setAttendancePageSize] = useState(25);

  // Drawer State (Part 4)
  const [drawerEmployeeId, setDrawerEmployeeId] = useState(null);
  const [drawerIndex, setDrawerIndex] = useState(-1);

  const attendanceQuery = useAttendanceOverviewQuery(
    { startDate, endDate, department },
    {
      enabled: !redirectToTracking && workspace === "roster",
      // Live tracking needs refresh, but 30s fought staleTime and hammered the full roster.
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    }
  );

  const overviewData = attendanceQuery.data?.success
    ? attendanceQuery.data
    : attendanceQuery.data || {
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
      };

  const loading = attendanceQuery.isLoading && !(overviewData.employees || []).length;

  useEffect(() => {
    if (attendanceQuery.error) {
      setError(
        attendanceQuery.error.response?.data?.message || "Failed to load attendance overview."
      );
    } else if (attendanceQuery.isSuccess) {
      setError("");
    }
  }, [attendanceQuery.error, attendanceQuery.isSuccess]);

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
          (e.fullName || "").toLowerCase().includes(q) ||
          (e.employeeCode || "").toLowerCase().includes(q) ||
          (e.department || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [overviewData.employees, activeFilter, tableSearch]);

  useEffect(() => {
    setAttendancePage(1);
  }, [tableSearch, activeFilter, startDate, endDate, department]);

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

  // Multi-day mode: per-day attendance records returned by the server for the selected range.
  const rangeRecords = useMemo(
    () => (isRangeMode ? overviewData.rangeRecords || [] : []),
    [isRangeMode, overviewData.rangeRecords]
  );

  const filteredRangeRecords = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return rangeRecords;
    return rangeRecords.filter(
      (r) =>
        (r.fullName || "").toLowerCase().includes(q) ||
        (r.employeeCode || "").toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q)
    );
  }, [rangeRecords, tableSearch]);

  const totalRangePages = Math.ceil((filteredRangeRecords.length || 1) / attendancePageSize);
  const paginatedRangeRecords = useMemo(() => {
    const start = (attendancePage - 1) * attendancePageSize;
    return filteredRangeRecords.slice(start, start + attendancePageSize);
  }, [filteredRangeRecords, attendancePage, attendancePageSize]);

  // Drawer navigation in range mode walks unique employees, not individual day rows.
  const rangeEmployees = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const r of filteredRangeRecords) {
      const id = String(r.employeeId);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        fullName: r.fullName,
        department: r.department,
        jobTitle: r.jobTitle,
      });
    }
    return list;
  }, [filteredRangeRecords]);

  const drawerEmployees = isRangeMode ? rangeEmployees : filteredEmployees;

  const fmtClock = (value) =>
    value ? new Date(value).toLocaleTimeString([], { timeZone, hour: "2-digit", minute: "2-digit" }) : "—";

  const handleOpenRangeDrawer = (record) => {
    const idx = rangeEmployees.findIndex((e) => String(e.employeeId) === String(record.employeeId));
    setDrawerEmployeeId(record.employeeId);
    setDrawerIndex(Math.max(idx, 0));
  };

  // Handle opening the details drawer
  const handleOpenDrawer = (emp, idx) => {
    setDrawerEmployeeId(emp.employeeId);
    setDrawerIndex(idx);
  };

  const handleSelectDrawerIndex = (newIdx) => {
    if (newIdx >= 0 && newIdx < drawerEmployees.length) {
      setDrawerIndex(newIdx);
      setDrawerEmployeeId(drawerEmployees[newIdx].employeeId);
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

  // Per-day status chips describe a single date; in range mode only the Live GPS shortcut stays.
  const visibleCards = isRangeMode ? cards.filter((c) => c.key === FILTER_TYPES.LIVE_TRACKING) : cards;

  if (redirectToTracking) {
    const rest = new URLSearchParams(searchParams);
    rest.delete("tab");
    const qs = rest.toString();
    return <Navigate to={`/admin/live-tracking${qs ? `?${qs}` : ""}`} replace />;
  }

  return (
    <div className="attendance-page-container">
      {/* Page Header */}
      <AppHeader
        title="Attendance"
        actions={
          <SoftRefresh
            active={Boolean(attendanceQuery.isFetching && (overviewData.employees || []).length > 0)}
          />
        }
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {WORKSPACES.map((w) => (
          <button
            key={w.key}
            type="button"
            className={workspace === w.key ? "btn-primary" : "btn-secondary"}
            onClick={() => setWorkspace(w.key)}
            style={{ padding: "7px 14px", fontSize: 13 }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {workspace === "remote" ? <AttendanceLocationWorkspace mode="remote" /> : null}
      {workspace === "exceptions" ? <AttendanceLocationWorkspace mode="exceptions" /> : null}

      {workspace === "roster" ? (
        <>
      <ModuleToolbar
        searchValue={tableSearch}
        onSearchChange={(e) => setTableSearch(e.target.value)}
        searchPlaceholder="Search name, code, or department..."
        searchAriaLabel="Search employees"
        leading={
          <DateRangePicker
            label=""
            placeholder="Select dates"
            className="module-toolbar-drp"
            startDate={startDate}
            endDate={endDate}
            maxDate={todayBusinessDate}
            onChange={handleRangeChange}
          />
        }
        secondaryActions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => attendanceQuery.refetch()}
            title="Refresh attendance records"
          >
            Refresh
          </button>
        }
        filterCount={department !== "ALL" ? 1 : 0}
        onFiltersClear={() => setDepartment("ALL")}
        filters={
          <label className="module-toolbar-filter-field">
            Department
            <select
              className="filter-select"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept === "ALL" ? "All Departments" : dept}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {error && (
        <div className="error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

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
        {isRangeMode && (
          <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 6 }}>
            {startDate} to {endDate} · {rangeRecords.length} record{rangeRecords.length === 1 ? "" : "s"}
          </span>
        )}
        {visibleCards.map((c) => {
          const isLiveCard = c.key === FILTER_TYPES.LIVE_TRACKING;
          const isSelected = !isLiveCard && activeFilter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                if (isLiveCard) {
                  navigate("/admin/live-tracking");
                  return;
                }
                setActiveFilter(c.key);
              }}
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
              title={isLiveCard ? "Open Live Tracking" : `Filter by ${c.label}`}
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


      {!isRangeMode && (
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
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
            Employee Attendance Records ({filteredEmployees.length})
          </h3>
        </div>

        {/* Table Content */}
        {loading && overviewData.employees.length === 0 ? (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Punch In</th>
                  <th>Punch Out</th>
                  <th>Working Hours</th>
                  <th>GPS Location</th>
                  <th>Live Tracking</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
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
          <>
          <div className="att-mobile-list">
            {paginatedEmployees.map((emp, idx) => {
              const absoluteIdx = (attendancePage - 1) * attendancePageSize + idx;
              const inTime = emp.checkInTime
                ? new Date(emp.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—";
              return (
                <button
                  key={emp.employeeId}
                  type="button"
                  className="att-mobile-row"
                  onClick={() => handleOpenDrawer(emp, absoluteIdx)}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
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
                    {(emp.fullName || "E")[0].toUpperCase()}
                  </div>
                  <div className="att-mobile-row-body">
                    <div className="att-mobile-row-name">{emp.fullName}</div>
                    <div className="att-mobile-row-meta">
                      {emp.employeeCode} · {emp.department} · In {inTime}
                    </div>
                  </div>
                  <StatusBadge status={emp.attendanceStatus} />
                </button>
              );
            })}
          </div>
          <div className="att-desktop-table data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Punch In</th>
                  <th>Punch Out</th>
                  <th>Working Hours</th>
                  <th>GPS Location</th>
                  <th>Live Tracking</th>
                  <th style={{ textAlign: "right" }}>Details</th>
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
                          View details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
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
      )}

      {isRangeMode && (
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
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
              Attendance Records ({filteredRangeRecords.length})
            </h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {startDate} to {endDate}
            </span>
          </div>

          {loading ? (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Working Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <TableSkeletonRows rows={6} cols={6} />
                </tbody>
              </table>
            </div>
          ) : filteredRangeRecords.length === 0 ? (
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
                No attendance records in this range
              </div>
              <p style={{ margin: 0, fontSize: 13 }}>Try a different date range, department, or search.</p>
            </div>
          ) : (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Working Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRangeRecords.map((r) => (
                    <tr
                      key={String(r._id || `${r.employeeId}-${r.date}`)}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleOpenRangeDrawer(r)}
                    >
                      <td style={{ padding: "12px 14px", fontWeight: 500, color: "var(--ink)" }}>{r.date}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{r.fullName || "—"}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {r.employeeCode} · {r.department}
                        </div>
                      </td>
                      <td style={{ padding: "12px 14px" }}>{fmtClock(r.checkIn)}</td>
                      <td style={{ padding: "12px 14px" }}>{fmtClock(r.checkOut)}</td>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "var(--g-800, #155a37)" }}>
                        {r.workingHours && r.workingHours !== "--" ? r.workingHours : "—"}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <StatusBadge
                          status={r.checkIn && !r.checkOut && r.status !== "ON_LEAVE" ? "CHECKED_IN" : r.status}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            currentPage={attendancePage}
            totalPages={totalRangePages}
            totalItems={filteredRangeRecords.length}
            pageSize={attendancePageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            onPageChange={(p) => setAttendancePage(p)}
            onPageSizeChange={(s) => {
              setAttendancePageSize(s);
              setAttendancePage(1);
            }}
            itemLabel="records"
          />
        </div>
      )}
        </>
      ) : null}

      {/* Part 4: HR Employee Attendance Details Drawer (Overlay) */}
      {drawerEmployeeId && (
        <EmployeeAttendanceDrawer
          employeeId={drawerEmployeeId}
          employeeList={drawerEmployees}
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

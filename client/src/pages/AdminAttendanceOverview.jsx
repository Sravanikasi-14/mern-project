import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import AttendanceMap from "../components/AttendanceMap";
import { TableSkeletonRows } from "../components/TableSkeleton";
import { IconAlertCircle, IconCheck, IconClose, IconClipboardList } from "../components/Icons";
import api from "../services/api";

const FILTER_TYPES = {
  TOTAL_STAFF: "TOTAL_STAFF",
  PRESENT: "PRESENT",
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
  LIVE_TRACKING: "LIVE_TRACKING",
};

const FILTER_LABELS = {
  [FILTER_TYPES.TOTAL_STAFF]: "Total Staff",
  [FILTER_TYPES.PRESENT]: "Present Today",
  [FILTER_TYPES.CHECKED_IN]: "Currently Checked In",
  [FILTER_TYPES.CHECKED_OUT]: "Checked Out",
  [FILTER_TYPES.LIVE_TRACKING]: "Live Tracking Active",
};

export default function AdminAttendanceOverview() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState(() => searchParams.get("date") || new Date().toISOString().split("T")[0]);
  const [department, setDepartment] = useState("ALL");
  const initialFilter = searchParams.get("filter") === "PRESENT" ? FILTER_TYPES.PRESENT : FILTER_TYPES.TOTAL_STAFF;
  const [activeFilter, setActiveFilter] = useState(initialFilter);

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
      // Prevent overlapping concurrent polling requests
      if (silent && isFetchingRef.current) {
        return;
      }

      const currentReqId = ++requestIdRef.current;

      // Abort previous in-flight request if starting a fresh user-initiated fetch
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

        // Discard stale or superseded responses
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

  // Reliable polling lifecycle: single effect managing initial fetch, interval, visibility, and cleanup
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

    // Initial non-silent load on parameter change
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
    const list = overviewData.employees || [];
    switch (activeFilter) {
      case FILTER_TYPES.PRESENT:
        return list.filter(
          (e) =>
            e.attendanceStatus === "PRESENT" ||
            e.attendanceStatus === "CHECKED_IN" ||
            e.attendanceStatus === "CHECKED_OUT"
        );
      case FILTER_TYPES.CHECKED_IN:
        return list.filter((e) => e.attendanceStatus === "CHECKED_IN");
      case FILTER_TYPES.CHECKED_OUT:
        return list.filter((e) => e.attendanceStatus === "CHECKED_OUT");
      case FILTER_TYPES.LIVE_TRACKING:
        return list.filter((e) => Boolean(e.isTrackingActive));
      case FILTER_TYPES.TOTAL_STAFF:
      default:
        return list;
    }
  }, [overviewData.employees, activeFilter]);

  // Derived summary counts reflecting date and department queries
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
      liveTrackingCount:
        raw.liveTrackingCount ??
        list.filter((e) => Boolean(e.isTrackingActive)).length,
    };
  }, [overviewData.summary, overviewData.employees]);

  const handleCardClick = (filterKey) => {
    setActiveFilter((prev) => (prev === filterKey ? FILTER_TYPES.TOTAL_STAFF : filterKey));
    if (filterKey === FILTER_TYPES.LIVE_TRACKING) {
      fetchOverview(true);
    }
  };

  const cards = [
    {
      key: FILTER_TYPES.TOTAL_STAFF,
      label: "Total Staff",
      count: summary.totalEmployees,
      countColor: "#09090b",
      description: "All employees for selected department/date",
    },
    {
      key: FILTER_TYPES.PRESENT,
      label: "Present Today",
      count: summary.presentCount,
      countColor: "#16a34a",
      description: "Checked in or checked out today",
    },
    {
      key: FILTER_TYPES.CHECKED_IN,
      label: "Currently Checked In",
      count: summary.checkedInCount,
      countColor: "#2563eb",
      description: "Punched in with open attendance record",
    },
    {
      key: FILTER_TYPES.CHECKED_OUT,
      label: "Checked Out",
      count: summary.checkedOutCount,
      countColor: "#4b5563",
      description: "Completed punch-out for the date",
    },
    {
      key: FILTER_TYPES.LIVE_TRACKING,
      label: "Live Tracking Active",
      count: summary.liveTrackingCount,
      countColor: "#16a34a",
      isLive: true,
      description: "Active, non-expired live tracking session",
    },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <style>{`
        .overview-filter-card {
          background: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 12px;
          padding: 16px 18px;
          cursor: pointer;
          transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          outline: none;
          text-align: left;
          position: relative;
          user-select: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .overview-filter-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
          border-color: #cbd5e1;
        }
        .overview-filter-card:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
        .overview-filter-card.selected {
          background: #eff6ff !important;
          border: 2px solid #2563eb !important;
          box-shadow: 0 0 0 1px #2563eb, 0 6px 18px rgba(37, 99, 235, 0.15) !important;
        }
      `}</style>

      {/* Page Title */}
      <AppHeader title="Attendance" />

      {/* Date & Filter Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          background: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#71717a", display: "block", marginBottom: 4 }}>
              Business Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                border: "1px solid #d4d4d8",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                outline: "none",
                fontWeight: 500,
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setDate(new Date().toISOString().split("T")[0])}
            style={{
              marginTop: 20,
              background: date === new Date().toISOString().split("T")[0] ? "#18181b" : "#f4f4f5",
              color: date === new Date().toISOString().split("T")[0] ? "#ffffff" : "#27272a",
              border: "1px solid #d4d4d8",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Today
          </button>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#71717a", display: "block", marginBottom: 4 }}>
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              style={{
                border: "1px solid #d4d4d8",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                outline: "none",
                fontWeight: 500,
                background: "#ffffff",
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

        <div>
          <button
            type="button"
            onClick={() => fetchOverview()}
            disabled={loading}
            style={{
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
          }}
        >
          <IconAlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Metrics Interactive Filter Cards */}
      <div
        role="region"
        aria-label="Attendance summary filters"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {cards.map((card) => {
          const isSelected = activeFilter === card.key;
          return (
            <div
              key={card.key}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`Filter by ${card.label}: ${card.count} employees`}
              onClick={() => handleCardClick(card.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(card.key);
                }
              }}
              className={`overview-filter-card ${isSelected ? "selected" : ""}`}
              style={card.isLive && !isSelected ? { borderColor: "#bbf7d0" } : {}}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: isSelected ? "#1d4ed8" : card.isLive ? "#15803d" : "#71717a",
                    fontWeight: isSelected ? 700 : card.isLive ? 700 : 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                  }}
                >
                  {card.label}
                </span>
                {isSelected ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: "#2563eb",
                      color: "#ffffff",
                      padding: "2px 7px",
                      borderRadius: 10,
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <IconCheck size={11} style={{ strokeWidth: 3 }} /> Active
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#a1a1aa",
                      fontWeight: 500,
                    }}
                  >
                    Filter
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: isSelected ? "#1e40af" : card.countColor,
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{card.count ?? 0}</span>
                {card.isLive && card.count > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      background: "#dcfce7",
                      color: "#15803d",
                      padding: "2px 8px",
                      borderRadius: 12,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
                    Live
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Attendance Overview Map */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
              Attendance Map
            </h3>
          </div>
        </div>

        <AttendanceMap
          employees={filteredEmployees}
          filterLabel={activeFilter === FILTER_TYPES.TOTAL_STAFF ? "" : FILTER_LABELS[activeFilter]}
          height={440}
        />
      </div>

      {/* Employee Attendance Records Table */}
      <div
        className="table-wrapper-relative"
        style={{
          background: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: 14,
          padding: "20px 24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          overflow: "hidden",
        }}
      >
        {loading && <div className="table-progress-bar" />}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
              Employee Attendance Records ({loading && overviewData.employees.length === 0 ? "..." : filteredEmployees.length}
              {!loading && filteredEmployees.length !== overviewData.employees.length
                ? ` of ${overviewData.employees.length}`
                : ""}
              )
            </h3>
            {activeFilter !== FILTER_TYPES.TOTAL_STAFF && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                  padding: "3px 10px",
                  borderRadius: 14,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Filtered by: {FILTER_LABELS[activeFilter]}
                <button
                  type="button"
                  onClick={() => setActiveFilter(FILTER_TYPES.TOTAL_STAFF)}
                  aria-label="Clear filter"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#1d4ed8",
                    cursor: "pointer",
                    padding: "0 2px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconClose size={12} />
                </button>
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: "#71717a" }}>
            Date: {overviewData.date || date}
          </span>
        </div>

        {loading && overviewData.employees.length === 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                  <th style={{ padding: "10px 12px" }}>Employee</th>
                  <th style={{ padding: "10px 12px" }}>Status</th>
                  <th style={{ padding: "10px 12px" }}>Punch In</th>
                  <th style={{ padding: "10px 12px" }}>Punch Out</th>
                  <th style={{ padding: "10px 12px" }}>Working Hours</th>
                  <th style={{ padding: "10px 12px" }}>Punch Location</th>
                  <th style={{ padding: "10px 12px" }}>Live Tracking</th>
                </tr>
              </thead>
              <tbody>
                <TableSkeletonRows rows={6} cols={7} />
              </tbody>
            </table>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "#71717a", fontSize: 13 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "#eff6ff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
                border: "1px solid #dbeafe",
              }}
            >
              <IconClipboardList size={24} />
            </div>
            <div style={{ fontWeight: 600, color: "#09090b", fontSize: 14, marginBottom: 4 }}>
              No records matching "{FILTER_LABELS[activeFilter]}"
            </div>
            <p style={{ margin: "0 0 16px", color: "#71717a", fontSize: 13, maxWidth: 460, marginInline: "auto" }}>
              {activeFilter === FILTER_TYPES.LIVE_TRACKING
                ? "No staff members currently have an active live tracking session."
                : activeFilter === FILTER_TYPES.CHECKED_IN
                ? "No employees are currently checked in with an open punch-in record for this date."
                : activeFilter === FILTER_TYPES.CHECKED_OUT
                ? "No employees have completed punch-out for this date."
                : activeFilter === FILTER_TYPES.PRESENT
                ? "No employees are marked present for this date."
                : "No employee records found for this department/date."}
            </p>
            {activeFilter !== FILTER_TYPES.TOTAL_STAFF && (
              <button
                type="button"
                onClick={() => setActiveFilter(FILTER_TYPES.TOTAL_STAFF)}
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset Filter to Total Staff
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                  <th style={{ padding: "10px 12px" }}>Employee</th>
                  <th style={{ padding: "10px 12px" }}>Status</th>
                  <th style={{ padding: "10px 12px" }}>Punch In</th>
                  <th style={{ padding: "10px 12px" }}>Punch Out</th>
                  <th style={{ padding: "10px 12px" }}>Working Hours</th>
                  <th style={{ padding: "10px 12px" }}>Punch Location</th>
                  <th style={{ padding: "10px 12px" }}>Live Tracking</th>
                </tr>
              </thead>
              <tbody className={loading ? "table-refreshing-dim" : ""}>
                {filteredEmployees.map((emp) => {
                  const hasLocation = Boolean(emp.checkInLocation || emp.checkOutLocation);
                  const loc = emp.checkInLocation || emp.checkOutLocation;
                  return (
                    <tr key={emp.employeeId} style={{ borderBottom: "1px solid #f4f4f5" }}>
                      <td style={{ padding: "12px" }}>
                        <div style={{ fontWeight: 600, color: "#09090b" }}>{emp.fullName}</div>
                        <div style={{ fontSize: 12, color: "#71717a" }}>
                          {emp.employeeCode} • {emp.department}
                        </div>
                      </td>
                      <td style={{ padding: "12px" }}>
                        <StatusBadge status={emp.attendanceStatus} />
                      </td>
                      <td style={{ padding: "12px", color: "#52525b" }}>
                        {emp.checkInTime
                          ? new Date(emp.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "--:--"}
                      </td>
                      <td style={{ padding: "12px", color: "#52525b" }}>
                        {emp.checkOutTime
                          ? new Date(emp.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : "--:--"}
                      </td>
                      <td style={{ padding: "12px", fontWeight: 500 }}>
                        {emp.workingHours || "--"}
                      </td>
                      <td style={{ padding: "12px" }}>
                        {hasLocation ? (
                          <div style={{ fontSize: 12 }}>
                            <div style={{ color: "#2563eb", fontWeight: 600 }}>
                              {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                            </div>
                            {loc.accuracy && (
                              <div style={{ color: "#71717a", fontSize: 11 }}>
                                ±{Math.round(loc.accuracy)}m accuracy
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#a1a1aa", fontSize: 12 }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: "12px" }}>
                        {emp.isTrackingActive ? (
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: "#dcfce7",
                              color: "#15803d",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }}></span>
                            ACTIVE
                          </span>
                        ) : (
                          <span style={{ color: "#a1a1aa", fontSize: 12 }}>Inactive</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

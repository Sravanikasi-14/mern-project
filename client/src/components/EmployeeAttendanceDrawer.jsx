import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AttendanceTimeline from "./AttendanceTimeline";
import api from "../services/api";
import { IconClose } from "./Icons";
import { getCompanyBusinessDate } from "../utils/dateUtils";

export default function EmployeeAttendanceDrawer({
  employeeId,
  employeeList = [],
  currentIndex = 0,
  onSelectEmployee,
  onClose,
}) {
  const navigate = useNavigate();

  // Selected Month State (defaults to current month)
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Load employee history for the current selected month
  const fetchEmployeeData = useCallback(async () => {
    if (!employeeId) return;

    try {
      setLoading(true);
      setError("");

      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth(); // 0-indexed
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // Try dedicated admin endpoint first
      try {
        const res = await api.get(`/admin/attendance/employee/${employeeId}`, {
          params: { startDate, endDate, limit: 100 },
        });

        if (res.data?.success) {
          setEmployeeInfo(res.data.employee);
          setHistoryRecords(res.data.records || []);
          setLoading(false);
          return;
        }
      } catch (adminErr) {
        // Fallback to /api/employees/:id
      }

      const empRes = await api.get(`/employees/${employeeId}`);
      if (empRes.data) {
        const emp = empRes.data;
        setEmployeeInfo({
          _id: emp._id,
          employeeCode: emp.employeeCode,
          fullName: emp.fullName,
          email: emp.email,
          phone: emp.personalPhone || emp.phone || "",
          avatar: emp.avatar || "",
          department: emp.job?.department || "General",
          jobTitle: emp.job?.jobTitle || "Team Member",
        });

        // Parse customFields.attendanceLogs
        const logs = emp.customFields?.attendanceLogs || [];
        const monthLogs = logs.filter((l) => l.date >= startDate && l.date <= endDate);
        setHistoryRecords(
          monthLogs.map((l) => ({
            _id: l.date,
            date: l.date,
            status: l.status || "PRESENT",
            checkIn: l.checkIn,
            checkOut: l.checkOut,
            workingHours: l.workingHours || "--",
            checkInLocation: l.checkInLocation || null,
            checkOutLocation: l.checkOutLocation || null,
          }))
        );
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load employee attendance history.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, selectedDate]);

  useEffect(() => {
    fetchEmployeeData();
  }, [fetchEmployeeData]);

  // Navigate months
  const handlePrevMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const monthYearLabel = useMemo(() => {
    return selectedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [selectedDate]);

  // Derive all calendar days of the selected month
  const monthDaysList = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = getCompanyBusinessDate();

    const recordsMap = new Map();
    for (const r of historyRecords) {
      recordsMap.set(r.date, r);
    }

    const list = [];
    // Start from today down to 1st, or from end of month down to 1st
    for (let day = totalDays; day >= 1; day--) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dateStr > todayStr) {
        // Skip future dates
        continue;
      }
      const existing = recordsMap.get(dateStr);
      if (existing) {
        list.push(existing);
      } else {
        const dObj = new Date(year, month, day);
        const dayOfWeek = dObj.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        list.push({
          _id: dateStr,
          date: dateStr,
          status: isWeekend ? "WEEKEND" : "NOT_CHECKED_IN",
          checkIn: null,
          checkOut: null,
          workingHours: "—",
          notes: isWeekend ? "Weekend" : "No Punch",
        });
      }
    }

    return list;
  }, [selectedDate, historyRecords]);

  // Filtered days list
  const filteredDays = useMemo(() => {
    return monthDaysList.filter((item) => {
      // Status filter
      if (statusFilter !== "ALL") {
        if (statusFilter === "PRESENT" && !(item.status === "PRESENT" || item.status === "CHECKED_IN" || item.status === "CHECKED_OUT")) {
          return false;
        }
        if (statusFilter === "LATE") {
          if (!item.checkIn) return false;
          const h = new Date(item.checkIn).getHours() + new Date(item.checkIn).getMinutes() / 60;
          if (h <= 9.5) return false;
        }
        if (statusFilter === "ON_LEAVE" && item.status !== "ON_LEAVE") {
          return false;
        }
        if (statusFilter === "ABSENT" && item.status !== "NOT_CHECKED_IN") {
          return false;
        }
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesDate = item.date.toLowerCase().includes(q);
        const matchesStatus = (item.status || "").toLowerCase().includes(q);
        const matchesNotes = (item.notes || "").toLowerCase().includes(q);
        if (!matchesDate && !matchesStatus && !matchesNotes) return false;
      }

      return true;
    });
  }, [monthDaysList, statusFilter, searchQuery]);

  // Calculate Employee-Specific Summary Metrics for the period
  const metrics = useMemo(() => {
    let daysPresent = 0;
    let lateClockIns = 0;
    let earlyDepartures = 0;
    let noClockOuts = 0;
    let overtimeHours = 0;
    let absentDays = 0;

    const todayStr = getCompanyBusinessDate();

    for (const rec of monthDaysList) {
      if (rec.status === "PRESENT" || rec.status === "CHECKED_IN" || rec.status === "CHECKED_OUT") {
        daysPresent++;

        if (rec.checkIn) {
          const inDate = new Date(rec.checkIn);
          const inHours = inDate.getHours() + inDate.getMinutes() / 60;
          if (inHours > 9.5) {
            lateClockIns++;
          }
        }

        if (rec.checkIn && !rec.checkOut && rec.date !== todayStr) {
          noClockOuts++;
        }

        if (rec.checkIn && rec.checkOut) {
          const inDate = new Date(rec.checkIn);
          const outDate = new Date(rec.checkOut);
          const workedHours = (outDate - inDate) / (1000 * 3600);
          if (workedHours > 8) {
            overtimeHours += Math.round(workedHours - 8);
          }
          if (workedHours < 7.5) {
            earlyDepartures++;
          }
        }
      } else if (rec.status === "ON_LEAVE") {
        absentDays++;
      } else if (rec.status === "NOT_CHECKED_IN") {
        absentDays++;
      }
    }

    return {
      daysPresent,
      lateClockIns,
      earlyDepartures,
      noClockOuts,
      overtimeHours,
      absentDays,
    };
  }, [monthDaysList]);

  const userInitial = (employeeInfo?.fullName || "E")[0].toUpperCase();
  const totalEmployees = employeeList.length;

  return (
    <div className="att-drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="att-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Top bar with Pager (< 1 out of 56 >) & Close button */}
        <div className="att-drawer-topbar">
          <div className="att-drawer-pager">
            <button
              type="button"
              className="att-drawer-pager-btn"
              onClick={() => onSelectEmployee(currentIndex - 1)}
              disabled={currentIndex <= 0}
              aria-label="Previous employee"
              title="Previous employee"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span>
              {totalEmployees > 0 ? `${currentIndex + 1} out of ${totalEmployees}` : "1 of 1"}
            </span>
            <button
              type="button"
              className="att-drawer-pager-btn"
              onClick={() => onSelectEmployee(currentIndex + 1)}
              disabled={currentIndex >= totalEmployees - 1}
              aria-label="Next employee"
              title="Next employee"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="att-drawer-close-btn"
            onClick={onClose}
            aria-label="Close drawer"
            title="Close drawer (Esc)"
          >
            <IconClose size={16} />
          </button>
        </div>

        {/* Employee Profile Header Banner */}
        <div className="att-drawer-emp-banner">
          <div className="att-drawer-emp-profile">
            <div className="att-drawer-emp-avatar" aria-hidden="true">
              {userInitial}
            </div>
            <div className="att-drawer-emp-info">
              <h3>{employeeInfo?.fullName || "Loading..."}</h3>
              <div className="att-drawer-emp-meta">
                <span>{employeeInfo?.jobTitle || "Team Member"}</span>
                <span className="att-drawer-emp-tag">{employeeInfo?.employeeCode || "#EMP"}</span>
                <span>{employeeInfo?.department}</span>
                {employeeInfo?.phone && (
                  <span style={{ color: "#0d9488", fontWeight: 600 }}>{employeeInfo.phone}</span>
                )}
              </div>
            </div>
          </div>

          <div className="att-drawer-actions">
            <button
              type="button"
              className="att-drawer-action-btn"
              onClick={() => navigate(`/admin/employees/${employeeId}`)}
            >
              View Profile
            </button>
          </div>
        </div>

        {/* Scrollable Drawer Content */}
        <div className="att-drawer-content">
          {/* Employee-Specific Summary Metrics Row */}
          <div className="att-drawer-metrics">
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">Days Present</div>
              <div className="att-drawer-metric-val">{metrics.daysPresent}</div>
              <div className="att-drawer-metric-sub">In {monthYearLabel}</div>
            </div>
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">Late Clock-In</div>
              <div className="att-drawer-metric-val" style={{ color: metrics.lateClockIns > 0 ? "#b45309" : "inherit" }}>
                {metrics.lateClockIns}
              </div>
              <div className="att-drawer-metric-sub">After 09:30 AM</div>
            </div>
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">Early Dep.</div>
              <div className="att-drawer-metric-val">{metrics.earlyDepartures}</div>
              <div className="att-drawer-metric-sub">Under 7.5 hrs</div>
            </div>
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">No Clock-Out</div>
              <div className="att-drawer-metric-val" style={{ color: metrics.noClockOuts > 0 ? "#dc2626" : "inherit" }}>
                {metrics.noClockOuts}
              </div>
              <div className="att-drawer-metric-sub">Missing punches</div>
            </div>
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">Overtime</div>
              <div className="att-drawer-metric-val" style={{ color: "#d97706" }}>
                {metrics.overtimeHours}h
              </div>
              <div className="att-drawer-metric-sub">Beyond 8 hrs</div>
            </div>
            <div className="att-drawer-metric-item">
              <div className="att-drawer-metric-label">Absent / Off</div>
              <div className="att-drawer-metric-val">{metrics.absentDays}</div>
              <div className="att-drawer-metric-sub">Leaves or off</div>
            </div>
          </div>

          {/* Month Navigation & Search Toolbar */}
          <div className="att-toolbar" style={{ marginBottom: 16 }}>
            <div className="att-month-selector">
              <button
                type="button"
                className="att-month-nav-btn"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                title="Previous month"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="att-month-title">{monthYearLabel}</span>
              <button
                type="button"
                className="att-month-nav-btn"
                onClick={handleNextMonth}
                aria-label="Next month"
                title="Next month"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            <div className="att-controls-right">
              <div className="att-search-box">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m16.5 16.5 4 4" />
                </svg>
                <input
                  type="text"
                  placeholder="Search date..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search day"
                />
              </div>

              <select
                className="att-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter status"
              >
                <option value="ALL">All Status</option>
                <option value="PRESENT">Present Only</option>
                <option value="LATE">Late Arrivals</option>
                <option value="ON_LEAVE">Leaves / Off</option>
                <option value="ABSENT">Absent / No Record</option>
              </select>
            </div>
          </div>

          {/* Daily Attendance Timeline List */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--muted)" }}>
              <div className="spinner" style={{ margin: "0 auto 12px" }} />
              <p style={{ margin: 0, fontSize: 13.5 }}>Loading attendance history...</p>
            </div>
          ) : error ? (
            <div className="error" style={{ padding: "16px", textAlign: "center", borderRadius: 10 }}>
              {error}
            </div>
          ) : filteredDays.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 16px", background: "#ffffff", borderRadius: 12, border: "1px solid var(--hair)", color: "var(--muted)" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>No attendance records found matching filters for {monthYearLabel}.</p>
            </div>
          ) : (
            <div className="att-timeline-list">
              {filteredDays.map((rec) => (
                <AttendanceTimeline
                  key={rec._id || rec.date}
                  date={rec.date}
                  checkIn={rec.checkIn}
                  checkOut={rec.checkOut}
                  workingHours={rec.workingHours}
                  durationMinutes={rec.durationMinutes}
                  status={rec.status}
                  notes={rec.notes}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

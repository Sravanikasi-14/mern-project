import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import AttendanceTimeline from "../components/AttendanceTimeline";
import AttendanceSummaryMetrics from "../components/AttendanceSummaryMetrics";
import Pagination from "../components/Pagination";
import {
  IconClose,
  IconCheck,
  IconAlertCircle,
  IconClock,
} from "../components/Icons";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { acquireCurrentLocation, watchLiveLocation } from "../utils/geolocation";
import { civilDaysInMonth, formatCivilDate, getCompanyBusinessDate, resolveCompanyTimezone } from "../utils/dateUtils";
import "./Attendance.css";

export default function EmployeeAttendance() {
  const { user, company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const [dashboardData, setDashboardData] = useState(null);
  const [checkingAttendance, setCheckingAttendance] = useState(false);

  // Geolocation & Attendance Capture State
  const [geoStatus, setGeoStatus] = useState("IDLE"); // IDLE | ACQUIRING | SUCCESS | ERROR
  const [geoError, setGeoError] = useState("");
  const [lastCapturedLocation, setLastCapturedLocation] = useState(null);

  // Live Employee Tracking State
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [trackingSession, setTrackingSession] = useState(null);
  const [trackingError, setTrackingError] = useState("");
  const unwatchRef = useRef(null);

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [attPage, setAttPage] = useState(1);
  const [attPageSize, setAttPageSize] = useState(10);

  // Attendance History State
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);

  const fetchAttendanceData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const res = await api.get("/employees/me/dashboard");
      setDashboardData(res.data);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.message || "Failed to load attendance information.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchAttendanceHistory = useCallback(async (targetDate = selectedDate) => {
    try {
      setHistoryLoading(true);

      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const startDate = formatCivilDate(year, month, 1);
      const endDate = formatCivilDate(year, month, civilDaysInMonth(year, month));

      const res = await api.get("/employees/me/attendance/history", {
        params: { startDate, endDate, limit: 100 },
      });

      if (res.data?.success) {
        setHistoryRecords(res.data.records || []);
      }
    } catch {
      // ignore history load error
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchAttendanceData();
    fetchAttendanceHistory(selectedDate);

    // Check live tracking status
    api
      .get("/employees/me/tracking/status")
      .then((res) => {
        if (res.data?.isTrackingActive && res.data?.session) {
          setIsLiveTracking(true);
          setTrackingSession(res.data.session);
        }
      })
      .catch(() => {});

    return () => {
      if (unwatchRef.current) {
        unwatchRef.current();
      }
    };
  }, [fetchAttendanceHistory, selectedDate]);

  const handlePrevMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setSelectedDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const monthYearLabel = useMemo(() => {
    return selectedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [selectedDate]);

  const handleCheckIn = async () => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      setGeoError("");
      setGeoStatus("ACQUIRING");

      let loc = null;
      try {
        loc = await acquireCurrentLocation({ enableHighAccuracy: true, timeout: 15000 });
        setLastCapturedLocation(loc);
        setGeoStatus("SUCCESS");
      } catch (err) {
        setGeoStatus("ERROR");
        const msg = `${err.message} ${err.action || "Please enable location in browser settings to punch in."}`;
        setGeoError(msg);
        setActionError(msg);
        return;
      }

      const response = await api.post("/employees/me/attendance/punch-in", { location: loc });
      setActionSuccess(response.data?.message || "Punched in successfully!");
      await fetchAttendanceData(true);
      await fetchAttendanceHistory(selectedDate);
    } catch (err) {
      setActionError(err.response?.data?.message || "Unable to punch in. Please try again.");
    } finally {
      setCheckingAttendance(false);
    }
  };

  const handleCheckOut = async () => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      setGeoError("");
      setGeoStatus("ACQUIRING");

      let loc = null;
      try {
        loc = await acquireCurrentLocation({ enableHighAccuracy: true, timeout: 15000 });
        setLastCapturedLocation(loc);
        setGeoStatus("SUCCESS");
      } catch (err) {
        setGeoStatus("ERROR");
        const msg = `${err.message} ${err.action || "Please enable location in browser settings to punch out."}`;
        setGeoError(msg);
        setActionError(msg);
        return;
      }

      const response = await api.post("/employees/me/attendance/punch-out", { location: loc });
      setActionSuccess(response.data?.message || "Punched out successfully!");
      await fetchAttendanceData(true);
      await fetchAttendanceHistory(selectedDate);
    } catch (err) {
      setActionError(err.response?.data?.message || "Unable to punch out. Please try again.");
    } finally {
      setCheckingAttendance(false);
    }
  };

  const handleStartTracking = async () => {
    try {
      setTrackingError("");
      const res = await api.post("/employees/me/tracking/start", { durationMinutes: 30 });
      if (res.data?.success) {
        setIsLiveTracking(true);
        setTrackingSession(res.data.session);

        if (unwatchRef.current) {
          unwatchRef.current();
        }

        unwatchRef.current = watchLiveLocation(
          async (newLoc) => {
            try {
              await api.post("/employees/me/tracking/update", { location: newLoc });
              setTrackingSession((prev) => (prev ? { ...prev, lastLocation: newLoc } : null));
            } catch (err) {
              if (err.response?.status === 400 && err.response?.data?.message?.includes("expired")) {
                handleStopTracking(true);
              }
            }
          },
          (err) => {
            setTrackingError(err.message);
          }
        );
      }
    } catch (err) {
      setTrackingError(err.response?.data?.message || "Failed to start live tracking session.");
    }
  };

  const handleStopTracking = async (silent = false) => {
    try {
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
      setIsLiveTracking(false);
      setTrackingSession(null);
      if (!silent) {
        await api.post("/employees/me/tracking/stop");
      }
    } catch {
      // ignore stop error
    }
  };

  // Derive days list for the month view
  const monthDaysList = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = getCompanyBusinessDate(new Date(), timeZone);

    const recordsMap = new Map();
    for (const r of historyRecords) {
      recordsMap.set(r.date, r);
    }

    const list = [];
    for (let day = totalDays; day >= 1; day--) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dateStr > todayStr) {
        continue;
      }

      const existing = recordsMap.get(dateStr);
      if (existing) {
        list.push(existing);
      } else {
        const dayOfWeek = new Date(Date.UTC(year, month, day)).getUTCDay();
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
  }, [selectedDate, historyRecords, timeZone]);

  // Filtered list
  const filteredDays = useMemo(() => {
    return monthDaysList.filter((item) => {
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

  useEffect(() => {
    setAttPage(1);
  }, [selectedDate, statusFilter, searchQuery]);

  const totalDaysCount = filteredDays.length;
  const totalDaysPages = Math.ceil((totalDaysCount || 1) / attPageSize);
  const paginatedDays = useMemo(() => {
    const start = (attPage - 1) * attPageSize;
    return filteredDays.slice(start, start + attPageSize);
  }, [filteredDays, attPage, attPageSize]);

  // Calculate summary metrics for the selected month
  const metrics = useMemo(() => {
    let daysPresent = 0;
    let lateClockIns = 0;
    let earlyDepartures = 0;
    let noClockOuts = 0;
    let overtimeHours = 0;
    let absentDays = 0;

    const todayStr = getCompanyBusinessDate(new Date(), timeZone);

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
      } else if (rec.status === "ON_LEAVE" || rec.status === "NOT_CHECKED_IN") {
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

  const attendance = dashboardData?.attendance;
  const todayStatus = attendance?.today?.status || "NOT_CHECKED_IN";
  const checkInTimeFormatted = attendance?.today?.checkInTime
    ? new Date(attendance.today.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const checkOutTimeFormatted = attendance?.today?.checkOutTime
    ? new Date(attendance.today.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const userInitial = (user?.name || user?.email || "E")[0].toUpperCase();
  const displayName = user?.name || user?.email?.split("@")[0] || "Employee";

  return (
    <div className="attendance-page-container">
      {/* App Header */}
      <AppHeader
        title="Attendance"
      />

      {/* Action feedback banners */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Section 1: Signed-in Employee Punch & Action Card */}
      <div
        style={{
          background: "var(--card, #ffffff)",
          border: "1px solid var(--hair, #e6ede8)",
          borderRadius: 10,
          padding: "16px 18px",
          boxShadow: "var(--shadow-sm)",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
          {/* Shift Status Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Shift Status:
            </span>
            <StatusBadge
              status={todayStatus}
              label={todayStatus === "CHECKED_IN" ? "Checked In" : todayStatus === "CHECKED_OUT" ? "Checked Out" : "Not Checked In"}
            />
            {checkInTimeFormatted && (
              <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>
                In: <strong style={{ color: "var(--ink)" }}>{checkInTimeFormatted}</strong>
                {checkOutTimeFormatted && <> · Out: <strong style={{ color: "var(--ink)" }}>{checkOutTimeFormatted}</strong></>}
              </span>
            )}
          </div>

          {/* Punch In / Out Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {todayStatus === "NOT_CHECKED_IN" && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleCheckIn}
                disabled={checkingAttendance}
                style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600 }}
              >
                {checkingAttendance ? "Acquiring GPS..." : "Punch In (With GPS)"}
              </button>
            )}

            {todayStatus === "CHECKED_IN" && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleCheckOut}
                disabled={checkingAttendance}
                style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600, background: "#dc2626", borderColor: "#dc2626" }}
              >
                {checkingAttendance ? "Acquiring GPS..." : "Punch Out for Day"}
              </button>
            )}

            {todayStatus === "CHECKED_OUT" && (
              <div style={{ fontSize: 13, color: "#15803d", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, background: "#eefaf2", padding: "8px 14px", borderRadius: 10 }}>
                <IconCheck size={16} />
                <span>Punched out for today. See logs below.</span>
              </div>
            )}

            {/* Live Tracking toggle button */}
            {isLiveTracking ? (
              <button
                type="button"
                onClick={() => handleStopTracking(false)}
                className="btn-secondary btn-sm"
                style={{ color: "#dc2626", borderColor: "#fecaca" }}
              >
                Stop Location Sharing
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartTracking}
                className="btn-secondary btn-sm"
              >
                Share Location (30 min)
              </button>
            )}
          </div>
        </div>

        {/* Geolocation feedback bar */}
        {geoStatus === "ACQUIRING" && (
          <div style={{ padding: "8px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12.5, color: "#1d4ed8", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <IconClock size={15} />
            <span>Verifying location...</span>
          </div>
        )}

        {geoError && (
          <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12.5, color: "#991b1b", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconAlertCircle size={16} />
              <span>{geoError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setGeoError("");
                setGeoStatus("IDLE");
                todayStatus === "NOT_CHECKED_IN" ? handleCheckIn() : handleCheckOut();
              }}
              style={{ background: "#991b1b", color: "#ffffff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
            >
              Retry
            </button>
          </div>
        )}

        {lastCapturedLocation && (
          <div style={{ padding: "6px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 12, color: "#15803d", display: "flex", alignItems: "center", gap: 6 }}>
            <IconCheck size={14} />
            <span>
              Location verified: {lastCapturedLocation.latitude?.toFixed(4)}, {lastCapturedLocation.longitude?.toFixed(4)}
            </span>
          </div>
        )}

        {/* Today's quick punch times summary */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            padding: "12px 16px",
            background: "#f8faf8",
            borderRadius: 12,
            marginTop: 12,
            border: "1px solid #eef2ef",
          }}
        >
          <div>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Clock-In Today</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginTop: 2 }}>
              {checkInTimeFormatted || "—"}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Clock-Out Today</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginTop: 2 }}>
              {checkOutTimeFormatted || "—"}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Hours Today</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginTop: 2 }}>
              {attendance?.today?.workingHours || "—"}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>Monthly Rate</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--g-800, #155a37)", marginTop: 2 }}>
              {attendance?.summary?.daysPresent || 0} / {attendance?.summary?.totalWorkingDays || 22} Days
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Compact Summary Metrics Row (Reference Image 2) */}
      <AttendanceSummaryMetrics
        metrics={metrics}
        periodLabel={monthYearLabel}
        showAccentFirst={true}
      />

      {/* Section 3: Month Selector & Search Toolbar */}
      <div className="att-toolbar">
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
            <option value="LATE">Late Clock-In</option>
            <option value="ON_LEAVE">Leaves / Off</option>
            <option value="ABSENT">Absent / No Punch</option>
          </select>
        </div>
      </div>

      {/* Section 4: Daily Attendance Timeline List */}
      {historyLoading && historyRecords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--muted)" }}>
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p style={{ margin: 0, fontSize: 14 }}>Loading attendance timeline...</p>
        </div>
      ) : filteredDays.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", background: "#ffffff", borderRadius: 16, border: "1px solid var(--hair)", color: "var(--muted)" }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>No attendance records found matching filters for {monthYearLabel}.</p>
        </div>
      ) : (
        <>
          <div className="att-timeline-list">
            {paginatedDays.map((rec) => (
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

          <Pagination
            currentPage={attPage}
            totalPages={totalDaysPages}
            totalItems={totalDaysCount}
            pageSize={attPageSize}
            pageSizeOptions={[10, 20, 31]}
            onPageChange={(p) => setAttPage(p)}
            onPageSizeChange={(s) => {
              setAttPageSize(s);
              setAttPage(1);
            }}
            itemLabel="days"
            className="mt-3"
          />
        </>
      )}
    </div>
  );
}

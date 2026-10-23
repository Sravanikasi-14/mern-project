import { useEffect, useState, useMemo, useRef } from "react";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import {
  IconClose,
  IconCheck,
  IconAlertCircle,
  IconClock,
  IconRefresh,
} from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";
import { acquireCurrentLocation, watchLiveLocation } from "../utils/geolocation";

export default function EmployeeAttendance() {
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

  // Attendance History State
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");

  const todayFormattedDate = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, []);

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

  const fetchAttendanceHistory = async (start = historyStartDate, end = historyEndDate) => {
    try {
      setHistoryLoading(true);
      const params = { limit: 50 };
      if (start) params.startDate = start;
      if (end) params.endDate = end;

      const res = await api.get("/employees/me/attendance/history", { params });
      if (res.data?.success) {
        setHistoryRecords(res.data.records || []);
      }
    } catch {
      // ignore history load error
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendanceData();
    fetchAttendanceHistory();

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
  }, []);

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
      await fetchAttendanceHistory();
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
      await fetchAttendanceHistory();
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

  const attendance = dashboardData?.attendance;
  const todayStatus = attendance?.today?.status || "NOT_CHECKED_IN";
  const checkInTimeFormatted = attendance?.today?.checkInTime
    ? new Date(attendance.today.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const checkOutTimeFormatted = attendance?.today?.checkOutTime
    ? new Date(attendance.today.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="Attendance" />

      {/* Action alerts */}
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

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }} />
          <p style={{ color: "#71717a", fontSize: 15 }}>Loading attendance details...</p>
        </div>
      ) : error ? (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={() => fetchAttendanceData()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* TODAY'S ATTENDANCE CARD */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "24px 28px",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Attendance Today
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                  {todayFormattedDate}
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusBadge
                  status={todayStatus}
                  label={todayStatus === "CHECKED_IN" ? "Checked In" : todayStatus === "CHECKED_OUT" ? "Checked Out" : "Not Checked In"}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
                padding: "16px 20px",
                background: "#f9fafb",
                borderRadius: 10,
                marginBottom: 18,
                border: "1px solid #f3f4f6",
              }}
            >
              <div>
                <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Check-In Time</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                  {checkInTimeFormatted || "—"}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Check-Out Time</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                  {checkOutTimeFormatted || "—"}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Hours Today</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                  {attendance?.today?.workingHours || "—"}
                </div>
              </div>
              <div>
                <span style={{ fontSize: 12, color: "#71717a", textTransform: "uppercase", fontWeight: 600 }}>Monthly Attendance</span>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#09090b", marginTop: 4 }}>
                  {attendance?.summary?.daysPresent || 0} / {attendance?.summary?.totalWorkingDays || 22} Days ({attendance?.summary?.attendanceRate || 0}%)
                </div>
              </div>
            </div>

            {/* Geolocation Feedback & Error Banner */}
            {geoStatus === "ACQUIRING" && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 13, color: "#1d4ed8", display: "flex", alignItems: "center", gap: 8 }}>
                <IconClock size={16} />
                <span>Acquiring high-accuracy browser location... Please grant permission if prompted.</span>
              </div>
            )}

            {geoError && (
              <div style={{ marginBottom: 16, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 4 }}>
                  <IconAlertCircle size={16} />
                  <span>Location Permission Required</span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 12.5, lineHeight: 1.4 }}>
                  {geoError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGeoError("");
                    setGeoStatus("IDLE");
                    todayStatus === "NOT_CHECKED_IN" ? handleCheckIn() : handleCheckOut();
                  }}
                  style={{ background: "#991b1b", color: "#ffffff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Retry Location Capture
                </button>
              </div>
            )}

            {lastCapturedLocation && (
              <div style={{ marginBottom: 16, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 12, color: "#15803d", display: "flex", alignItems: "center", gap: 8 }}>
                <IconCheck size={14} />
                <span>
                  Verified Location: {lastCapturedLocation.latitude.toFixed(4)}, {lastCapturedLocation.longitude.toFixed(4)}
                  {lastCapturedLocation.accuracy ? ` (±${Math.round(lastCapturedLocation.accuracy)}m)` : ""}
                </span>
              </div>
            )}

            {/* Punch Action Buttons */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {todayStatus === "NOT_CHECKED_IN" && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleCheckIn}
                  disabled={checkingAttendance}
                  style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600 }}
                >
                  {checkingAttendance ? "Verifying Location..." : "Punch In (With Geolocation)"}
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
                  {checkingAttendance ? "Verifying Location..." : "Punch Out for Day"}
                </button>
              )}

              {todayStatus === "CHECKED_OUT" && (
                <div style={{ fontSize: 13.5, color: "#15803d", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <IconCheck size={16} />
                  <span>You have completed work and punched out for today.</span>
                </div>
              )}
            </div>
          </div>

          {/* LIVE EMPLOYEE LOCATION TRACKING CARD */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "22px 28px",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                    Live Work Location Tracking
                  </h3>
                  {isLiveTracking ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "#dcfce7", color: "#15803d", fontSize: 11, fontWeight: 700 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }}></span>
                      TRACKING ACTIVE
                    </span>
                  ) : (
                    <span style={{ padding: "2px 8px", borderRadius: 12, background: "#f4f4f5", color: "#71717a", fontSize: 11, fontWeight: 600 }}>
                      STOPPED
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a", maxWidth: 680 }}>
                  Authorized live tracking transmits periodic location updates to HR during field assignments or active hours. Sessions are time-bounded (30 min) and can be ended at any time.
                </p>
              </div>

              <div>
                {isLiveTracking ? (
                  <button
                    type="button"
                    onClick={() => handleStopTracking(false)}
                    className="btn-secondary"
                    style={{ color: "#dc2626", borderColor: "#fecaca" }}
                  >
                    Stop Tracking
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartTracking}
                    className="btn-secondary"
                  >
                    Start 30-Min Session
                  </button>
                )}
              </div>
            </div>

            {trackingError && (
              <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 12.5, marginBottom: 10 }}>
                {trackingError}
              </div>
            )}

            {isLiveTracking && trackingSession?.lastLocation && (
              <div style={{ fontSize: 12.5, color: "#15803d", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6 }}>
                Active Session: Lat {trackingSession.lastLocation.latitude?.toFixed(4)}, Lon {trackingSession.lastLocation.longitude?.toFixed(4)}
              </div>
            )}
          </div>

          {/* ATTENDANCE HISTORY TABLE CARD */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "24px 28px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 14 }}>
              <div>
                <h3 style={{ margin: "0 0 2px", fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                  Attendance Punch History
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                  Verified daily punch records with working hours and status.
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 12.5 }}
                />
                <span style={{ fontSize: 12, color: "#71717a" }}>to</span>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 12.5 }}
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => fetchAttendanceHistory(historyStartDate, historyEndDate)}
                >
                  <IconRefresh size={13} />
                  <span>Filter</span>
                </button>
              </div>
            </div>

            <div className="table-wrapper-relative" style={{ overflowX: "auto" }}>
              {historyLoading && historyRecords.length > 0 && <div className="table-progress-bar" />}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                    <th style={{ padding: "10px 12px" }}>Date</th>
                    <th style={{ padding: "10px 12px" }}>Check-In</th>
                    <th style={{ padding: "10px 12px" }}>Check-Out</th>
                    <th style={{ padding: "10px 12px" }}>Hours Worked</th>
                    <th style={{ padding: "10px 12px" }}>Status</th>
                  </tr>
                </thead>
                <tbody className={historyLoading && historyRecords.length > 0 ? "table-refreshing-dim" : ""}>
                  {historyLoading && historyRecords.length === 0 ? (
                    <TableSkeletonRows colCount={5} rowCount={4} widths={["100px", "90px", "90px", "90px", "80px"]} />
                  ) : historyRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "30px", textAlign: "center", color: "#71717a", fontSize: 13.5 }}>
                        No attendance punch records found for the selected period.
                      </td>
                    </tr>
                  ) : (
                    historyRecords.map((rec) => (
                      <tr key={rec._id || rec.date} style={{ borderBottom: "1px solid #f4f4f5" }}>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#09090b" }}>{rec.date}</td>
                        <td style={{ padding: "12px" }}>{rec.checkInTime ? new Date(rec.checkInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td style={{ padding: "12px" }}>{rec.checkOutTime ? new Date(rec.checkOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td style={{ padding: "12px", fontWeight: 600 }}>{rec.workingHours || "—"}</td>
                        <td style={{ padding: "12px" }}>
                          <StatusBadge status={rec.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

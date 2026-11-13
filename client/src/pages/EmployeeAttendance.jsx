import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import AttendanceTimeline from "../components/AttendanceTimeline";
import AttendanceSummaryMetrics from "../components/AttendanceSummaryMetrics";
import Pagination from "../components/Pagination";
import {
  IconClose,
  IconCheck,
  IconAlertCircle,
  IconClock,
  IconChevronLeft,
  IconChevronRight,
} from "../components/EmployeeIcon";
import ModuleToolbar from "../components/ModuleToolbar";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  useAttendanceHistoryQuery,
  useDashboardQuery,
  useTrackingStatusQuery,
} from "../hooks/useEmployeeQueries";
import { invalidateAttendance } from "../lib/queryKeys";
import { acquireCurrentLocation, watchLiveLocation } from "../utils/geolocation";
import AttendanceVerificationPanel, {
  FaceEnrollmentCapture,
  VERIFICATION_STATUS,
  captureFaceImageBase64,
} from "../components/AttendanceVerificationPanel";
import DateRangePicker from "../components/DateRangePicker";
import {
  civilDaysInMonth,
  formatCivilDate,
  formatDisplayDate,
  getCompanyBusinessDate,
  monthTitle,
  parseCivilDate,
  resolveCompanyTimezone,
  shiftMonth,
} from "../utils/dateUtils";

function monthRangeFor(year, month) {
  return {
    startDate: formatCivilDate(year, month, 1),
    endDate: formatCivilDate(year, month, civilDaysInMonth(year, month)),
  };
}
import "./Attendance.css";

export default function EmployeeAttendance() {
  const { user, company } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const timeZone = resolveCompanyTimezone(company);

  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [focusedRemoteId, setFocusedRemoteId] = useState("");

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

  // History range: defaults to the current month; month arrows and the picker both drive it.
  const [historyRange, setHistoryRange] = useState(() => {
    const now = new Date();
    return monthRangeFor(now.getFullYear(), now.getMonth() + 1);
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [attPage, setAttPage] = useState(1);
  const [attPageSize, setAttPageSize] = useState(10);

  const dashboardQuery = useDashboardQuery();
  const historyQuery = useAttendanceHistoryQuery(historyRange.startDate, historyRange.endDate);
  const trackingQuery = useTrackingStatusQuery();

  const dashboardData = dashboardQuery.data ?? null;
  const historyRecords = historyQuery.data || [];
  const historyLoading = historyQuery.isLoading && !historyQuery.data;
  const isSoftRefreshing =
    (dashboardQuery.isFetching && !!dashboardData) ||
    (historyQuery.isFetching && !!historyQuery.data);

  useEffect(() => {
    const data = trackingQuery.data;
    if (data?.isTrackingActive && data?.session) {
      setIsLiveTracking(true);
      setTrackingSession(data.session);
    } else if (data && !data.isTrackingActive) {
      setIsLiveTracking(false);
      setTrackingSession(null);
    }
  }, [trackingQuery.data]);

  useEffect(() => {
    return () => {
      if (unwatchRef.current) {
        unwatchRef.current();
      }
    };
  }, []);

  const shiftHistoryMonth = (delta) => {
    setHistoryRange((prev) => {
      const parts = parseCivilDate(prev.startDate);
      if (!parts) return prev;
      const next = shiftMonth(parts.year, parts.month, delta);
      return monthRangeFor(next.year, next.month);
    });
  };

  const handlePrevMonth = () => shiftHistoryMonth(-1);
  const handleNextMonth = () => shiftHistoryMonth(1);

  const handleRangeChange = ({ startDate, endDate }) => {
    if (!startDate) return;
    setHistoryRange({ startDate, endDate: endDate || startDate });
  };

  // Label is the month title for a whole-month range, otherwise the explicit span.
  const monthYearLabel = useMemo(() => {
    const s = parseCivilDate(historyRange.startDate);
    const e = parseCivilDate(historyRange.endDate);
    if (!s || !e) return "";
    const isWholeMonth =
      s.year === e.year &&
      s.month === e.month &&
      s.day === 1 &&
      e.day === civilDaysInMonth(e.year, e.month);
    if (isWholeMonth) return monthTitle(s.year, s.month);
    return historyRange.startDate === historyRange.endDate
      ? formatDisplayDate(historyRange.startDate)
      : `${formatDisplayDate(historyRange.startDate)} – ${formatDisplayDate(historyRange.endDate)}`;
  }, [historyRange]);

  const [remoteRequests, setRemoteRequests] = useState([]);
  const [verificationRequirements, setVerificationRequirements] = useState(null);
  const [faceEnrollment, setFaceEnrollment] = useState({ enrolled: false });
  const [gpsVerifyStatus, setGpsVerifyStatus] = useState(VERIFICATION_STATUS.IDLE);
  const [wifiVerifyStatus, setWifiVerifyStatus] = useState(VERIFICATION_STATUS.UNSUPPORTED);
  const [faceVerifyStatus, setFaceVerifyStatus] = useState(VERIFICATION_STATUS.IDLE);
  const [faceImageBase64, setFaceImageBase64] = useState(null);
  const [capturingFace, setCapturingFace] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [gpsDetail, setGpsDetail] = useState("");
  const [faceDetail, setFaceDetail] = useState("");

  const refreshRemoteRequests = async () => {
    try {
      const res = await api.get("/employees/me/attendance/remote-requests");
      setRemoteRequests(Array.isArray(res.data?.requests) ? res.data.requests : []);
    } catch {
      setRemoteRequests([]);
    }
  };

  // Notification deep link: ?remoteWorkRequestId= highlights own remote request if present.
  useEffect(() => {
    const remoteId = (searchParams.get("remoteWorkRequestId") || "").trim();
    if (!remoteId) return;
    const hit = remoteRequests.find((r) => String(r._id || r.id) === remoteId);
    if (hit) {
      setFocusedRemoteId(String(hit._id || hit.id));
      requestAnimationFrame(() => {
        const el = document.getElementById(`remote-req-${hit._id || hit.id}`);
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("remoteWorkRequestId");
        next.delete("sessionId");
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("remoteWorkRequestId"), remoteRequests]);

  const refreshVerificationStatus = async () => {
    try {
      const res = await api.get("/employees/me/attendance/status");
      setVerificationRequirements(res.data?.attendance?.verificationRequirements || null);
      setFaceEnrollment(res.data?.attendance?.faceEnrollment || { enrolled: false });
      const methods = res.data?.attendance?.verificationRequirements?.methods || {};
      if (methods.wifi?.enabled) {
        setWifiVerifyStatus(VERIFICATION_STATUS.UNSUPPORTED);
      }
    } catch {
      /* keep previous */
    }
  };

  useEffect(() => {
    refreshRemoteRequests();
    refreshVerificationStatus();
  }, []);

  const mandatoryWifiBlocksDesktop = Boolean(
    verificationRequirements?.methods?.wifi?.enabled && verificationRequirements?.methods?.wifi?.mandatory
  );
  const faceRequiredMissing =
    Boolean(verificationRequirements?.methods?.face?.enabled && verificationRequirements?.methods?.face?.mandatory) &&
    !faceEnrollment?.enrolled;
  const faceCaptureMissing =
    Boolean(verificationRequirements?.methods?.face?.enabled && verificationRequirements?.methods?.face?.mandatory) &&
    faceEnrollment?.enrolled &&
    !faceImageBase64;

  const handleCaptureFaceForPunch = async () => {
    try {
      setCapturingFace(true);
      setFaceVerifyStatus(VERIFICATION_STATUS.PENDING);
      setFaceDetail("Capturing face…");
      const image = await captureFaceImageBase64();
      setFaceImageBase64(image);
      setFaceVerifyStatus(VERIFICATION_STATUS.VERIFIED);
      setFaceDetail("Face captured. Server will match on punch.");
    } catch (err) {
      setFaceVerifyStatus(VERIFICATION_STATUS.FAILED);
      setFaceDetail(err.message || "Face capture failed.");
      setFaceImageBase64(null);
    } finally {
      setCapturingFace(false);
    }
  };

  const handleEnrollFaceSubmit = async ({ imageBase64, consentAccepted }) => {
    try {
      setCapturingFace(true);
      await api.post("/employees/me/face-enrollment", {
        imageBase64,
        consentAccepted,
        consentTextVersion: "v1",
      });
      setShowEnrollModal(false);
      setActionSuccess("Face enrolled successfully.");
      await refreshVerificationStatus();
    } catch (err) {
      setActionError(err.response?.data?.message || "Face enrollment failed.");
    } finally {
      setCapturingFace(false);
    }
  };

  const handleCheckIn = async (sessionType = "OFFICE", remoteWorkRequestId = null) => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      setGeoError("");
      setGeoStatus("ACQUIRING");
      setGpsVerifyStatus(VERIFICATION_STATUS.PENDING);

      if (mandatoryWifiBlocksDesktop) {
        setWifiVerifyStatus(VERIFICATION_STATUS.UNSUPPORTED);
        setActionError(
          "Office Wi-Fi verification is mandatory. Use the Android HRMS app — desktop browsers cannot verify Wi-Fi."
        );
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }
      if (faceRequiredMissing) {
        setActionError("Enroll your face before punching in. Face verification is mandatory for your company.");
        setShowEnrollModal(true);
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }
      if (faceCaptureMissing) {
        setActionError("Capture your face for verification before punching in.");
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }

      let loc = null;
      try {
        loc = await acquireCurrentLocation({ enableHighAccuracy: true, timeout: 15000 });
        setLastCapturedLocation(loc);
        setGeoStatus("SUCCESS");
        setGpsVerifyStatus(VERIFICATION_STATUS.VERIFIED);
        setGpsDetail(
          loc.accuracy != null ? `Accuracy ±${Math.round(loc.accuracy)}m (server validates geofence)` : "Location captured"
        );
      } catch (err) {
        setGeoStatus("ERROR");
        setGpsVerifyStatus(VERIFICATION_STATUS.FAILED);
        const msg = `${err.message} ${err.action || "Please enable location in browser settings to punch in."}`;
        setGeoError(msg);
        setActionError(msg);
        setGpsDetail(msg);
        return;
      }

      const response = await api.post("/employees/me/attendance/punch-in", {
        location: loc,
        sessionType: sessionType === "REMOTE" ? "REMOTE" : "OFFICE",
        ...(remoteWorkRequestId ? { remoteWorkRequestId } : {}),
        ...(faceImageBase64 ? { faceImageBase64 } : {}),
        clientPlatform: "web",
      });
      setFaceImageBase64(null);
      setFaceVerifyStatus(VERIFICATION_STATUS.IDLE);
      setActionSuccess(response.data?.message || "Punched in successfully!");
      await invalidateAttendance(queryClient);
      await refreshRemoteRequests();
      await refreshVerificationStatus();
    } catch (err) {
      const msg = err.response?.data?.message || "Unable to punch in. Please try again.";
      setActionError(msg);
      const lower = String(msg).toLowerCase();
      if (lower.includes("face")) {
        setFaceVerifyStatus(VERIFICATION_STATUS.FAILED);
        setFaceDetail(msg);
      }
      if (
        lower.includes("outside") ||
        lower.includes("geofence") ||
        lower.includes("radius") ||
        lower.includes("location") ||
        lower.includes("accuracy")
      ) {
        setGpsVerifyStatus(VERIFICATION_STATUS.FAILED);
        setGpsDetail(msg);
        setGeoStatus("ERROR");
      }
    } finally {
      setCheckingAttendance(false);
    }
  };

  const handleRequestRemote = async () => {
    try {
      setCheckingAttendance(true);
      setActionError("");
      setActionSuccess("");
      const loc = await acquireCurrentLocation({ enableHighAccuracy: true, timeout: 15000 });
      const workDate = attendance?.today?.date || getCompanyBusinessDate(new Date(), timeZone);
      await api.post("/employees/me/attendance/remote-requests", {
        workDate,
        reason: "Remote work session",
        location: { ...loc, label: "Remote", radiusMeters: 250 },
      });
      setActionSuccess("Remote work request submitted. Punch in remotely after HR approval.");
      await refreshRemoteRequests();
    } catch (err) {
      setActionError(err.response?.data?.message || "Unable to submit remote work request.");
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
      setGpsVerifyStatus(VERIFICATION_STATUS.PENDING);

      if (mandatoryWifiBlocksDesktop) {
        setWifiVerifyStatus(VERIFICATION_STATUS.UNSUPPORTED);
        setActionError(
          "Office Wi-Fi verification is mandatory. Use the Android HRMS app — desktop browsers cannot verify Wi-Fi."
        );
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }
      if (faceRequiredMissing) {
        setActionError("Enroll your face before punching out. Face verification is mandatory for your company.");
        setShowEnrollModal(true);
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }
      if (faceCaptureMissing) {
        setActionError("Capture your face for verification before punching out.");
        setGeoStatus("IDLE");
        setGpsVerifyStatus(VERIFICATION_STATUS.IDLE);
        return;
      }

      let loc = null;
      try {
        loc = await acquireCurrentLocation({ enableHighAccuracy: true, timeout: 15000 });
        setLastCapturedLocation(loc);
        setGeoStatus("SUCCESS");
        setGpsVerifyStatus(VERIFICATION_STATUS.VERIFIED);
        setGpsDetail(
          loc.accuracy != null ? `Accuracy ±${Math.round(loc.accuracy)}m (server validates geofence)` : "Location captured"
        );
      } catch (err) {
        setGeoStatus("ERROR");
        setGpsVerifyStatus(VERIFICATION_STATUS.FAILED);
        const msg = `${err.message} ${err.action || "Please enable location in browser settings to punch out."}`;
        setGeoError(msg);
        setActionError(msg);
        setGpsDetail(msg);
        return;
      }

      const response = await api.post("/employees/me/attendance/punch-out", {
        location: loc,
        ...(faceImageBase64 ? { faceImageBase64 } : {}),
        clientPlatform: "web",
      });
      setFaceImageBase64(null);
      setFaceVerifyStatus(VERIFICATION_STATUS.IDLE);
      // Server stops tracking on punch-out; clear local watcher immediately.
      if (unwatchRef.current) {
        unwatchRef.current();
        unwatchRef.current = null;
      }
      setIsLiveTracking(false);
      setTrackingSession(null);
      setActionSuccess(response.data?.message || "Punched out successfully!");
      if (response.data?.trackingStopWarning) {
        setTrackingError(response.data.trackingStopWarning);
      }
      await invalidateAttendance(queryClient);
    } catch (err) {
      const msg = err.response?.data?.message || "Unable to punch out. Please try again.";
      setActionError(msg);
      const lower = String(msg).toLowerCase();
      if (
        lower.includes("outside") ||
        lower.includes("geofence") ||
        lower.includes("radius") ||
        lower.includes("location") ||
        lower.includes("accuracy")
      ) {
        setGpsVerifyStatus(VERIFICATION_STATUS.FAILED);
        setGpsDetail(msg);
        setGeoStatus("ERROR");
      }
    } finally {
      setCheckingAttendance(false);
    }
  };

  const handleStartTracking = async () => {
    if (isLiveTracking || unwatchRef.current) return;
    if (todayStatus !== "CHECKED_IN") {
      setTrackingError("Punch in before starting live location sharing.");
      return;
    }
    try {
      setTrackingError("");
      const res = await api.post("/employees/me/tracking/start", { durationMinutes: 30 });
      if (res.data?.success) {
        setIsLiveTracking(true);
        setTrackingSession(res.data.session);
        await invalidateAttendance(queryClient);

        if (unwatchRef.current) {
          unwatchRef.current();
        }

        unwatchRef.current = watchLiveLocation(
          async (newLoc) => {
            try {
              await api.post("/employees/me/tracking/update", { location: newLoc });
              setTrackingSession((prev) => (prev ? { ...prev, lastLocation: newLoc } : null));
            } catch (err) {
              const msg = String(err.response?.data?.message || "");
              const status = err.response?.status;
              if (
                status === 400 &&
                (msg.includes("expired") ||
                  msg.includes("No active tracking") ||
                  msg.includes("no active punch-in"))
              ) {
                handleStopTracking(true);
              }
            }
          },
          (err) => {
            setTrackingError(err.message);
            // Permission denied / position unavailable — stop local watcher safely.
            handleStopTracking(false);
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
      await invalidateAttendance(queryClient);
    } catch {
      // ignore stop error
    }
  };

  // Derive days list for the month view
  const monthDaysList = useMemo(() => {
    const todayStr = getCompanyBusinessDate(new Date(), timeZone);
    const startParts = parseCivilDate(historyRange.startDate);
    const endParts = parseCivilDate(historyRange.endDate);
    if (!startParts || !endParts) return [];

    const recordsMap = new Map();
    for (const r of historyRecords) {
      recordsMap.set(r.date, r);
    }

    const startMs = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
    const endMs = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
    const DAY_MS = 86_400_000;

    const list = [];
    for (let ms = endMs; ms >= startMs; ms -= DAY_MS) {
      const dt = new Date(ms);
      const dateStr = formatCivilDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (dateStr > todayStr) {
        continue;
      }

      const existing = recordsMap.get(dateStr);
      if (existing) {
        list.push(existing);
      } else {
        const dayOfWeek = dt.getUTCDay();
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
  }, [historyRange, historyRecords, timeZone]);

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
  }, [historyRange, statusFilter, searchQuery]);

  const totalDaysCount = filteredDays.length;
  const totalDaysPages = Math.ceil((totalDaysCount || 1) / attPageSize);
  const paginatedDays = useMemo(() => {
    const start = (attPage - 1) * attPageSize;
    return filteredDays.slice(start, start + attPageSize);
  }, [filteredDays, attPage, attPageSize]);

  // Calculate summary metrics for the selected month.
  // Worked duration uses completed session totals (excludes gaps), matching backend recomputeDayTotals.
  const metrics = useMemo(() => {
    let daysPresent = 0;
    let lateClockIns = 0;
    let earlyDepartures = 0;
    let noClockOuts = 0;
    let overtimeHours = 0;
    let absentDays = 0;

    const todayStr = getCompanyBusinessDate(new Date(), timeZone);

    const dayWorkedHours = (rec) => {
      if (Array.isArray(rec.sessions) && rec.sessions.length > 0) {
        let mins = 0;
        for (const s of rec.sessions) {
          if (s.checkIn && s.checkOut) {
            mins +=
              Number(s.durationMinutes) > 0
                ? Number(s.durationMinutes)
                : Math.max(0, Math.round((new Date(s.checkOut) - new Date(s.checkIn)) / 60000));
          }
        }
        return mins / 60;
      }
      if (Number(rec.durationMinutes) > 0) return Number(rec.durationMinutes) / 60;
      if (rec.checkIn && rec.checkOut) {
        return (new Date(rec.checkOut) - new Date(rec.checkIn)) / (1000 * 3600);
      }
      return null;
    };

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

        const hasOpen =
          rec.openSessionId ||
          (Array.isArray(rec.sessions) && rec.sessions.some((s) => s.checkIn && !s.checkOut)) ||
          (rec.checkIn && !rec.checkOut && (!rec.sessions || rec.sessions.length === 0));
        if (hasOpen && rec.date !== todayStr) {
          noClockOuts++;
        }

        const workedHours = dayWorkedHours(rec);
        if (workedHours != null) {
          if (workedHours > 8) {
            overtimeHours += Math.round(workedHours - 8);
          }
          if (workedHours < 7.5 && !hasOpen) {
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
  }, [monthDaysList, timeZone]);

  const attendance = dashboardData?.attendance;
  const todayStatus = attendance?.today?.status || "NOT_CHECKED_IN";
  const workMode = String(attendance?.today?.workMode || "OFFICE").toUpperCase();
  const todayDateKey = String(attendance?.today?.date || "").slice(0, 10);
  const approvedRemoteForToday = remoteRequests.find(
    (r) =>
      String(r.status || "").toUpperCase() === "APPROVED" &&
      !r.consumedAt &&
      String(r.workDate || "").slice(0, 10) === todayDateKey
  );
  const pendingRemoteForToday = remoteRequests.find(
    (r) =>
      String(r.status || "").toUpperCase() === "PENDING" &&
      String(r.workDate || "").slice(0, 10) === todayDateKey
  );
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
      <AppHeader title="Attendance">
        <SoftRefresh active={isSoftRefreshing} />
      </AppHeader>

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
            {(todayStatus === "NOT_CHECKED_IN" || todayStatus === "CHECKED_OUT") && (
              <>
                {workMode !== "WFH" ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleCheckIn("OFFICE")}
                    disabled={
                      checkingAttendance ||
                      mandatoryWifiBlocksDesktop ||
                      faceRequiredMissing ||
                      faceCaptureMissing
                    }
                    style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600 }}
                  >
                    {checkingAttendance ? "Acquiring GPS..." : todayStatus === "CHECKED_OUT" ? "Start Office Session" : "Punch In (Office)"}
                  </button>
                ) : null}
                {workMode === "WFH" ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleCheckIn("REMOTE")}
                    disabled={checkingAttendance}
                    style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600 }}
                  >
                    {checkingAttendance ? "Acquiring GPS..." : "Punch In (WFH)"}
                  </button>
                ) : null}
                {workMode === "HYBRID" && approvedRemoteForToday ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleCheckIn("REMOTE", approvedRemoteForToday.id || approvedRemoteForToday._id)}
                    disabled={checkingAttendance}
                    style={{ padding: "10px 18px", fontSize: 14, fontWeight: 600 }}
                  >
                    Punch In (Approved remote)
                  </button>
                ) : null}
                {workMode === "HYBRID" && !approvedRemoteForToday && !pendingRemoteForToday ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleRequestRemote}
                    disabled={checkingAttendance}
                    style={{ padding: "10px 18px", fontSize: 14, fontWeight: 600 }}
                  >
                    Request remote work
                  </button>
                ) : null}
                {workMode === "HYBRID" && pendingRemoteForToday ? (
                  <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Remote request pending HR</span>
                ) : null}
              </>
            )}

            {focusedRemoteId
              ? (() => {
                  const focused = remoteRequests.find(
                    (r) => String(r._id || r.id) === String(focusedRemoteId)
                  );
                  if (!focused) return null;
                  return (
                    <div
                      id={`remote-req-${focusedRemoteId}`}
                      className="success-alert"
                      style={{ marginTop: 12, width: "100%" }}
                    >
                      Remote work request ({focused.status || "UNKNOWN"}) for{" "}
                      {focused.workDate || "selected date"}
                      {focused.decisionRemarks ? ` — ${focused.decisionRemarks}` : ""}.
                    </div>
                  );
                })()
              : null}

            {todayStatus === "CHECKED_IN" && (
              <button
                type="button"
                className="btn-primary"
                onClick={handleCheckOut}
                disabled={
                  checkingAttendance ||
                  mandatoryWifiBlocksDesktop ||
                  faceRequiredMissing ||
                  faceCaptureMissing
                }
                style={{ padding: "10px 22px", fontSize: 14, fontWeight: 600, background: "#dc2626", borderColor: "#dc2626" }}
              >
                {checkingAttendance ? "Acquiring GPS..." : "Punch Out Session"}
              </button>
            )}

            {/* Live Tracking toggle — server requires active punch-in + policy */}
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
                disabled={todayStatus !== "CHECKED_IN"}
                title={
                  todayStatus !== "CHECKED_IN"
                    ? "Punch in before sharing live location"
                    : "Share live location for 30 minutes"
                }
              >
                Share Location (30 min)
              </button>
            )}
          </div>
        </div>

        <AttendanceVerificationPanel
          requirements={verificationRequirements}
          faceEnrollment={faceEnrollment}
          gpsStatus={gpsVerifyStatus}
          gpsDetail={gpsDetail}
          wifiStatus={wifiVerifyStatus}
          faceStatus={faceVerifyStatus}
          faceDetail={faceDetail}
          capturingFace={capturingFace}
          disabled={checkingAttendance}
          onCaptureFace={handleCaptureFaceForPunch}
          onEnrollFace={() => setShowEnrollModal(true)}
        />

        {showEnrollModal ? (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--hair, #e6ede8)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "#14532d" }}>Face enrollment</div>
            <FaceEnrollmentCapture
              onCaptured={handleEnrollFaceSubmit}
              onCancel={() => setShowEnrollModal(false)}
            />
          </div>
        ) : null}

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

      <ModuleToolbar
        leading={
          <div className="att-month-selector">
            <button
              type="button"
              className="att-month-nav-btn"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              title="Previous month"
            >
              <IconChevronLeft size={14} strokeWidth={2.15} />
            </button>
            <span className="att-month-title">{monthYearLabel}</span>
            <button
              type="button"
              className="att-month-nav-btn"
              onClick={handleNextMonth}
              aria-label="Next month"
              title="Next month"
            >
              <IconChevronRight size={14} strokeWidth={2.15} />
            </button>
          </div>
        }
        actions={
          <DateRangePicker
            label=""
            startDate={historyRange.startDate}
            endDate={historyRange.endDate}
            maxDate={getCompanyBusinessDate(new Date(), timeZone)}
            onChange={handleRangeChange}
          />
        }
        searchValue={searchQuery}
        onSearchChange={(e) => setSearchQuery(e.target.value)}
        searchPlaceholder="Search date..."
        searchAriaLabel="Search day"
        filterCount={statusFilter !== "ALL" ? 1 : 0}
        onFiltersClear={() => setStatusFilter("ALL")}
        filters={
          <label className="module-toolbar-filter-field">
            Status
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Status</option>
              <option value="PRESENT">Present Only</option>
              <option value="LATE">Late Clock-In</option>
              <option value="ON_LEAVE">Leaves / Off</option>
              <option value="ABSENT">Absent / No Punch</option>
            </select>
          </label>
        }
      />

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

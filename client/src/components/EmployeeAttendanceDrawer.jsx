import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppModal from "./AppModal";
import MonthCalendar from "./MonthCalendar";
import AttendanceTimeline from "./AttendanceTimeline";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  civilDaysInMonth,
  formatCivilDate,
  getCompanyBusinessDate,
  monthTitle,
  resolveCompanyTimezone,
  weekdaySunday0,
} from "../utils/dateUtils";

function parseTimeToMinutes(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getHours() * 60 + value.getMinutes();
  }
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClock(value, timeZone) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const asStr = String(value);
    if (/^\d{1,2}:\d{2}/.test(asStr)) return asStr.slice(0, 5);
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function holidayKey(h) {
  if (!h) return "";
  if (typeof h === "string") return h.slice(0, 10);
  if (h.date) return String(h.date).slice(0, 10);
  return "";
}

export default function EmployeeAttendanceDrawer({
  employeeId,
  employeeList = [],
  currentIndex = 0,
  onSelectEmployee,
  onClose,
}) {
  const navigate = useNavigate();
  const { company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);

  const nowParts = useMemo(() => {
    const today = getCompanyBusinessDate(new Date(), timeZone);
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m };
  }, [timeZone]);

  const [calMonth, setCalMonth] = useState(nowParts);
  const [selectedDay, setSelectedDay] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [weekendRules, setWeekendRules] = useState({
    saturdayOff: true,
    sundayOff: true,
  });
  const [holidays, setHolidays] = useState([]);
  const [officeStart, setOfficeStart] = useState("09:30");
  const [graceMinutes, setGraceMinutes] = useState(15);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/policies/active");
        const policy = res.data?.policy;
        if (cancelled || !policy) return;
        setWeekendRules(
          policy.weekendRules || { saturdayOff: true, sundayOff: true }
        );
        setHolidays(Array.isArray(policy.holidays) ? policy.holidays : []);
        setOfficeStart(policy.attendanceRules?.officeStartTime || "09:30");
        setGraceMinutes(policy.attendanceRules?.gracePeriodMinutes ?? 15);
      } catch {
        // Keep defaults when policy unavailable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchEmployeeData = useCallback(async () => {
    if (!employeeId) return;
    try {
      setLoading(true);
      setError("");
      const startDate = formatCivilDate(calMonth.year, calMonth.month, 1);
      const endDate = formatCivilDate(
        calMonth.year,
        calMonth.month,
        civilDaysInMonth(calMonth.year, calMonth.month)
      );

      try {
        const res = await api.get(`/admin/attendance/employee/${employeeId}`, {
          params: { startDate, endDate, limit: 100 },
        });
        if (res.data?.success) {
          setEmployeeInfo(res.data.employee);
          setHistoryRecords(res.data.records || []);
          return;
        }
      } catch {
        // fallback below
      }

      const empRes = await api.get(`/employees/${employeeId}`);
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
      const logs = emp.customFields?.attendanceLogs || [];
      setHistoryRecords(
        logs
          .filter((l) => l.date >= startDate && l.date <= endDate)
          .map((l) => ({
            _id: l.date,
            date: l.date,
            status: l.status || "PRESENT",
            checkIn: l.checkIn,
            checkOut: l.checkOut,
            workingHours: l.workingHours || "—",
          }))
      );
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load employee attendance history.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, calMonth.year, calMonth.month]);

  useEffect(() => {
    fetchEmployeeData();
  }, [fetchEmployeeData]);

  useEffect(() => {
    setSelectedDay("");
  }, [employeeId, calMonth.year, calMonth.month]);

  const holidaySet = useMemo(() => {
    const set = new Set();
    for (const h of holidays) {
      const key = holidayKey(h);
      if (key) set.add(key);
    }
    return set;
  }, [holidays]);

  const lateThreshold = useMemo(() => {
    const start = parseTimeToMinutes(officeStart) ?? 570;
    return start + (Number(graceMinutes) || 0);
  }, [officeStart, graceMinutes]);

  const recordsByDate = useMemo(() => {
    const map = new Map();
    for (const r of historyRecords) {
      if (r?.date) map.set(r.date, r);
    }
    return map;
  }, [historyRecords]);

  const dayStatuses = useMemo(() => {
    const todayStr = getCompanyBusinessDate(new Date(), timeZone);
    const daysInMonth = civilDaysInMonth(calMonth.year, calMonth.month);
    const result = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatCivilDate(calMonth.year, calMonth.month, day);
      const dow = weekdaySunday0(calMonth.year, calMonth.month, day);
      const isSatOff = weekendRules.saturdayOff !== false && dow === 6;
      const isSunOff = weekendRules.sundayOff !== false && dow === 0;
      const isWeekend = isSatOff || isSunOff;
      const isHoliday = holidaySet.has(dateStr);
      const rec = recordsByDate.get(dateStr);
      const punchIn = formatClock(rec?.checkIn, timeZone);
      const punchOut = formatClock(rec?.checkOut, timeZone);
      const hours =
        rec?.workingHours && rec.workingHours !== "--" ? String(rec.workingHours) : null;

      if (dateStr > todayStr) {
        result[dateStr] = {
          statusKey: isHoliday ? "holiday" : isWeekend ? "weekend" : "none",
          shortLabel: isHoliday ? "Hol" : isWeekend ? "Off" : "",
          label: isHoliday ? "Holiday" : isWeekend ? "Non-working day" : "Upcoming",
          tooltip: isHoliday
            ? "Holiday — no attendance expected."
            : isWeekend
              ? "Non-working day."
              : "Future date — no attendance yet.",
        };
        continue;
      }

      if (rec && (rec.status === "ON_LEAVE" || rec.status === "LEAVE")) {
        result[dateStr] = {
          statusKey: "leave",
          shortLabel: "Leave",
          label: "On leave",
          tooltip: "Leave — employee was approved off this day.",
          record: rec,
        };
        continue;
      }

      if (isHoliday) {
        result[dateStr] = {
          statusKey: "holiday",
          shortLabel: "Hol",
          label: "Holiday",
          tooltip: "Company holiday — attendance not required.",
          record: rec,
        };
        continue;
      }

      if (isWeekend) {
        result[dateStr] = {
          statusKey: "weekend",
          shortLabel: "Off",
          label: "Weekend",
          tooltip: "Non-working day.",
          record: rec,
        };
        continue;
      }

      const present =
        rec &&
        (rec.checkIn ||
          ["PRESENT", "CHECKED_IN", "CHECKED_OUT", "HALF_DAY"].includes(rec.status));

      if (present) {
        let late = false;
        if (rec.checkIn) {
          const mins =
            parseTimeToMinutes(formatClock(rec.checkIn, timeZone)) ??
            parseTimeToMinutes(rec.checkIn);
          late = mins !== null && mins > lateThreshold;
        }
        const lines = [
          late ? "Late arrival" : "Present",
          punchIn ? `Punch in: ${punchIn}` : "Punch in: not recorded",
          punchOut ? `Punch out: ${punchOut}` : "Punch out: not recorded",
          hours ? `Hours: ${hours}` : "Hours: unavailable",
        ];
        if (late) lines.push(`Arrived after ${officeStart} (+${graceMinutes}m grace)`);
        result[dateStr] = {
          statusKey: late ? "late" : "present",
          shortLabel: late ? "Late" : "In",
          label: late ? "Late" : "Present",
          tooltip: lines.join("\n"),
          record: rec,
        };
        continue;
      }

      result[dateStr] = {
        statusKey: "absent",
        shortLabel: "Abs",
        label: "Absent",
        tooltip:
          "Absent — no punch-in recorded for this working day.\nTimes are not invented when punches are missing.",
        record: rec || null,
      };
    }

    return result;
  }, [
    calMonth.year,
    calMonth.month,
    recordsByDate,
    holidaySet,
    weekendRules,
    timeZone,
    lateThreshold,
    officeStart,
    graceMinutes,
  ]);

  const selectedMeta = selectedDay ? dayStatuses[selectedDay] : null;
  const totalEmployees = employeeList.length;
  const subtitle = [
    employeeInfo?.employeeCode || "#EMP",
    employeeInfo?.jobTitle || "Team Member",
    employeeInfo?.department || "General",
  ].join(" · ");

  const legend = (
    <ul className="mc-legend" aria-label="Attendance legend">
      {[
        ["present", "Present"],
        ["late", "Late"],
        ["absent", "Absent"],
        ["leave", "Leave"],
        ["holiday", "Holiday"],
        ["weekend", "Weekend"],
      ].map(([key, label]) => (
        <li key={key}>
          <span className={`mc-legend-swatch is-${key}`} />
          {label}
        </li>
      ))}
    </ul>
  );

  const pager = (
    <div className="att-drawer-pager" style={{ marginRight: 4 }}>
      <button
        type="button"
        className="att-drawer-pager-btn"
        onClick={() => onSelectEmployee?.(currentIndex - 1)}
        disabled={currentIndex <= 0}
        aria-label="Previous employee"
      >
        ‹
      </button>
      <span>
        {totalEmployees > 0 ? `${currentIndex + 1} / ${totalEmployees}` : "1 / 1"}
      </span>
      <button
        type="button"
        className="att-drawer-pager-btn"
        onClick={() => onSelectEmployee?.(currentIndex + 1)}
        disabled={currentIndex >= totalEmployees - 1}
        aria-label="Next employee"
      >
        ›
      </button>
    </div>
  );

  return (
    <AppModal
      open={Boolean(employeeId)}
      onClose={onClose}
      size="xl"
      title={employeeInfo?.fullName || "Employee attendance"}
      subtitle={subtitle}
      headerExtra={pager}
      footer={
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate(`/admin/employees/${employeeId}`)}
        >
          View profile
        </button>
      }
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: "36px 12px", color: "var(--muted)" }}>
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <p style={{ margin: 0, fontSize: 13.5 }}>Loading attendance…</p>
        </div>
      ) : error ? (
        <div className="error" style={{ padding: 14, borderRadius: 10, textAlign: "center" }}>
          {error}
        </div>
      ) : (
        <>
          <MonthCalendar
            mode="attendance"
            year={calMonth.year}
            month={calMonth.month}
            timeZone={timeZone}
            dayStatuses={dayStatuses}
            selectedDate={selectedDay}
            heading={monthTitle(calMonth.year, calMonth.month)}
            onMonthChange={setCalMonth}
            onDaySelect={(dateStr) => setSelectedDay(dateStr)}
            legend={legend}
          />

          {selectedDay && selectedMeta ? (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 10,
                border: "1px solid var(--hair)",
                background: "#f8faf8",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--ink)" }}>
                {selectedDay} — {selectedMeta.label}
              </div>
              {selectedMeta.record &&
              (selectedMeta.record.checkIn || selectedMeta.record.checkOut) ? (
                <AttendanceTimeline
                  date={selectedMeta.record.date || selectedDay}
                  checkIn={selectedMeta.record.checkIn}
                  checkOut={selectedMeta.record.checkOut}
                  workingHours={selectedMeta.record.workingHours}
                  durationMinutes={selectedMeta.record.durationMinutes}
                  status={selectedMeta.record.status}
                  notes={selectedMeta.record.notes}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", whiteSpace: "pre-line" }}>
                  {selectedMeta.tooltip}
                </p>
              )}
            </div>
          ) : (
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--muted)" }}>
              Hover or tap a date for punch details. Missing punches are explained — times are never invented.
            </p>
          )}
        </>
      )}
    </AppModal>
  );
}

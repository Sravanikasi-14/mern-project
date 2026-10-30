import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, MoreVertical } from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import AttendanceMonthCalendar from "../../components/AttendanceMonthCalendar";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import api from "../../services/api";
import {
  formatCivilDate,
  formatDisplayDate,
  resolveCompanyTimezone,
} from "../../utils/dateUtils";

function clock(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function civilFromRecord(row) {
  const raw = row?.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function workedLabel(row) {
  if (row?.workingHours && row.workingHours !== "--") return row.workingHours;
  const inn = row?.checkIn || row?.checkInTime;
  const out = row?.checkOut || row?.checkOutTime;
  if (!inn || !out) return null;
  const ms = new Date(out) - new Date(inn);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function overtimeLabel(row) {
  const inn = row?.checkIn || row?.checkInTime;
  const out = row?.checkOut || row?.checkOutTime;
  if (!inn || !out) return null;
  const hours = (new Date(out) - new Date(inn)) / 3600000;
  if (!Number.isFinite(hours) || hours <= 8) return null;
  const ot = hours - 8;
  const h = Math.floor(ot);
  const m = Math.round((ot - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function HrAttendanceDetailPage() {
  const { id } = useParams();
  const { user, company } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const timezone = resolveCompanyTimezone(company);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attMonth, setAttMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [selectedDay, setSelectedDay] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const last = new Date(Date.UTC(attMonth.year, attMonth.month, 0)).getUTCDate();
      const startDate = formatCivilDate(attMonth.year, attMonth.month, 1);
      const endDate = formatCivilDate(attMonth.year, attMonth.month, last);
      const res = await api.get(`/admin/attendance/employee/${id}`, {
        params: { startDate, endDate, limit: 100 },
      });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load attendance details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id, attMonth.year, attMonth.month]);

  const emp = data?.employee || {};
  const records = useMemo(() => data?.records || data?.history || [], [data]);

  const selectedRecord = useMemo(() => {
    if (!selectedDay) return records[0] || null;
    return records.find((r) => civilFromRecord(r) === selectedDay) || null;
  }, [records, selectedDay]);

  const logs = useMemo(() => {
    const sorted = [...records].sort((a, b) =>
      String(civilFromRecord(b)).localeCompare(String(civilFromRecord(a)))
    );
    if (selectedDay) return sorted.filter((r) => civilFromRecord(r) === selectedDay);
    return sorted;
  }, [records, selectedDay]);

  if (loading && !data) {
    return (
      <div className="st-att-detail">
        <div className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Attendance History</h1>
        </div>
        <Skeleton />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="st-att-detail">
        <div className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Attendance History</h1>
        </div>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const focus = selectedRecord || {};
  const ot = overtimeLabel(focus);
  const worked = workedLabel(focus);
  const loc = focus.checkInLocation || focus.checkOutLocation;

  return (
    <div className="st-att-detail">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Attendance History</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      <section className="st-att-detail-hero">
        <span className="st-profile-photo">{initialsFrom(emp.fullName)}</span>
        <div>
          <h2>{emp.fullName || "Employee"}</h2>
          <p>
            {emp.employeeCode || "—"} · {emp.jobTitle || emp.department || "Team"}
          </p>
        </div>
      </section>

      <AttendanceMonthCalendar
        records={records}
        timezone={timezone}
        month={attMonth}
        onMonthChange={(next) => {
          setSelectedDay("");
          setAttMonth(next);
        }}
        onDaySelect={(day) => setSelectedDay(day || "")}
      />

      {selectedDay ? (
        <div className="st-att-day-filter">
          <span className="caption">Focused: {formatDisplayDate(selectedDay)}</span>
          <button type="button" className="btn-ghost-sm" onClick={() => setSelectedDay("")}>
            Clear
          </button>
        </div>
      ) : null}

      {selectedRecord ? (
        <section className="st-att-focus card">
          <div className="st-att-focus-head">
            <strong>{formatDisplayDate(civilFromRecord(selectedRecord) || selectedRecord.date)}</strong>
            <StatusBadge status={selectedRecord.status || selectedRecord.attendanceStatus} />
          </div>
          <div className="st-att-focus-grid">
            <div>
              <span>Punch in</span>
              <strong>{clock(selectedRecord.checkIn || selectedRecord.checkInTime)}</strong>
            </div>
            <div>
              <span>Punch out</span>
              <strong>{clock(selectedRecord.checkOut || selectedRecord.checkOutTime)}</strong>
            </div>
            <div>
              <span>Working hours</span>
              <strong>{worked || "—"}</strong>
            </div>
            <div>
              <span>Overtime</span>
              <strong>{ot || "—"}</strong>
            </div>
          </div>
          {loc?.latitude != null && loc?.longitude != null ? (
            <p className="caption">
              Location: {loc.address || `${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(4)}`}
            </p>
          ) : (
            <p className="caption">No punch location on this day.</p>
          )}
        </section>
      ) : null}

      <h2 className="st-att-logs-title">Recent attendance</h2>
      {logs.length === 0 ? (
        <EmptyState message="No attendance records for this month." />
      ) : (
        <div className="st-att-logs">
          {logs.map((row) => {
            const dateStr = civilFromRecord(row);
            const day = dateStr ? Number(dateStr.slice(8, 10)) : "—";
            const mon = dateStr
              ? new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-IN", {
                  month: "short",
                  timeZone: "UTC",
                })
              : "";
            const hours = workedLabel(row);
            return (
              <button
                key={row._id || dateStr}
                type="button"
                className="st-att-log"
                onClick={() => setSelectedDay(dateStr)}
              >
                <span className="st-att-log-date">
                  <strong>{day}</strong>
                  <em>{mon}</em>
                </span>
                <span className="st-att-log-times">
                  <span>
                    <strong>{clock(row.checkIn || row.checkInTime)}</strong>
                    <em>Check In</em>
                  </span>
                  <span>
                    <strong>{clock(row.checkOut || row.checkOutTime)}</strong>
                    <em>Check Out</em>
                  </span>
                </span>
                <span className={`st-att-log-pill is-${String(row.status || row.attendanceStatus || "").toLowerCase()}`}>
                  <i aria-hidden="true" />
                  <em>
                    {hours ? `${hours} · ` : ""}
                    {String(row.status || row.attendanceStatus || "Recorded")
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

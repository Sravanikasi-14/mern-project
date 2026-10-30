import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPinned, Search } from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import DatePickerField from "../../components/DatePickerField";
import ProfileAvatar from "../../components/ProfileAvatar";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { initialsFrom } from "../../components/SummaryRow";
import api from "../../services/api";
import {
  getCompanyBusinessDate,
  resolveCompanyTimezone,
} from "../../utils/dateUtils";

function timeLabel(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function statusBucket(row) {
  const s = String(row.attendanceStatus || row.status || "").toUpperCase();
  if (s === "ON_LEAVE") return "leave";
  if (s === "LATE") return "late";
  if (s === "ABSENT" || s === "NOT_CHECKED_IN") return "absent";
  if (["CHECKED_IN", "CHECKED_OUT", "PRESENT"].includes(s)) return "present";
  if (!row.checkInTime && !row.checkIn) return "absent";
  return "present";
}

export default function HrAttendancePage() {
  const { company, user } = useAuth();
  const notify = useNotify();
  const timezone = resolveCompanyTimezone(company);
  const navigate = useNavigate();
  const todayStr = getCompanyBusinessDate(new Date(), timezone);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [date, setDate] = useState(todayStr);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/admin/attendance/overview", { params: { date } });
      setRows(res.data?.employees || res.data?.rows || []);
      setSummary(res.data?.summary || {});
    } catch (err) {
      setError(err.response?.data?.message || "Could not load attendance.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 120);
    return () => clearTimeout(t);
  }, [date]);

  const counts = useMemo(() => {
    const buckets = { all: rows.length, present: 0, late: 0, leave: 0, absent: 0 };
    rows.forEach((row) => {
      const b = statusBucket(row);
      if (buckets[b] != null) buckets[b] += 1;
    });
    return {
      ...buckets,
      present: summary.presentCount ?? buckets.present,
      late: summary.lateCount ?? buckets.late,
      absent: summary.notCheckedInCount ?? buckets.absent,
      leave: buckets.leave,
      total: summary.totalEmployees ?? rows.length,
    };
  }, [rows, summary]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const bucket = statusBucket(row);
      if (filter !== "all" && bucket !== filter) return false;
      if (!q) return true;
      return `${row.fullName} ${row.employeeCode} ${row.department} ${row.jobTitle}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, filter]);

  const chips = [
    { value: "all", label: "All", count: counts.total },
    { value: "present", label: "Present", count: counts.present },
    { value: "late", label: "Late", count: counts.late },
    { value: "leave", label: "On Leave", count: counts.leave },
    { value: "absent", label: "Absent", count: counts.absent },
  ];

  return (
    <div className="st-att">
      <header className="st-att-head">
        <div className="st-att-head-main">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Attendance Records</h1>
        </div>
        <button type="button" className="hr-portal-avatar" aria-label="Account" onClick={() => notify()}>
          {initialsFrom(user?.name || user?.email || "HR")}
        </button>
      </header>

      <DatePickerField
        value={date}
        onChange={setDate}
        timezone={timezone}
        label="Attendance date"
        className="st-att-datepicker"
      />

      <div className="st-att-kpis" aria-label="Attendance summary">
        <div className="st-att-kpi">
          <span>Total</span>
          <strong>{counts.total}</strong>
        </div>
        <div className="st-att-kpi is-present">
          <span>Present</span>
          <strong>{counts.present}</strong>
        </div>
        <div className="st-att-kpi is-late">
          <span>Late</span>
          <strong>{counts.late}</strong>
        </div>
        <div className="st-att-kpi is-absent">
          <span>Absent</span>
          <strong>{counts.absent}</strong>
        </div>
      </div>

      <div className="st-att-search">
        <Search size={18} strokeWidth={1.85} aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search employees..."
          aria-label="Search employees"
        />
      </div>

      <div className="st-pill-row" role="tablist" aria-label="Attendance status filters">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={`st-pill${filter === chip.value ? " is-active" : ""}`}
            onClick={() => setFilter(chip.value)}
          >
            {chip.label} ({chip.count})
          </button>
        ))}
      </div>

      <button type="button" className="st-att-live" onClick={() => navigate("/admin/attendance/live")}>
        <MapPinned size={18} strokeWidth={1.85} aria-hidden="true" />
        Open live tracking
      </button>

      {loading ? (
        <Skeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState message="No attendance rows for this filter." />
      ) : (
        <div className="st-att-list">
          {filtered.map((row) => {
            const id = row.employeeId || row._id;
            return (
              <button
                key={id}
                type="button"
                className="st-att-card"
                onClick={() => navigate(`/admin/attendance/${id}`)}
              >
                <ProfileAvatar
                  name={row.fullName}
                  photo={row.avatar}
                  size={44}
                  className="st-att-avatar"
                />
                <span className="st-att-copy">
                  <strong>{row.fullName}</strong>
                  <span>{row.employeeCode || "—"}</span>
                </span>
                <span className="st-att-side">
                  <StatusBadge status={row.attendanceStatus || row.status} />
                  <em>{timeLabel(row.checkInTime || row.checkIn)}</em>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

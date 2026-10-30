import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import EmployeeHeader from "../../components/EmployeeHeader";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import LocationBanner from "../../components/LocationBanner";
import StatusBadge from "../../components/StatusBadge";
import Icon from "../../components/Icon";
import { useAuth } from "../../app/AuthContext";
import useLocationPermission from "../../hooks/useLocationPermission";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { resolveCompanyTimezone } from "../../utils/dateUtils";
import { useDashboardQuery, useImpactMeQuery, useMyTasksQuery } from "../../hooks/useEmployeeQueries";
import { invalidateAttendance, invalidateEmployeeWork } from "../../app/queryKeys";

function formatClock(date, timezone) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
}

function formatStamp(value, timezone) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatClock(date, timezone);
}

function leaveTotal(leave) {
  const balance = leave?.balance || {};
  return (Number(balance.casual) || 0) + (Number(balance.sick) || 0) + (Number(balance.earned) || 0);
}

function firstNameOf(value) {
  return String(value || "Colleague").trim().split(/\s+/)[0] || "Colleague";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function PunchHome({ data, error, geo, punching, onPunch, timezone }) {
  const employee = data?.employee;
  const attendance = data?.attendance?.today || {};
  const todayStatus = attendance.status || "NOT_CHECKED_IN";
  const fullName = employee?.preferredName || employee?.fullName || "Colleague";
  const firstName = firstNameOf(fullName);
  const canPunchIn = !punching && todayStatus !== "CHECKED_IN" && todayStatus !== "ON_LEAVE" && todayStatus !== "CHECKED_OUT";
  const canPunchOut = !punching && todayStatus === "CHECKED_IN";
  const isOut = todayStatus === "CHECKED_IN";
  const disabled = punching || (!canPunchIn && !canPunchOut);
  const actionLabel = punching
    ? "Working"
    : todayStatus === "ON_LEAVE"
      ? "On leave"
      : todayStatus === "CHECKED_OUT"
        ? "Complete"
        : isOut
          ? "Punch out"
          : "Punch in";

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateLabel = now.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  });

  return (
    <div className="emp-punch-page">
      <EmployeeHeader
        name={`Hey, ${firstName}`}
        avatarName={fullName}
        employeeCode={employee?.employeeCode}
        action="logout"
      />
      {error ? <div className="alert alert-error">{error}</div> : null}
      <LocationBanner status={geo.status} error={geo.error} busy={geo.busy} onAsk={geo.ask} onRetry={geo.ask} />
      <div className="emp-clock">
        <strong>{formatClock(now, timezone)}</strong>
        <span>{dateLabel}</span>
      </div>
      <div className="emp-punch-wrap">
        <div className="emp-punch-halo">
          <div className="emp-punch-mid">
            <button
              type="button"
              className={`emp-punch-ring${isOut ? " is-out" : ""}`}
              disabled={disabled}
              aria-label={actionLabel}
              onClick={() => onPunch(isOut ? "out" : "in")}
            >
              <span>
                {punching ? <div className="spinner" /> : <Icon name="punch" size={40} />}
                <strong>{actionLabel}</strong>
              </span>
            </button>
          </div>
        </div>
      </div>
      <div className="emp-hours-row">
        <div>
          <span className="emp-hours-ico"><Icon name="clock" size={18} /></span>
          <strong>{formatStamp(attendance.checkInTime, timezone)}</strong>
          <span className="emp-hours-label">Work Start</span>
        </div>
        <div>
          <span className="emp-hours-ico"><Icon name="hours" size={18} /></span>
          <strong>{formatStamp(attendance.checkOutTime, timezone)}</strong>
          <span className="emp-hours-label">Work End</span>
        </div>
        <div>
          <span className="emp-hours-ico"><Icon name="lifecycle" size={18} /></span>
          <strong>
            {!attendance.workingHours || attendance.workingHours === "--" ? "—" : attendance.workingHours}
          </strong>
          <span className="emp-hours-label">Total Today</span>
        </div>
      </div>
    </div>
  );
}

function shortMonthLabel(value) {
  const numeric = Number(value);
  if (numeric >= 1 && numeric <= 12) return MONTHS_SHORT[numeric - 1];
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = MONTHS_SHORT.find((month) => raw.toLowerCase().startsWith(month.toLowerCase()));
  return match || raw.slice(0, 3);
}

function payslipSubtitle(latestPayslip, payslips) {
  if (latestPayslip) {
    const year = latestPayslip.periodYear ?? latestPayslip.year;
    const month = shortMonthLabel(latestPayslip.periodMonth ?? latestPayslip.month);
    if (month && year) return `Latest ${month} ${year}`;
    if (month) return `Latest ${month}`;
    return "On file";
  }
  if (payslips.some((item) => item.isPersisted === false)) return "Estimate only";
  return "None yet";
}

function EmployeeDashboard({ data, tasks, impact, error, timezone, onStartTask, startingTaskId }) {
  const navigate = useNavigate();
  const employee = data?.employee;
  const leave = data?.leave;
  const payslips = data?.payslips || [];
  const latestPayslip = payslips.find((p) => p.isPersisted === true);
  const fullName = employee?.preferredName || employee?.fullName || "Colleague";
  const firstName = firstNameOf(fullName);
  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  });
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const todaysTasks = tasks.filter((task) => {
    if (!task.deadline) return ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"].includes(task.status);
    const due = new Date(task.deadline).toLocaleDateString("en-CA", { timeZone: timezone });
    return due === todayStr && task.status !== "APPROVED";
  });

  return (
    <div className="emp-dash-page">
      <EmployeeHeader
        name={`Hey, ${firstName}`}
        avatarName={fullName}
        employeeCode={employee?.employeeCode}
        action="notify"
      />
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="emp-dash-kicker">
        <h1>My Dashboard</h1>
        <p>{dateLabel}</p>
      </div>
      <div className="emp-metric-grid">
        <button type="button" className="emp-metric-card" onClick={() => navigate("/app/leave")}>
          <div>
            <span className="emp-metric-icon"><Icon name="leave" size={16} /></span>
            <strong>{leaveTotal(leave)}</strong>
          </div>
          <span>Leave Balance</span>
        </button>
        <button type="button" className="emp-metric-card" onClick={() => navigate("/app/tasks")}>
          <div>
            <span className="emp-metric-icon"><Icon name="tasks" size={16} /></span>
            <strong>{tasks.length}</strong>
          </div>
          <span>My Tasks</span>
        </button>
        <button type="button" className="emp-metric-card" onClick={() => navigate("/app/payslips")}>
          <div>
            <span className="emp-metric-icon"><Icon name="payslips" size={16} /></span>
            <strong className="is-title">View Payslips</strong>
          </div>
          <span>{payslipSubtitle(latestPayslip, payslips)}</span>
        </button>
        <button type="button" className="emp-metric-card" onClick={() => navigate("/app/impact-points")}>
          <div>
            <span className="emp-metric-icon"><Icon name="star" size={16} /></span>
            <strong>{impact?.balance ?? 0}</strong>
          </div>
          <span>Impact Points</span>
        </button>
      </div>

      <section className="emp-schedule">
        <div className="section-head">
          <h2 className="section-title">Today&apos;s Schedule</h2>
          <Link to="/app/tasks">View all</Link>
        </div>
        {todaysTasks.length === 0 ? (
          <div className="emp-schedule-empty">
            <span className="emp-metric-icon" aria-hidden="true">😌</span>
            <div>
              <strong>No tasks for today. Enjoy your day! 🎉</strong>
            </div>
          </div>
        ) : (
          todaysTasks.slice(0, 3).map((task) => (
            <div key={task._id} className="summary-row">
              <button type="button" className="summary-body" style={{ textAlign: "left", border: "none", background: "transparent", padding: 0 }} onClick={() => navigate("/app/tasks")}>
                <span className="summary-title">{task.title}</span>
                <span className="summary-sub">{task.deadline ? `Due ${new Date(task.deadline).toLocaleDateString("en-IN")}` : "No deadline"}</span>
              </button>
              {task.status === "ASSIGNED" ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={startingTaskId === task._id}
                  onClick={() => onStartTask?.(task)}
                >
                  {startingTaskId === task._id ? "Starting..." : "Start"}
                </button>
              ) : (
                <StatusBadge status={task.status} />
              )}
            </div>
          ))
        )}
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Quick Actions</h2>
        </div>
        <div className="emp-quick-grid">
          <button type="button" className="emp-quick-tile" onClick={() => navigate("/app/leave?apply=1")}>
            <span className="emp-metric-icon"><Icon name="leave" size={20} /></span>
            <span>Apply<br />Leave</span>
          </button>
          <button type="button" className="emp-quick-tile" onClick={() => navigate("/app/attendance")}>
            <span className="emp-metric-icon"><Icon name="clock" size={20} /></span>
            <span>My<br />Attendance</span>
          </button>
          <button type="button" className="emp-quick-tile" onClick={() => navigate("/app/documents")}>
            <span className="emp-metric-icon"><Icon name="documents" size={20} /></span>
            <span>My<br />Documents</span>
          </button>
          <button type="button" className="emp-quick-tile" onClick={() => navigate("/app/policies")}>
            <span className="emp-metric-icon"><Icon name="policies" size={20} /></span>
            <span>Company<br />Policy</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export default function EmployeeHomePage() {
  const { company } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const geo = useLocationPermission();
  const timezone = resolveCompanyTimezone(company);
  const isDashboard = location.pathname === "/app/dashboard";
  const [actionError, setActionError] = useState("");
  const [punching, setPunching] = useState(false);
  const [startingTaskId, setStartingTaskId] = useState(null);

  const dashQuery = useDashboardQuery();
  const tasksQuery = useMyTasksQuery({ page: 1, limit: 8 });
  const impactQuery = useImpactMeQuery({ retry: 0 });

  const data = dashQuery.data || null;
  const tasks = useMemo(() => {
    const raw = tasksQuery.data;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
    return list.filter((task) => task.status !== "APPROVED");
  }, [tasksQuery.data]);
  const impact = impactQuery.data || null;
  const error = actionError || (dashQuery.error?.response?.data?.message || dashQuery.error?.message || "");
  const loading = dashQuery.isLoading && !data;
  const refreshing = (dashQuery.isFetching || tasksQuery.isFetching || impactQuery.isFetching) && Boolean(data);

  const reload = () => {
    setActionError("");
    return Promise.all([dashQuery.refetch(), tasksQuery.refetch(), impactQuery.refetch()]);
  };

  const startTask = async (task) => {
    if (!task?._id || startingTaskId) return;
    try {
      setStartingTaskId(task._id);
      setActionError("");
      await api.post(`/tasks/${task._id}/start`);
      toast.push(`Started “${task.title}”.`);
      await invalidateEmployeeWork(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || "Could not start this task.");
    } finally {
      setStartingTaskId(null);
    }
  };

  const punch = async (kind) => {
    if (punching) return;
    try {
      setPunching(true);
      setActionError("");
      const loc = await geo.readPosition();
      const path = kind === "in" ? "/employees/me/attendance/punch-in" : "/employees/me/attendance/punch-out";
      await api.post(path, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        location: loc,
      });
      toast.push(kind === "in" ? "Punched in." : "Punched out.");
      await invalidateAttendance(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || err.message || "Could not record punch.");
    } finally {
      setPunching(false);
    }
  };

  const openTasks = useMemo(
    () => tasks.filter((task) => !["APPROVED", "REJECTED"].includes(task.status)),
    [tasks]
  );

  if (loading) return <Skeleton rows={5} />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;

  if (isDashboard) {
    return (
      <>
        {refreshing ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <SoftRefresh active />
          </div>
        ) : null}
        <EmployeeDashboard
          data={data}
          tasks={openTasks}
          impact={impact}
          error={error}
          timezone={timezone}
          onStartTask={startTask}
          startingTaskId={startingTaskId}
        />
      </>
    );
  }

  return (
    <PunchHome
      data={data}
      error={error}
      geo={geo}
      punching={punching}
      onPunch={punch}
      timezone={timezone}
    />
  );
}

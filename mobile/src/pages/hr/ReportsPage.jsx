import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Laptop,
  MoreVertical,
  Search,
  Users,
  UserPlus,
  Wallet,
  Palmtree,
} from "lucide-react";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CATEGORIES = [
  {
    id: "attendance",
    title: "Attendance Report",
    sub: "View attendance insights",
    Icon: CalendarDays,
    tone: "green",
  },
  {
    id: "leave",
    title: "Leave Report",
    sub: "Leave trends and analytics",
    Icon: Palmtree,
    tone: "violet",
  },
  {
    id: "payroll",
    title: "Payroll Report",
    sub: "Salary and payroll summary",
    Icon: Wallet,
    tone: "coral",
  },
  {
    id: "employee",
    title: "Employee Report",
    sub: "Workforce overview",
    Icon: Users,
    tone: "teal",
  },
  {
    id: "recruitment",
    title: "Recruitment Report",
    sub: "Hiring and candidate pipeline",
    Icon: UserPlus,
    tone: "amber",
  },
  {
    id: "assets",
    title: "Asset Report",
    sub: "Company assets summary",
    Icon: Laptop,
    tone: "blue",
  },
];

function downloadCsv(filename, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildRows(category, data) {
  const mix = data?.monthlyAttendanceMix || {};
  const summary = data?.summary || {};
  const funnel = data?.recruitmentFunnel || {};
  const assets = data?.companyAssets || {};
  const workforce = data?.workforce?.departments || [];
  const leaves = data?.recentLeaves || [];
  const meta = data?.meta || {};

  switch (category) {
    case "attendance":
      return [
        ["Metric", "Value"],
        ["Period", `${mix.monthName || meta.monthName || ""} ${mix.year || meta.selectedYear || ""}`],
        ["Present", mix.present ?? 0],
        ["Late", mix.late ?? 0],
        ["Absent", mix.absent ?? 0],
        ["On leave", mix.leave ?? 0],
        ["Today present", summary.todayPresent ?? 0],
        ["Today absent", summary.todayAbsent ?? 0],
        ["Today late", summary.todayLate ?? 0],
      ];
    case "leave":
      return [
        ["Employee", "Type", "Status", "From", "To"],
        ...leaves.map((l) => [
          l.employeeName || l.fullName || "—",
          l.leaveType || l.type || "—",
          l.status || "—",
          l.fromDate || l.startDate || "—",
          l.toDate || l.endDate || "—",
        ]),
        ["", "", "", "On leave today", summary.onLeave ?? 0],
      ];
    case "payroll":
      return [
        ["Metric", "Value"],
        ["Status", summary.payrollStatus || "—"],
        ["Monthly payroll (₹)", summary.monthlyPayroll ?? 0],
        ["Cycle status", summary.payrollCycle?.status || "—"],
        ["Employees awaiting", summary.payrollCycle?.employeesAwaitingProcessing ?? 0],
        ["Pending payment", summary.payrollCycle?.pendingPaymentAmount ?? 0],
      ];
    case "employee":
      return [
        ["Department", "Headcount"],
        ...workforce.map((d) => [d.name || d.department || "—", d.count ?? d.headcount ?? 0]),
        ["Active employees", summary.activeEmployees ?? 0],
      ];
    case "recruitment":
      return [
        ["Metric", "Value"],
        ["Offers generated", funnel.offersGenerated ?? funnel.total ?? 0],
        ["Accepted", funnel.accepted ?? 0],
        ["Pending (sent)", funnel.pending ?? 0],
        ["Declined", funnel.declined ?? funnel.rejected ?? 0],
        ["Draft", funnel.draft ?? 0],
        ["Acceptance rate %", funnel.acceptanceRate ?? 0],
      ];
    case "assets":
      return [
        ["Metric", "Value"],
        ["Active employees", assets.totalEmployees ?? 0],
        ["Employees with assets", assets.employeesWithAssets ?? 0],
        ["Employees with assets %", assets.employeesWithAssetsPct ?? 0],
        ["Employees without assets", assets.employeesWithoutAssets ?? 0],
        ["Employees without assets %", assets.employeesWithoutAssetsPct ?? 0],
      ];
    default:
      return [["Metric", "Value"]];
  }
}

export default function HrReportsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();

  const now = new Date();
  const currentYear = now.getFullYear();
  const yearOptions = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null);
  const [busyExport, setBusyExport] = useState(false);

  const load = async (m = month, y = year) => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/admin/dashboard", { params: { month: m, year: y } });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load reports.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter(
      (c) => c.title.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)
    );
  }, [search]);

  const activeCat = CATEGORIES.find((c) => c.id === active);
  const meta = data?.meta || {};
  const summary = data?.summary || {};
  const mix = data?.monthlyAttendanceMix || {};
  const funnel = data?.recruitmentFunnel || {};
  const assets = data?.companyAssets || {};
  const leaves = data?.recentLeaves || [];
  const workforce = data?.workforce?.departments || [];

  const exportActive = () => {
    if (!active || !data) return;
    try {
      setBusyExport(true);
      const rows = buildRows(active, data);
      downloadCsv(
        `${active}-report-${year}-${String(month).padStart(2, "0")}.csv`,
        rows
      );
      toast.push("Report exported.");
    } finally {
      setBusyExport(false);
    }
  };

  if (loading && !data && !error) {
    return (
      <div className="st-rep">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Reports</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="st-rep">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Reports</h1>
        </header>
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className="st-rep">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Reports</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="st-rep-hero">
        <div>
          <span>{MONTHS[month - 1]} {year} intelligence</span>
          <strong>Organizational Insights</strong>
          <p>{CATEGORIES.length} operational ledgers synced from live dashboard data</p>
        </div>
        <div className="st-rep-hero-ico" aria-hidden="true">
          <BarChart3 size={24} strokeWidth={1.85} />
        </div>
      </section>

      <div className="st-rep-period">
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Report month">
            {MONTHS.map((name, idx) => (
              <option key={name} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Report year">
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="st-att-search">
        <Search size={18} strokeWidth={1.85} aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search operational reports..."
          aria-label="Search reports"
        />
      </div>

      {loading ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <EmptyState message="No reports match your search." />
      ) : (
        <div className="st-rep-list">
          {filtered.map((cat) => {
            const Icon = cat.Icon;
            return (
              <button
                key={cat.id}
                type="button"
                className="st-rep-card"
                onClick={() => setActive(cat.id)}
              >
                <span className={`st-rep-ico is-${cat.tone}`}>
                  <Icon size={20} strokeWidth={1.85} aria-hidden="true" />
                </span>
                <span className="st-rep-copy">
                  <strong>{cat.title}</strong>
                  <span>{cat.sub}</span>
                </span>
                <ChevronRight size={18} strokeWidth={1.85} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}

      <div className="st-rep-note">
        <BarChart3 size={18} strokeWidth={1.85} aria-hidden="true" />
        <div>
          <strong>Live company data</strong>
          <span>
            Figures come from `/admin/dashboard` for {MONTHS[month - 1]} {year}
            {meta.companyName ? ` · ${meta.companyName}` : ""}.
          </span>
        </div>
      </div>

      <Modal
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={activeCat?.title || "Report"}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setActive(null)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busyExport || !data}
              onClick={exportActive}
            >
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {busyExport ? "…" : "Export CSV"}
            </button>
          </>
        }
      >
        {active === "attendance" ? (
          <div className="st-rep-detail">
            <p className="caption">
              {mix.monthName || MONTHS[month - 1]} {mix.year || year}
            </p>
            <div className="st-rep-metrics">
              <div><span>Present</span><strong>{mix.present ?? 0}</strong></div>
              <div><span>Late</span><strong>{mix.late ?? 0}</strong></div>
              <div><span>Absent</span><strong>{mix.absent ?? 0}</strong></div>
              <div><span>Leave</span><strong>{mix.leave ?? 0}</strong></div>
            </div>
            <div className="st-detail-card">
              <div className="st-detail-row"><span>Today present</span><strong>{summary.todayPresent ?? 0}</strong></div>
              <div className="st-detail-row"><span>Today absent</span><strong>{summary.todayAbsent ?? 0}</strong></div>
              <div className="st-detail-row"><span>Today late</span><strong>{summary.todayLate ?? 0}</strong></div>
            </div>
          </div>
        ) : null}

        {active === "leave" ? (
          <div className="st-rep-detail">
            <div className="st-rep-metrics">
              <div><span>On leave today</span><strong>{summary.onLeave ?? 0}</strong></div>
              <div><span>Recent requests</span><strong>{leaves.length}</strong></div>
            </div>
            {leaves.length === 0 ? (
              <p className="caption">No recent leave requests in this dashboard payload.</p>
            ) : (
              <ul className="st-rep-rows">
                {leaves.slice(0, 12).map((l, i) => (
                  <li key={l._id || l.id || i}>
                    <strong>{l.employeeName || l.fullName || "Employee"}</strong>
                    <span>
                      {l.leaveType || l.type || "Leave"} · {l.status || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {active === "payroll" ? (
          <div className="st-rep-detail">
            <div className="st-rep-metrics">
              <div>
                <span>Monthly payroll</span>
                <strong>₹{Number(summary.monthlyPayroll || 0).toLocaleString("en-IN")}</strong>
              </div>
              <div><span>Status</span><strong>{summary.payrollStatus || "—"}</strong></div>
            </div>
            <div className="st-detail-card">
              <div className="st-detail-row">
                <span>Cycle</span>
                <strong>{summary.payrollCycle?.status || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Awaiting processing</span>
                <strong>{summary.payrollCycle?.employeesAwaitingProcessing ?? 0}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {active === "employee" ? (
          <div className="st-rep-detail">
            <div className="st-rep-metrics">
              <div><span>Active employees</span><strong>{summary.activeEmployees ?? 0}</strong></div>
              <div><span>Departments</span><strong>{workforce.length}</strong></div>
            </div>
            {workforce.length === 0 ? (
              <p className="caption">No department headcount in this period.</p>
            ) : (
              <ul className="st-rep-rows">
                {workforce.map((d, i) => (
                  <li key={d.name || d.department || i}>
                    <strong>{d.name || d.department || "Department"}</strong>
                    <span>{d.count ?? d.headcount ?? 0} people</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {active === "recruitment" ? (
          <div className="st-rep-detail">
            <div className="st-rep-metrics">
              <div><span>Offers</span><strong>{funnel.offersGenerated ?? funnel.total ?? 0}</strong></div>
              <div><span>Accepted</span><strong>{funnel.accepted ?? 0}</strong></div>
              <div><span>Pending</span><strong>{funnel.pending ?? 0}</strong></div>
              <div><span>Declined</span><strong>{funnel.declined ?? funnel.rejected ?? 0}</strong></div>
            </div>
          </div>
        ) : null}

        {active === "assets" ? (
          <div className="st-rep-detail">
            <div className="st-rep-metrics">
              <div><span>Employees</span><strong>{assets.totalEmployees ?? 0}</strong></div>
              <div><span>With assets</span><strong>{assets.employeesWithAssets ?? 0}</strong></div>
              <div><span>With assets %</span><strong>{assets.employeesWithAssetsPct ?? 0}</strong></div>
              <div><span>Without assets</span><strong>{assets.employeesWithoutAssets ?? 0}</strong></div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

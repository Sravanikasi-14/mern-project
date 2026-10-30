import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  MapPin,
  Medal,
  MoreVertical,
  Palmtree,
  Search,
  UserPlus,
  Wallet,
} from "lucide-react";
import EmptyState from "../../components/EmptyState";
import { initialsFrom } from "../../components/SummaryRow";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";

const CATEGORIES = [
  {
    id: "work-hours",
    title: "Work Hours & Shifts",
    sub: "Set work timings, shifts and flexibility",
    path: "/admin/policies/work-hours",
    Icon: Clock3,
    tone: "green",
  },
  {
    id: "leave-types",
    title: "Leave Types & Rules",
    sub: "Manage leave types and eligibility",
    path: "/admin/policies/leave-types",
    Icon: Palmtree,
    tone: "violet",
  },
  {
    id: "holidays",
    title: "Holidays",
    sub: "Configure company holidays",
    path: "/admin/policies/holidays",
    Icon: CalendarDays,
    tone: "coral",
  },
  {
    id: "location",
    title: "Location & Tracking",
    sub: "Set location and tracking policies",
    path: "/admin/policies/location",
    Icon: MapPin,
    tone: "teal",
  },
  {
    id: "payroll",
    title: "Payroll & Salary",
    sub: "Configure salary components and deductions",
    path: "/admin/policies/payroll",
    Icon: Wallet,
    tone: "amber",
  },
  {
    id: "lifecycle",
    title: "Employee Lifecycle",
    sub: "Joining, probation, and employment policies",
    path: "/admin/policies/lifecycle",
    Icon: Briefcase,
    tone: "blue",
  },
  {
    id: "recruitment",
    title: "Recruitment & Offers",
    sub: "Offer letter and hiring policies",
    path: "/admin/policies/recruitment",
    Icon: UserPlus,
    tone: "green",
  },
  {
    id: "documents",
    title: "Documents & Compliance",
    sub: "Document requirements and validity",
    path: "/admin/policies/documents",
    Icon: FileCheck2,
    tone: "violet",
  },
  {
    id: "impact",
    title: "Impact Points Rules",
    sub: "Configure point system and rewards",
    path: "/admin/policies/impact",
    Icon: Medal,
    tone: "coral",
  },
];

export default function HrPoliciesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const notify = useNotify();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter(
      (c) => c.title.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="st-pol">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>HR Policies</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      <section className="st-rep-hero">
        <div>
          <span>Governance templates</span>
          <strong>Company HR Policies</strong>
          <p>{CATEGORIES.length} editable policy sections for your organisation</p>
        </div>
        <div className="st-rep-hero-ico" aria-hidden="true">
          <FileText size={24} strokeWidth={1.85} />
        </div>
      </section>

      <div className="st-att-search">
        <Search size={18} strokeWidth={1.85} aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search policies..."
          aria-label="Search policies"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No policies match your search." />
      ) : (
        <div className="st-rep-list">
          {filtered.map((cat) => {
            const Icon = cat.Icon;
            return (
              <button
                key={cat.id}
                type="button"
                className="st-rep-card"
                onClick={() => navigate(cat.path)}
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
    </div>
  );
}

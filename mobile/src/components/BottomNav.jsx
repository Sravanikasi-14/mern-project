import { useLocation, useNavigate } from "react-router-dom";
import { Building2, Home, LayoutDashboard, Menu, Users } from "lucide-react";
import { useAuth } from "../app/AuthContext";

const EMP = [
  { id: "home", label: "Home", path: "/app", match: ["/app"], Icon: Home },
  { id: "dashboard", label: "Dashboard", path: "/app/dashboard", match: ["/app/dashboard"], Icon: LayoutDashboard },
  { id: "more", label: "More", path: "/app/more", matchPrefix: ["/app/"], Icon: Menu },
];

/** HR bottom nav — same pill chrome as Employee; three destinations */
const HR = [
  {
    id: "home",
    label: "Dashboard",
    path: "/admin/dashboard",
    match: ["/admin/dashboard"],
    Icon: Home,
  },
  {
    id: "employees",
    label: "Employees",
    path: "/admin",
    match: ["/admin"],
    matchPrefix: ["/admin/employees"],
    Icon: Users,
  },
  { id: "more", label: "More", path: "/admin/more", matchPrefix: ["/admin/"], Icon: Menu },
];

const COMPANY = [
  { id: "home", label: "Home", path: "/company", match: ["/company"], Icon: Home },
  {
    id: "organization",
    label: "Org",
    path: "/company/organization",
    match: ["/company/organization"],
    Icon: Building2,
  },
  { id: "more", label: "More", path: "/company", matchPrefix: ["/company/"], Icon: Menu },
];

function isPrimaryActive(item, pathname) {
  if (item.exact) return pathname === item.path;
  if (item.match && item.match.includes(pathname)) return true;
  if (
    item.matchPrefix?.some(
      (prefix) =>
        pathname === prefix ||
        pathname.startsWith(`${prefix}/`) ||
        pathname.startsWith(prefix)
    )
  ) {
    return true;
  }
  if (item.match) return false;
  if (pathname === item.path) return true;
  return pathname.startsWith(`${item.path}/`);
}

function resolveActive(tabs, pathname) {
  const primary = tabs.filter((t) => t.id !== "more");
  const hit = primary.find((item) => isPrimaryActive(item, pathname));
  if (hit) return hit.id;
  return "more";
}

export default function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (!user) return null;

  const isEmployee = user.role === "EMPLOYEE";
  const isCompanyAdmin = user.role === "COMPANY_ADMIN";
  const tabs = isEmployee ? EMP : isCompanyAdmin ? COMPANY : HR;
  const activeId = resolveActive(tabs, location.pathname);

  return (
    <nav
      className={`bottom-nav is-pill${isEmployee ? " is-employee" : isCompanyAdmin ? " is-company" : " is-hr"}`}
      aria-label="Primary"
    >
      {tabs.map((item) => {
        const active = item.id === activeId;
        const TabIcon = item.Icon;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "is-active" : ""}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            onClick={() => {
              const current = `${location.pathname}${location.search || ""}`;
              if (current === item.path) return;
              // Tab roots should replace to avoid endless Back through prior tabs.
              navigate(item.path, { replace: true });
            }}
          >
            <span className="nav-ico" aria-hidden="true">
              <TabIcon size={22} strokeWidth={active ? 2.1 : 1.85} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

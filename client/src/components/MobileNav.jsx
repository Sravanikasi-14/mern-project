import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { EmployeeIcon, IconLogOut } from "./EmployeeIcon";
import "./MobileNav.css";

function Ico({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  home: (
    <Ico>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </Ico>
  ),
  people: (
    <Ico>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Ico>
  ),
  clock: (
    <Ico>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Ico>
  ),
  calendar: (
    <Ico>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Ico>
  ),
  tasks: (
    <Ico>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Ico>
  ),
  more: (
    <Ico>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </Ico>
  ),
  pay: (
    <Ico>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </Ico>
  ),
  assets: (
    <Ico>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </Ico>
  ),
  star: (
    <Ico>
      <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 9 8.5 12 2" />
    </Ico>
  ),
  profile: (
    <Ico>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Ico>
  ),
  file: (
    <Ico>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Ico>
  ),
  settings: (
    <Ico>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Ico>
  ),
  onboard: (
    <Ico>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </Ico>
  ),
};

const EMP_TABS = [
  { id: "home", label: "Home", path: "/app/dashboard", icon: "home", match: ["/app", "/app/dashboard"] },
  { id: "attendance", label: "Attendance", path: "/app/attendance", icon: "clock" },
  { id: "leave", label: "Leave", path: "/app/leave", icon: "calendar" },
  { id: "tasks", label: "Tasks", path: "/app/tasks", icon: "tasks", match: ["/app/tasks", "/app/work-impact"] },
];

const EMP_MORE = [
  { id: "payslips", label: "Payslips", path: "/app/payslips", icon: "pay" },
  { id: "assets", label: "My assets", path: "/app/assets", icon: "assets" },
  { id: "impact", label: "Impact Points", path: "/app/impact-points", icon: "star" },
  { id: "profile", label: "Profile", path: "/app/profile", icon: "profile" },
  { id: "documents", label: "Documents", path: "/app/documents", icon: "file" },
  { id: "settings", label: "Settings", path: "/app/settings", icon: "settings" },
];

const HR_TABS = [
  { id: "home", label: "Home", path: "/admin/dashboard", icon: "home" },
  { id: "people", label: "People", path: "/admin", icon: "people", matchPrefix: "/admin/employees" },
  { id: "attendance", label: "Attendance", path: "/admin/attendance", icon: "clock" },
  { id: "leave", label: "Leave", path: "/admin/leave", icon: "calendar" },
];

const HR_MORE = [
  { id: "offers", label: "Offer letters", path: "/admin/offers", icon: "file" },
  { id: "onboarding", label: "Onboarding", path: "/admin/onboarding", icon: "onboard" },
  { id: "payroll", label: "Payroll", path: "/admin/payroll", icon: "pay" },
  { id: "assets", label: "Assets", path: "/admin/assets", icon: "assets" },
  { id: "work", label: "Work", path: "/admin/work-management", icon: "tasks" },
  { id: "impact", label: "Impact Points", path: "/admin/impact-points", icon: "star" },
  { id: "policies", label: "Policies", path: "/admin/policies", icon: "file" },
  { id: "settings", label: "Settings", path: "/admin/settings", icon: "settings" },
];

function isActive(item, pathname) {
  if (item.match) return item.match.includes(pathname);
  if (item.id === "people") {
    return pathname === "/admin" || pathname.startsWith("/admin/employees");
  }
  if (item.matchPrefix && pathname.startsWith(item.matchPrefix)) return true;
  if (pathname === item.path) return true;
  return item.path !== "/admin" && pathname.startsWith(`${item.path}/`);
}

export default function MobileNav() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  const isHr = user?.role === "HR_ADMIN";
  const tabs = isHr ? HR_TABS : EMP_TABS;
  const moreItems = isHr ? HR_MORE : EMP_MORE;
  const moreActive = moreItems.some((item) => isActive(item, location.pathname));

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  if (!user || (user.role !== "HR_ADMIN" && user.role !== "EMPLOYEE")) {
    return null;
  }

  const go = (path) => {
    setMoreOpen(false);
    if (location.pathname !== path) navigate(path);
  };

  const handleLogout = async () => {
    setMoreOpen(false);
    try {
      const res = await logout();
      if (res && !res.serverRevoked) {
        navigate("/login", { replace: true, state: { logoutWarning: "You have been signed out." } });
      } else {
        navigate("/login", { replace: true });
      }
    } catch {
      navigate("/login", { replace: true });
    }
  };

  return (
    <>
      <nav className="mobile-tabbar" aria-label="Primary">
        {tabs.map((item) => {
          const active = isActive(item, location.pathname);
          return (
            <button
              key={item.id}
              type="button"
              className={`mobile-tabbar-btn${active ? " is-active" : ""}`}
              onClick={() => go(item.path)}
              aria-current={active ? "page" : undefined}
            >
              {isHr ? ICONS[item.icon] : <EmployeeIcon name={item.icon} size={22} strokeWidth={active ? 2.15 : 1.75} />}
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`mobile-tabbar-btn${moreActive || moreOpen ? " is-active" : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          {isHr ? ICONS.more : <EmployeeIcon name="more" size={22} strokeWidth={moreActive || moreOpen ? 2.15 : 1.75} />}
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-more-overlay" role="presentation">
          <button type="button" className="mobile-more-backdrop" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="More destinations">
            <div className="mobile-more-handle" />
            <p className="mobile-more-title">{isHr ? "HR tools" : "More"}</p>
            <ul className="mobile-more-list">
              {moreItems.map((item) => {
                const active = isActive(item, location.pathname);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`mobile-more-item${active ? " is-active" : ""}`}
                      onClick={() => go(item.path)}
                    >
                      <span className="mobile-more-icon">
                        {isHr ? ICONS[item.icon] : <EmployeeIcon name={item.icon} size={20} strokeWidth={active ? 2.15 : 1.75} />}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="mobile-more-logout" onClick={handleLogout}>
              {!isHr && <IconLogOut size={16} />}
              Log out
            </button>
          </div>
        </div>
      )}
    </>
  );
}

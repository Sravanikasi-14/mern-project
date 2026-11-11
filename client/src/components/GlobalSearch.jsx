import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import AuthedAvatar from "./AuthedAvatar";
import { initialsFromName } from "../utils/employeeAvatar";
import "./GlobalSearch.css";

const DEBOUNCE_MS = 280;
const MIN_CHARS = 2;

function groupLabel(key) {
  switch (key) {
    case "employees":
      return "People";
    case "directory":
      return "Directory";
    case "leaves":
      return "Leave requests";
    case "offers":
      return "Offers";
    case "hrAdmins":
      return "HR Admins";
    default:
      return key;
  }
}

/**
 * Header global search — queries existing tenant APIs only.
 * No fabricated results; failures surface as empty groups.
 */
export default function GlobalSearch({ className = "" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const panelId = useId();
  const rootRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState([]);

  const role = user?.role;
  const placeholder = useMemo(() => {
    if (role === "COMPANY_ADMIN") return "Search HR Admins…";
    if (role === "EMPLOYEE") return "Search people directory…";
    return "Search people, leave, offers…";
  }, [role]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setGroups([]);
      setError("");
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const next = await runRoleSearch(role, q);
        if (!cancelled) setGroups(next);
      } catch (err) {
        if (!cancelled) {
          setGroups([]);
          setError(err?.response?.data?.message || "Search failed. Try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, role]);

  const totalHits = groups.reduce((sum, g) => sum + g.items.length, 0);

  const handleSelect = (item) => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    if (item.to) navigate(item.to);
  };

  return (
    <div className={`global-search ${className}`.trim()} ref={rootRef}>
      <form
        className="global-search-form module-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="module-search-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="search"
          className="module-search-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Global search"
          aria-controls={panelId}
          aria-expanded={open}
          autoComplete="off"
        />
        {loading ? <span className="module-search-spinner" aria-label="Searching" role="status" /> : null}
        {query && !loading ? (
          <button
            type="button"
            className="module-search-clear"
            onClick={() => {
              setQuery("");
              setGroups([]);
              setError("");
            }}
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : null}
      </form>

      {open && query.trim().length >= MIN_CHARS ? (
        <div id={panelId} className="global-search-panel" role="listbox" aria-label="Search results">
          {loading ? <p className="global-search-status">Searching…</p> : null}
          {!loading && error ? <p className="global-search-status is-error">{error}</p> : null}
          {!loading && !error && totalHits === 0 ? (
            <p className="global-search-status">No matches in modules you can access.</p>
          ) : null}
          {!loading &&
            groups.map((group) =>
              group.items.length ? (
                <div key={group.key} className="global-search-group">
                  <p className="global-search-group-label">{groupLabel(group.key)}</p>
                  <ul className="global-search-list">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="global-search-item"
                          role="option"
                          onClick={() => handleSelect(item)}
                        >
                          {item.avatar !== undefined || item.employee ? (
                            <AuthedAvatar
                              className="global-search-avatar"
                              employee={item.employee}
                              avatar={item.avatar}
                              name={item.title}
                              initials={initialsFromName(item.title, "?")}
                              alt={item.title}
                            />
                          ) : null}
                          <span className="global-search-item-text">
                            <span className="global-search-item-title">{item.title}</span>
                            {item.subtitle ? (
                              <span className="global-search-item-sub">{item.subtitle}</span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          <p className="global-search-footnote">
            Results use live company data for your role. Page filters remain separate.
          </p>
        </div>
      ) : null}
    </div>
  );
}

async function runRoleSearch(role, q) {
  if (role === "COMPANY_ADMIN") {
    const res = await api.get("/company-admin/hr-admins", {
      params: { search: q, limit: 8, page: 1 },
    });
    const rows = res.data?.items || res.data?.hrAdmins || [];
    return [
      {
        key: "hrAdmins",
        items: rows.slice(0, 8).map((row) => ({
          id: `hr-${row.id || row._id}`,
          title: row.fullName || row.email || "HR Admin",
          subtitle: [
            row.email,
            row.invitationStatus,
            row.isActive === false ? "Inactive" : "Active",
          ]
            .filter(Boolean)
            .join(" · "),
          to: "/admin/hr-management",
        })),
      },
    ];
  }

  if (role === "EMPLOYEE") {
    const res = await api.get("/employees/directory", {
      params: { search: q, page: 1, limit: 8 },
    });
    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    return [
      {
        key: "directory",
        items: rows.slice(0, 8).map((row) => ({
          id: `dir-${row._id || row.id}`,
          title: row.fullName || row.employeeCode || "Colleague",
          subtitle: [row.jobTitle || row.job?.jobTitle, row.department || row.job?.department]
            .filter(Boolean)
            .join(" · "),
          avatar: row.avatar || "",
          employee: row,
          to: "/app/directory",
        })),
      },
    ];
  }

  // HR_ADMIN (and any other authenticated portal using AppHeader)
  const [peopleRes, leaveRes, offerRes] = await Promise.allSettled([
    api.get("/employees", { params: { search: q, page: 1, limit: 6, status: "ALL" } }),
    api.get("/leave-requests", {
      params: { search: q, page: 1, limit: 5, includeSummary: "false" },
    }),
    api.get("/offer-letters", { params: { search: q, page: 1, limit: 5 } }),
  ]);

  const employees =
    peopleRes.status === "fulfilled"
      ? (peopleRes.value.data?.employees || []).slice(0, 6).map((row) => ({
          id: `emp-${row._id}`,
          title: row.fullName || row.employeeCode || "Employee",
          subtitle: [row.employeeCode, row.job?.department, row.job?.jobTitle]
            .filter(Boolean)
            .join(" · "),
          avatar: row.avatar || "",
          employee: row,
          to: `/admin/employees/${row._id}`,
        }))
      : [];

  const leaves =
    leaveRes.status === "fulfilled"
      ? (leaveRes.value.data?.leaveRequests || []).slice(0, 5).map((row) => ({
          id: `leave-${row._id}`,
          title: `${row.employeeName || "Employee"} · ${row.leaveTypeCode || "Leave"}`,
          subtitle: [row.status, row.fromDate || ""].filter(Boolean).join(" · "),
          avatar: row.avatar || row.employee?.avatar || "",
          employee: row.employee || { _id: row.employeeId, avatar: row.avatar },
          to: "/admin/leave",
        }))
      : [];

  const offers =
    offerRes.status === "fulfilled"
      ? (offerRes.value.data?.offerLetters || []).slice(0, 5).map((row) => ({
          id: `offer-${row._id}`,
          title: row.candidate?.fullName || "Offer",
          subtitle: [row.status, row.position, row.candidate?.email].filter(Boolean).join(" · "),
          to: "/admin/hiring",
        }))
      : [];

  return [
    { key: "employees", items: employees },
    { key: "leaves", items: leaves },
    { key: "offers", items: offers },
  ];
}

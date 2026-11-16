import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import AuthedAvatar from "./AuthedAvatar";
import ColleagueProfileModal from "./ColleagueProfileModal";
import { initialsFromName } from "../utils/employeeAvatar";
import "./GlobalSearch.css";

const DEBOUNCE_MS = 280;
const MIN_CHARS = 2;

/**
 * Header trigger + centered people-search modal (backdrop blur).
 * Field visibility is enforced by GET /employees/people-search.
 * Employee Portal opens colleague details in a popup (not Organisation).
 */
export default function GlobalSearch({ className = "" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const panelId = useId();
  const triggerRef = useRef(null);
  const modalInputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState([]);
  const [colleagueId, setColleagueId] = useState(null);

  const role = user?.role;
  const triggerLabel = "Search people…";
  const placeholder = "Search by name, ID, title, email, phone, department…";

  const close = () => {
    setOpen(false);
    setQuery("");
    setPeople([]);
    setError("");
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => modalInputRef.current?.focus(), 30);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < MIN_CHARS) {
      setPeople([]);
      setError("");
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await searchPeople(role, q);
        if (!cancelled) setPeople(rows);
      } catch (err) {
        if (!cancelled) {
          setPeople([]);
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
  }, [query, role, open]);

  const handleSelect = (item) => {
    close();
    if (role === "EMPLOYEE") {
      if (item.isSelf) {
        navigate("/app/profile");
        return;
      }
      if (item.employeeId) {
        setColleagueId(String(item.employeeId));
        return;
      }
    }
    if (item.to) navigate(item.to);
  };

  const modal = open
    ? createPortal(
        <div className="gs-modal-root" role="presentation">
          <button
            type="button"
            className="gs-modal-backdrop"
            aria-label="Close search"
            onClick={close}
          />
          <div
            className="gs-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={panelId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="gs-modal-header">
              <span className="gs-modal-search-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                ref={modalInputRef}
                id={panelId}
                type="search"
                className="gs-modal-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                aria-label="Search people"
                autoComplete="off"
              />
              <kbd className="gs-modal-esc">Esc</kbd>
            </div>

            <div className="gs-modal-body" role="listbox" aria-label="People search results">
              {query.trim().length < MIN_CHARS ? (
                <p className="gs-modal-empty">
                  Search by any detail you can access — name, ID, title, email, phone, department, and more.
                </p>
              ) : null}

              {query.trim().length >= MIN_CHARS && loading ? (
                <p className="gs-modal-status">Searching…</p>
              ) : null}
              {query.trim().length >= MIN_CHARS && !loading && error ? (
                <p className="gs-modal-status is-error">{error}</p>
              ) : null}
              {query.trim().length >= MIN_CHARS && !loading && !error && people.length === 0 ? (
                <p className="gs-modal-status">No people match “{query.trim()}”.</p>
              ) : null}

              {!loading && people.length > 0 ? (
                <ul className="gs-modal-list">
                  {people.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="gs-modal-item"
                        role="option"
                        onClick={() => handleSelect(item)}
                      >
                        {item.showAvatar ? (
                          <AuthedAvatar
                            className="gs-modal-avatar"
                            employee={item.employee}
                            avatar={item.avatar}
                            name={item.title}
                            initials={initialsFromName(item.title, "?")}
                            alt={item.title}
                          />
                        ) : (
                          <span className="gs-modal-avatar is-initials" aria-hidden="true">
                            {initialsFromName(item.title, "?")}
                          </span>
                        )}
                        <span className="gs-modal-item-text">
                          <span className="gs-modal-item-title">{item.title}</span>
                          {item.subtitle ? (
                            <span className="gs-modal-item-sub">{item.subtitle}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className={`global-search${open ? " is-open" : ""} ${className}`.trim()}>
        <button
          ref={triggerRef}
          type="button"
          className="global-search-trigger module-search"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Open people search"
        >
          <span className="module-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <span className="global-search-trigger-label">{triggerLabel}</span>
        </button>
      </div>
      {modal}
      <ColleagueProfileModal
        employeeId={colleagueId}
        open={Boolean(colleagueId)}
        onClose={() => setColleagueId(null)}
      />
    </>
  );
}

function peopleNavigateTo(role, row) {
  const id = row._id || row.id;
  const isSelf =
    row.relationship === "SELF" || row.visibilityTier === "SELF";

  if (role === "EMPLOYEE") {
    if (isSelf) return "/app/profile";
    // Colleague details open in-popup; keep a deep-link fallback for shareable URLs.
    if (id) return `/app/people/${id}`;
    return "/app/dashboard";
  }
  if (role === "COMPANY_ADMIN") return "/admin/hr-management";
  if (id) return `/admin/employees/${id}`;
  return "/admin/employees";
}

function mapPeopleHit(role, row) {
  const title = row.fullName || row.preferredName || row.employeeCode || "Colleague";
  // Subtitle from authorized payload only — if the API omitted a field, we never invent it.
  // HR-expanded hits still carry visibilityTier OTHER; do not use tier to hide present fields.
  const subtitleParts = [
    row.jobTitle,
    row.department,
    row.employeeCode,
    row.email,
    row.phoneNumber,
    row.workLocation,
    row.employmentType,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);

  const hasAvatar = Boolean(row.avatar);
  const employeeId = row._id || row.id || null;
  const isSelf =
    row.relationship === "SELF" || row.visibilityTier === "SELF";

  return {
    id: `person-${employeeId}`,
    employeeId,
    isSelf,
    title,
    subtitle: subtitleParts.join(" · "),
    avatar: hasAvatar ? row.avatar : "",
    employee: row,
    showAvatar: hasAvatar,
    to: peopleNavigateTo(role, row),
  };
}

async function searchPeople(role, q) {
  if (role === "COMPANY_ADMIN") {
    try {
      const res = await api.get("/employees/people-search", {
        params: { q, limit: 10 },
      });
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      if (rows.length) return rows.slice(0, 10).map((row) => mapPeopleHit(role, row));
    } catch {
      /* fall through */
    }

    const res = await api.get("/company-admin/hr-admins", {
      params: { search: q, limit: 8, page: 1 },
    });
    const rows = res.data?.items || res.data?.hrAdmins || [];
    return rows.slice(0, 8).map((row) => ({
      id: `hr-${row.id || row._id}`,
      title: row.fullName || row.email || "HR Admin",
      subtitle: [row.email, row.invitationStatus].filter(Boolean).join(" · "),
      showAvatar: false,
      to: "/admin/hr-management",
    }));
  }

  const res = await api.get("/employees/people-search", {
    params: { q, limit: 10 },
  });
  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  return rows.slice(0, 10).map((row) => mapPeopleHit(role, row));
}

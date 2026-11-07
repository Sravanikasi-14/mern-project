import { useEffect, useId, useMemo, useRef, useState } from "react";
import api from "../services/api";
import "./ReportingManagerSelect.css";

/**
 * Searchable choice of active departments.
 * Clearing is a separate action so an empty search never removes an assignment.
 */
export default function DepartmentSelect({
  departmentId = "",
  departmentName = "",
  linked = false,
  onChange,
  disabled = false,
  label = "Department",
  description = "Choose an active department. Leaving this blank does not remove an existing assignment.",
}) {
  const autoId = useId();
  const inputId = `department-select-${autoId}`;
  const listId = `${inputId}-list`;
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get("/departments")
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data?.departments) ? res.data.departments : [];
        setDepartments(rows.filter((department) => department.isActive !== false));
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err.response?.data?.message || "Departments could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return departments;
    return departments.filter((department) =>
      [department.name, department.code].some((value) => String(value || "").toLowerCase().includes(needle))
    );
  }, [departments, query]);

  const selected = departments.find((department) => String(department.id) === String(departmentId));
  const displayName = selected?.name || departmentName || "";
  const inactiveCurrent = Boolean(departmentId) && !loading && !selected && Boolean(departmentName);
  const canClear = Boolean(departmentId || departmentName);

  const selectDepartment = (department) => {
    onChange?.({
      departmentId: String(department.id),
      departmentName: department.name,
      linked: true,
      clearDepartment: false,
    });
    setQuery("");
    setOpen(false);
  };

  const onSearchKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && filtered[activeIndex]) selectDepartment(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  let valueText = "No department selected";
  if (displayName && (linked || departmentId)) valueText = displayName;
  else if (displayName) valueText = `Not linked: ${displayName}`;

  return (
    <div className={`rm-select${fetchError ? " has-error" : ""}`} ref={rootRef}>
      <label className="rm-select-label" htmlFor={inputId}>{label}</label>
      {description ? <p className="rm-select-description">{description}</p> : null}
      <p className="employee-picker-current">{valueText}</p>
      {inactiveCurrent ? (
        <p className="rm-select-description">
          This department is not active. The current assignment stays until you choose an active department or clear it.
        </p>
      ) : null}
      <input
        id={inputId}
        type="search"
        className="rm-select-search employee-picker-input"
        placeholder="Search active departments"
        value={query}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={onSearchKeyDown}
      />
      {open ? (
        <div className="rm-select-panel" id={listId} role="listbox">
          {loading ? <div className="rm-select-status">Loading departments…</div> : null}
          {!loading && fetchError ? <div className="rm-select-status is-error" role="alert">{fetchError}</div> : null}
          {!loading && !fetchError && filtered.length === 0 ? (
            <div className="rm-select-status">No active departments match.</div>
          ) : null}
          {!loading && !fetchError
            ? filtered.map((department, index) => (
              <button
                key={department.id}
                type="button"
                role="option"
                aria-selected={String(department.id) === String(departmentId)}
                className={`rm-select-option${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectDepartment(department)}
              >
                <strong>{department.name}</strong>
                {department.code ? <span className="rm-select-meta">{department.code}</span> : null}
              </button>
            ))
            : null}
        </div>
      ) : null}
      {canClear ? (
        <button
          type="button"
          className="btn-secondary btn-sm employee-picker-clear"
          disabled={disabled}
          onClick={() => onChange?.({
            departmentId: "",
            departmentName: "",
            linked: false,
            clearDepartment: true,
          })}
        >
          Clear department
        </button>
      ) : null}
    </div>
  );
}

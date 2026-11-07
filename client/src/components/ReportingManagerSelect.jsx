import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import api from "../services/api";
import EmployeePicker from "./EmployeePicker";
import { employeeRecordFromApi } from "./employeePickerState";
import "./ReportingManagerSelect.css";

const NONE = "__none__";
const ALL = "__all__";

function managerLabel(emp) {
  if (!emp) return "";
  const title = emp.job?.jobTitle || emp.jobTitle || "";
  return title ? `${emp.fullName} · ${title}` : emp.fullName || "";
}

function toOption(emp) {
  if (!emp?._id) return null;
  return {
    id: String(emp._id),
    fullName: emp.fullName || "",
    jobTitle: emp.job?.jobTitle || emp.jobTitle || "",
    employeeCode: emp.employeeCode || "",
  };
}

/**
 * Searchable reporting-manager picker.
 *
 * Create/edit (default): value null = no manager; onChange(null | id).
 * Filter mode: value null = all employees; value "none" = unassigned; value id = reports-to.
 */
export default function ReportingManagerSelect(props) {
  if (!props.filterMode) {
    const selected = props.initialSelected ? employeeRecordFromApi(props.initialSelected) : null;
    return (
      <EmployeePicker
        mode="single"
        id={props.id}
        label={props.label === undefined ? "Reporting manager" : props.label}
        description={
          props.description === undefined
            ? "Search by name or employee ID."
            : props.description
        }
        value={props.value ? [String(props.value)] : []}
        selectedRecords={selected ? [selected] : []}
        excludeIds={props.excludeEmployeeId ? [String(props.excludeEmployeeId)] : []}
        allowClear
        clearLabel="No manager"
        disabled={props.disabled}
        error={props.error}
        placeholder="Search by name or employee ID"
        onChange={(ids) => props.onChange?.(ids[0] || null)}
      />
    );
  }
  return <ReportingManagerFilter {...props} />;
}

function ReportingManagerFilter({
  value = null,
  onChange,
  excludeEmployeeId = null,
  initialSelected = null,
  disabled = false,
  error = "",
  label = "Reporting manager",
  description,
  id: idProp,
  filterMode = false,
  compact = false,
}) {
  const helpText =
    description === undefined
      ? filterMode || compact
        ? ""
        : "Who this person reports to. Assignments build the organisation chart and control which colleagues employees can see."
      : description;
  const autoId = useId();
  const inputId = idProp || `rm-select-${autoId}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [selectedCache, setSelectedCache] = useState(() => toOption(initialSelected));
  const rootRef = useRef(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const next = toOption(initialSelected);
    if (next && value && next.id === String(value)) {
      setSelectedCache(next);
    }
  }, [initialSelected, value]);

  const fetchOptions = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setFetchError("");
    try {
      const res = await api.get("/employees", {
        params: {
          status: "ACTIVE",
          page: 1,
          limit: 100,
          includeCompensation: false,
          sortBy: "fullName",
          sortOrder: "asc",
          ...(debounced ? { search: debounced } : {}),
        },
      });
      if (seq !== seqRef.current) return;
      const rows = Array.isArray(res.data?.employees) ? res.data.employees : [];
      const exclude = excludeEmployeeId ? String(excludeEmployeeId) : null;
      setOptions(
        rows
          .filter((e) => e?._id && (!exclude || String(e._id) !== exclude))
          .map(toOption)
          .filter(Boolean)
      );
    } catch (err) {
      if (seq !== seqRef.current) return;
      setFetchError(err.response?.data?.message || "Could not load employees.");
      setOptions([]);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [debounced, excludeEmployeeId]);

  useEffect(() => {
    if (!open) return undefined;
    fetchOptions();
    return undefined;
  }, [open, fetchOptions]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isUnassigned = filterMode ? value === "none" : value == null;
  const isAll = filterMode && (value == null || value === "");
  const managerId = filterMode
    ? value && value !== "none"
      ? String(value)
      : null
    : value
      ? String(value)
      : null;

  const selected = useMemo(() => {
    if (!managerId) return null;
    const fromOpts = options.find((o) => o.id === managerId);
    if (fromOpts) return fromOpts;
    if (selectedCache && selectedCache.id === managerId) return selectedCache;
    return { id: managerId, fullName: "Selected manager", jobTitle: "", employeeCode: "" };
  }, [managerId, options, selectedCache]);

  const pick = (opt) => {
    if (opt === ALL) {
      onChange?.(null);
      setSelectedCache(null);
    } else if (opt === NONE) {
      onChange?.(filterMode ? "none" : null);
      setSelectedCache(null);
    } else {
      onChange?.(opt.id);
      setSelectedCache(opt);
    }
    setOpen(false);
    setQuery("");
  };

  let triggerLabel;
  if (filterMode && isAll) {
    triggerLabel = <span className="rm-select-placeholder">All employees</span>;
  } else if (isUnassigned || (!filterMode && value == null)) {
    triggerLabel = (
      <span className="rm-select-placeholder">
        No manager
      </span>
    );
  } else if (selected) {
    triggerLabel = (
      <span className="rm-select-value">
        <strong>{selected.fullName}</strong>
        {selected.jobTitle ? <span className="rm-select-meta">{selected.jobTitle}</span> : null}
      </span>
    );
  } else {
    triggerLabel = <span className="rm-select-placeholder">All employees</span>;
  }

  return (
    <div className={`rm-select${error ? " has-error" : ""}${compact ? " is-compact" : ""}`} ref={rootRef}>
      {label ? (
        <label className="rm-select-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {helpText ? <p className="rm-select-description">{helpText}</p> : null}

      <button
        type="button"
        id={inputId}
        className="rm-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {triggerLabel}
        <span className="rm-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="rm-select-panel" role="listbox">
          <input
            type="search"
            className="rm-select-search"
            placeholder="Search by name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            aria-label="Search managers"
          />
          {filterMode ? (
            <button
              type="button"
              className={`rm-select-option${isAll ? " is-active" : ""}`}
              role="option"
              aria-selected={isAll}
              onClick={() => pick(ALL)}
            >
              <strong>All employees</strong>
              <span className="rm-select-meta">Clear manager filter</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`rm-select-option${isUnassigned ? " is-active" : ""}`}
            role="option"
            aria-selected={isUnassigned}
            onClick={() => pick(NONE)}
          >
            <strong>No manager</strong>
            <span className="rm-select-meta">
              {filterMode ? "Only people with no manager" : "Remove the current manager"}
            </span>
          </button>
          {loading ? (
            <div className="rm-select-status">Loading…</div>
          ) : fetchError ? (
            <div className="rm-select-status is-error">{fetchError}</div>
          ) : options.length === 0 ? (
            <div className="rm-select-status">No active employees match.</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`rm-select-option${managerId === opt.id ? " is-active" : ""}`}
                role="option"
                aria-selected={managerId === opt.id}
                onClick={() => pick(opt)}
              >
                <strong>{opt.fullName}</strong>
                <span className="rm-select-meta">
                  {[opt.jobTitle, opt.employeeCode].filter(Boolean).join(" · ") || "Team member"}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {error ? <span className="field-error">{error}</span> : null}
      {!error && !compact && selected ? (
        <span className="rm-select-hint">{managerLabel(selected)}</span>
      ) : null}
    </div>
  );
}

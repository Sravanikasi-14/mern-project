import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import api from "../services/api";
import { employeeRecordFromApi, retainSelectedEmployees } from "./employeePickerState";
import "./ReportingManagerSelect.css";

const PAGE_SIZE = 24;
const EMPTY_IDS = [];
const EMPTY_RECORDS = [];

function optionLabel(record) {
  return [record.jobTitle, record.employeeCode].filter(Boolean).join(" · ") || "Employee";
}

/**
 * Searchable employee picker. Single-select and multi-select share this control.
 * Results come from GET /api/employees one page at a time. Scope is applied there.
 */
export default function EmployeePicker({
  mode = "single",
  value = [],
  onChange,
  selectedRecords = EMPTY_RECORDS,
  excludeIds = EMPTY_IDS,
  allowClear = false,
  clearLabel = "Clear selection",
  label = "Employees",
  description = "",
  placeholder = "Search by name or employee ID",
  disabled = false,
  error = "",
  id: idProp,
  activeOnly = true,
}) {
  const autoId = useId();
  const inputId = idProp || `employee-picker-${autoId}`;
  const listId = `${inputId}-list`;
  const multiple = mode === "multiple";
  const valueKey = (value || []).filter(Boolean).map(String).join("|");
  const excludeKey = (excludeIds || []).map(String).join("|");
  const selectedIds = useMemo(() => (valueKey ? [...new Set(valueKey.split("|"))] : EMPTY_IDS), [valueKey]);
  const exclude = useMemo(() => new Set(excludeKey ? excludeKey.split("|") : EMPTY_IDS), [excludeKey]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [records, setRecords] = useState(() => selectedRecords.filter(Boolean));
  const rootRef = useRef(null);
  const seqRef = useRef(0);

  useEffect(() => {
    setRecords((current) => {
      const byId = new Map(current.map((row) => [String(row.id), row]));
      for (const row of selectedRecords || []) {
        if (row?.id) byId.set(String(row.id), { ...byId.get(String(row.id)), ...row });
      }
      const next = selectedIds.map((id) => byId.get(id)).filter(Boolean);
      const signature = (rows) => rows.map((row) => `${row.id}|${row.fullName}|${row.jobTitle}|${row.employeeCode}`).join(";");
      return signature(next) === signature(current) ? current : next;
    });
  }, [selectedRecords, valueKey]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const fetchPage = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setFetchError("");
    try {
      const res = await api.get("/employees", {
        params: {
          page,
          limit: PAGE_SIZE,
          includeCompensation: false,
          sortBy: "fullName",
          sortOrder: "asc",
          ...(activeOnly ? { status: "ACTIVE" } : {}),
          ...(debounced ? { search: debounced } : {}),
        },
      });
      if (seq !== seqRef.current) return;
      const rows = (Array.isArray(res.data?.employees) ? res.data.employees : [])
        .map(employeeRecordFromApi)
        .filter((row) => row && !exclude.has(row.id));
      setOptions(rows);
      setRecords((current) => retainSelectedEmployees(
        current.filter((row) => selectedIds.includes(String(row.id))),
        rows
      ));
      setTotalPages(res.data?.pagination?.totalPages || 1);
      setActiveIndex(0);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setOptions([]);
      setFetchError(err.response?.data?.message || "Employees could not be loaded.");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [activeOnly, debounced, exclude, page, selectedIds]);

  useEffect(() => {
    if (!open) return undefined;
    fetchPage();
    return undefined;
  }, [open, fetchPage]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = useMemo(
    () => selectedIds.map((id) => records.find((row) => row.id === id) || {
      id,
      fullName: "Selected employee",
      jobTitle: "",
      employeeCode: "",
      status: "ACTIVE",
    }),
    [records, selectedIds]
  );

  const emit = (nextRecords) => {
    const unique = [];
    const seen = new Set();
    for (const row of nextRecords) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      unique.push(row);
    }
    setRecords(unique);
    onChange?.(unique.map((row) => row.id), unique);
  };

  const choose = (row) => {
    if (!row || row.status === "INACTIVE") return;
    if (multiple) {
      const exists = selectedIds.includes(row.id);
      emit(exists ? selected.filter((item) => item.id !== row.id) : [...selected, row]);
      return;
    }
    emit([row]);
    setOpen(false);
    setQuery("");
  };

  const remove = (id) => {
    emit(selected.filter((item) => item.id !== id));
  };

  const clear = () => {
    emit([]);
    setOpen(false);
    setQuery("");
  };

  const onSearchKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[activeIndex]) choose(options[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`rm-select employee-picker${error ? " has-error" : ""}`} ref={rootRef}>
      {label ? (
        <label className="rm-select-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {description ? <p className="rm-select-description">{description}</p> : null}

      {selected.length > 0 ? (
        <ul className="employee-picker-chips" aria-label={`Selected ${label || "employees"}`}>
          {selected.map((row) => (
            <li key={row.id}>
              <span>
                <strong>{row.fullName}</strong>
                {row.employeeCode ? <span className="rm-select-meta">{row.employeeCode}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => remove(row.id)}
                disabled={disabled}
                aria-label={`Remove ${row.fullName}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        id={inputId}
        type="search"
        className="rm-select-search employee-picker-input"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[activeIndex] ? `${inputId}-opt-${options[activeIndex].id}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onSearchKeyDown}
      />

      {open ? (
        <div className="rm-select-panel employee-picker-panel" id={listId} role="listbox" aria-multiselectable={multiple || undefined}>
          {allowClear && !multiple ? (
            <button type="button" className="rm-select-option" onClick={clear}>
              <strong>{clearLabel}</strong>
            </button>
          ) : null}
          {loading ? <div className="rm-select-status">Loading people…</div> : null}
          {!loading && fetchError ? <div className="rm-select-status is-error" role="alert">{fetchError}</div> : null}
          {!loading && !fetchError && options.length === 0 ? (
            <div className="rm-select-status">No one matches.</div>
          ) : null}
          {!loading && !fetchError
            ? options.map((row, index) => {
              const chosen = selectedIds.includes(row.id);
              return (
                <button
                  key={row.id}
                  id={`${inputId}-opt-${row.id}`}
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  className={`rm-select-option${chosen || index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(row)}
                >
                  <strong>{row.fullName}</strong>
                  <span className="rm-select-meta">{optionLabel(row)}</span>
                </button>
              );
            })
            : null}
          {totalPages > 1 ? (
            <div className="employee-picker-pages">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Previous
              </button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}

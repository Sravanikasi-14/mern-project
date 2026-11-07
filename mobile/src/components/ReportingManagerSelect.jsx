import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";

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
 * Mobile-friendly searchable reporting manager picker.
 *
 * Create/edit (default): value null = no manager; onChange(null | id).
 * Filter mode: value null = all employees; value "none" = unassigned; value id = reports-to.
 */
export default function ReportingManagerSelect({
  value = null,
  onChange,
  excludeEmployeeId = null,
  initialSelected = null,
  disabled = false,
  error = "",
  label = "Reporting manager",
  description,
  filterMode = false,
}) {
  const helpText =
    description === undefined
      ? filterMode
        ? ""
        : "Who this person reports to. Assignments build the organisation chart and colleague visibility."
      : description;
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [selectedCache, setSelectedCache] = useState(() => toOption(initialSelected));
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const next = toOption(initialSelected);
    if (next && value && next.id === String(value)) setSelectedCache(next);
  }, [initialSelected, value]);

  const load = useCallback(async () => {
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
    load();
  }, [load]);

  const isUnassigned = filterMode ? value === "none" : value == null;
  const isAll = filterMode && (value == null || value === "");
  const managerId =
    filterMode
      ? value && value !== "none"
        ? String(value)
        : null
      : value
        ? String(value)
        : null;

  const selected =
    (managerId && options.find((o) => o.id === managerId)) ||
    (managerId && selectedCache && selectedCache.id === managerId ? selectedCache : null);

  const pickAll = () => {
    onChange?.(null);
    setSelectedCache(null);
  };

  const pickNone = () => {
    onChange?.(filterMode ? "none" : null);
    setSelectedCache(null);
  };

  let statusBlock;
  if (filterMode && isAll) {
    statusBlock = <p className="rm-mobile-empty">All employees</p>;
  } else if (isUnassigned) {
    statusBlock = (
      <p className="rm-mobile-empty">
        {filterMode ? "No reporting manager" : "No reporting manager assigned"}
      </p>
    );
  } else if (selected) {
    statusBlock = (
      <div className="rm-mobile-selected">
        <div>
          <strong>{selected.fullName}</strong>
          <span>
            {[selected.jobTitle, selected.employeeCode].filter(Boolean).join(" · ") || "Team member"}
          </span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled}
          onClick={filterMode ? pickAll : pickNone}
        >
          Clear
        </button>
      </div>
    );
  } else {
    statusBlock = <p className="rm-mobile-empty">All employees</p>;
  }

  return (
    <div className={`rm-mobile${error ? " has-error" : ""}`}>
      <label className="rm-mobile-label">{label}</label>
      {helpText ? <p className="rm-mobile-help">{helpText}</p> : null}
      {statusBlock}

      {filterMode ? (
        <div className="rm-mobile-quick">
          <button
            type="button"
            className={`rm-mobile-chip${isAll ? " is-active" : ""}`}
            disabled={disabled}
            onClick={pickAll}
          >
            All employees
          </button>
          <button
            type="button"
            className={`rm-mobile-chip${isUnassigned ? " is-active" : ""}`}
            disabled={disabled}
            onClick={pickNone}
          >
            No manager
          </button>
        </div>
      ) : null}

      <input
        type="search"
        className="rm-mobile-search"
        placeholder="Search managers by name or code…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search managers"
      />

      <div className="rm-mobile-list" role="listbox">
        {loading ? (
          <p className="caption">Loading…</p>
        ) : fetchError ? (
          <p className="caption" style={{ color: "var(--rose, #c23b3b)" }}>
            {fetchError}
          </p>
        ) : options.length === 0 ? (
          <p className="caption">No active employees match.</p>
        ) : (
          options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={managerId === opt.id}
              className={`rm-mobile-option${managerId === opt.id ? " is-active" : ""}`}
              disabled={disabled}
              onClick={() => {
                onChange?.(opt.id);
                setSelectedCache(opt);
              }}
            >
              <strong>{opt.fullName}</strong>
              <span>{[opt.jobTitle, opt.employeeCode].filter(Boolean).join(" · ") || "Team member"}</span>
            </button>
          ))
        )}
      </div>
      {error ? <span className="field-error">{error}</span> : null}

      <style>{`
        .rm-mobile { display: flex; flex-direction: column; gap: 8px; font-family: var(--font, "Plus Jakarta Sans", system-ui, sans-serif); }
        .rm-mobile-label { font-size: 12px; font-weight: 600; color: var(--muted, #646d67); }
        .rm-mobile-help { margin: 0; font-size: 12px; line-height: 1.45; color: var(--muted, #646d67); }
        .rm-mobile-selected { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--hair, #e6ede8); border-radius: 10px; background: var(--g-100, #e3f2e9); }
        .rm-mobile-selected strong { display: block; font-size: 14px; color: var(--ink, #131a15); }
        .rm-mobile-selected span, .rm-mobile-option span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
        .rm-mobile-empty { margin: 0; font-size: 13px; color: var(--muted); }
        .rm-mobile-quick { display: flex; flex-wrap: wrap; gap: 8px; }
        .rm-mobile-chip { border: 1px solid var(--hair, #e6ede8); background: #fff; color: var(--ink, #131a15); border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .rm-mobile-chip.is-active { background: var(--g-100, #e3f2e9); border-color: var(--g-600, #27865a); color: var(--g-800, #155a37); }
        .rm-mobile-search { width: 100%; padding: 10px 12px; border: 1px solid var(--hair); border-radius: 10px; font: inherit; font-size: 14px; background: #fff; }
        .rm-mobile-list { max-height: 220px; overflow: auto; border: 1px solid var(--hair); border-radius: 10px; background: #fff; }
        .rm-mobile-option { display: block; width: 100%; text-align: left; padding: 12px 14px; border: none; border-bottom: 1px solid var(--hair); background: transparent; font: inherit; cursor: pointer; }
        .rm-mobile-option:last-child { border-bottom: none; }
        .rm-mobile-option.is-active, .rm-mobile-option:active { background: var(--g-100, #e3f2e9); }
        .rm-mobile-option strong { font-size: 14px; color: var(--ink); }
        .rm-mobile.has-error .rm-mobile-search { border-color: var(--rose, #c23b3b); }
      `}</style>
    </div>
  );
}

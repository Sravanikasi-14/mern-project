import { useMemo, useState } from "react";
import { useDesignationCatalog } from "./designationCatalog";
import { applyExplicitDesignation } from "./designationSelection";

/**
 * Free-text title and level, plus an explicit catalog choice.
 * Choosing a catalog title does not replace a custom level.
 */
export default function DesignationFields({
  jobTitle = "",
  jobGrade = "",
  onJobTitleChange,
  onJobGradeChange,
  titleLabel = "Job title",
  gradeLabel = "Job level",
  disabled = false,
  inputClassName = "",
}) {
  const catalog = useDesignationCatalog();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestedGrade, setSuggestedGrade] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((row) => {
      if (row.isActive === false) return false;
      if (!needle) return true;
      return [row.title, row.grade].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [catalog, query]);

  const choose = (row) => {
    const next = applyExplicitDesignation({ jobGrade }, row);
    onJobTitleChange?.(next.jobTitle);
    setSuggestedGrade(next.suggestedGrade);
    setQuery("");
    setOpen(false);
  };

  return (
    <>
      <label>
        {titleLabel}
        <input
          className={inputClassName}
          value={jobTitle}
          disabled={disabled}
          onChange={(event) => {
            setSuggestedGrade("");
            onJobTitleChange?.(event.target.value);
          }}
          placeholder="Type a title or choose one below"
        />
      </label>
      <label>
        {gradeLabel}
        <input
          className={inputClassName}
          value={jobGrade}
          disabled={disabled}
          onChange={(event) => onJobGradeChange?.(event.target.value)}
          placeholder="Optional"
        />
      </label>
      <div className="designation-catalog-picker">
        <label>
          Choose a saved job title
          <input
            type="search"
            value={query}
            disabled={disabled}
            placeholder="Search job titles"
            aria-label="Search job titles"
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
          />
        </label>
        {open ? (
          <div className="rm-select-panel" role="listbox" aria-label="Saved job titles">
            {matches.length === 0 ? (
              <div className="rm-select-status">No saved job titles match. The typed title is kept.</div>
            ) : (
              matches.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  className="rm-select-option"
                  onClick={() => choose(row)}
                >
                  <strong>{row.title}</strong>
                  {row.grade ? <span className="rm-select-meta">{row.grade}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
        {suggestedGrade ? (
          <p className="designation-suggestion" role="status">
            Suggested level is {suggestedGrade}. The current level stays until you choose it.
            <button type="button" className="btn-secondary btn-sm" onClick={() => {
              onJobGradeChange?.(suggestedGrade);
              setSuggestedGrade("");
            }}>
              Use suggested level
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setSuggestedGrade("")}>
              Keep current level
            </button>
          </p>
        ) : (
          <p className="rm-select-description">Choosing a saved title does not change the level.</p>
        )}
      </div>
    </>
  );
}

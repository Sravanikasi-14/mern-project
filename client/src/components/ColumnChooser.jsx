import { useEffect, useId, useRef, useState } from "react";
import "./ColumnChooser.css";

export default function ColumnChooser({ columns, visible, onToggle, onReset, label = "Columns" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="col-chooser" ref={rootRef}>
      <button
        id={btnId}
        type="button"
        className="btn-secondary btn-sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="col-chooser-popover" role="dialog" aria-label="Choose visible columns">
          <div className="col-chooser-list">
            {columns.map((col) => (
              <label key={col.id} className="col-chooser-item">
                <input
                  type="checkbox"
                  checked={Boolean(visible[col.id])}
                  disabled={Boolean(col.essential)}
                  onChange={() => onToggle(col.id)}
                />
                <span>
                  {col.label}
                  {col.essential ? <em className="col-chooser-required"> required</em> : null}
                </span>
              </label>
            ))}
          </div>
          <button type="button" className="btn-secondary btn-sm col-chooser-reset" onClick={onReset}>
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
}

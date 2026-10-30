import { useId, useState } from "react";

export default function Expandable({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={`expandable${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="expandable-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{title}</span>
        <span className="chevron" aria-hidden="true" />
      </button>
      <div id={panelId} className="expandable-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

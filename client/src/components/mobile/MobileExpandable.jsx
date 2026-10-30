import { useId, useState } from "react";

export default function MobileExpandable({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={`m-expandable${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="m-expandable-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{title}</span>
        <span className="m-chevron" aria-hidden="true" />
      </button>
      <div id={panelId} className="m-expandable-body">
        {children}
      </div>
    </div>
  );
}

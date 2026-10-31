import { useEffect, useId, useRef } from "react";
import { IconClose } from "./Icons";
import "./AppModal.css";

/**
 * Shared centered modal for desktop HRMS overlays.
 * Escape + outside-click close (unless locked). Footer slot for actions.
 */
export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  locked = false,
  headerExtra = null,
  footer = null,
  children,
  className = "",
  ariaLabel,
}) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !locked) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeBtn = panelRef.current?.querySelector("[data-app-modal-close]");
    closeBtn?.focus?.();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  const handleBackdrop = () => {
    if (!locked) onClose?.();
  };

  return (
    <div className="app-modal-overlay" onClick={handleBackdrop} role="presentation">
      <div
        ref={panelRef}
        className={`app-modal-panel app-modal-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel || "Dialog" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-modal-header">
          <div className="app-modal-heading">
            {title ? (
              <h2 id={titleId} className="app-modal-title">
                {title}
              </h2>
            ) : null}
            {subtitle ? <p className="app-modal-subtitle">{subtitle}</p> : null}
          </div>
          <div className="app-modal-header-actions">
            {headerExtra}
            <button
              type="button"
              className="app-modal-close"
              data-app-modal-close
              onClick={onClose}
              disabled={locked}
              aria-label="Close"
              title="Close (Esc)"
            >
              <IconClose size={16} />
            </button>
          </div>
        </div>
        <div className="app-modal-body">{children}</div>
        {footer ? <div className="app-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

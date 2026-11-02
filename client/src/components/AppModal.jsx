import { useEffect, useId, useRef } from "react";
import { IconClose } from "./Icons";
import "./AppModal.css";

/**
 * Shared centered modal for desktop HRMS overlays.
 * Escape + outside-click close (unless locked). Footer slot for actions.
 *
 * Focus trap note: open-time focus on the close button must run only when `open`
 * flips to true — never when callback identities change — or controlled inputs
 * inside the modal lose focus after every keystroke.
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
  const onCloseRef = useRef(onClose);
  const lockedRef = useRef(locked);

  useEffect(() => {
    onCloseRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === "Escape" && !lockedRef.current) onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Initial focus only when the dialog opens — skip if focus is already inside.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const closeBtn = panel.querySelector("[data-app-modal-close]");
      closeBtn?.focus?.();
    }

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const handleBackdrop = () => {
    if (!lockedRef.current) onCloseRef.current?.();
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
              onClick={() => onCloseRef.current?.()}
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

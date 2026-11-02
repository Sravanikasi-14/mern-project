import { useEffect, useId, useRef } from "react";

function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Mobile bottom sheet. Setup effect depends on `open` (and titleId), not `onClose`,
 * so typing in sheet inputs does not re-run history push / close-button focus.
 */
export default function MobileSheet({ open, onClose, title, children }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const lastFocus = useRef(null);
  const closedByPop = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    lastFocus.current = document.activeElement;
    closedByPop.current = false;
    const token = `sheet-${titleId}`;
    window.history.pushState({ mobileSheet: token }, "");

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const closeBtn = panel.querySelector("[data-sheet-close]");
      closeBtn?.focus();
    }

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPop = () => {
      closedByPop.current = true;
      onCloseRef.current?.();
    };

    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      if (!closedByPop.current && window.history.state?.mobileSheet === token) {
        window.history.back();
      }
      if (lastFocus.current && typeof lastFocus.current.focus === "function") {
        lastFocus.current.focus();
      }
    };
  }, [open, titleId]);

  if (!open) return null;

  return (
    <div className="m-sheet-root" role="presentation">
      <button
        type="button"
        className="m-sheet-backdrop"
        aria-label="Close"
        onClick={() => onCloseRef.current?.()}
      />
      <div
        ref={panelRef}
        className="m-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="m-sheet-handle" />
        <div className="m-sheet-head">
          <h2 id={titleId} className="m-sheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="m-sheet-close"
            data-sheet-close
            onClick={() => onCloseRef.current?.()}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
}

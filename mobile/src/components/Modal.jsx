import { useEffect, useId, useRef } from "react";

function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
  );
}

/** Shared stack so stacked/swapped modals share one history entry and do not auto-dismiss. */
const modalStack = [];
let historyOwned = false;

function pushModalToken(token) {
  modalStack.push(token);
  if (!historyOwned) {
    window.history.pushState({ mobileModal: true }, "");
    historyOwned = true;
  }
}

function releaseModalToken(token) {
  const idx = modalStack.lastIndexOf(token);
  if (idx >= 0) modalStack.splice(idx, 1);
  if (modalStack.length === 0 && historyOwned) {
    historyOwned = false;
    if (window.history.state?.mobileModal) {
      window.history.back();
    }
  }
}

/**
 * Centered mobile modal/popup. Replaces bottom-sheet / drawer interactions.
 */
export default function Modal({ open, onClose, title, children, footer, size = "md" }) {
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
    const token = `modal-${titleId}`;
    pushModalToken(token);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeBtn = panelRef.current?.querySelector("[data-modal-close]");
    closeBtn?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (modalStack[modalStack.length - 1] === token) {
          onCloseRef.current();
        }
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
      if (modalStack[modalStack.length - 1] !== token) return;
      closedByPop.current = true;
      const idx = modalStack.lastIndexOf(token);
      if (idx >= 0) modalStack.splice(idx, 1);
      if (modalStack.length === 0) {
        historyOwned = false;
      } else {
        window.history.pushState({ mobileModal: true }, "");
        historyOwned = true;
      }
      onCloseRef.current();
    };

    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prevOverflow;
      if (!closedByPop.current) {
        // Defer so a sibling modal opening in the same commit can claim the stack
        // before we release the shared history entry.
        const releaseToken = token;
        queueMicrotask(() => {
          if (modalStack.includes(releaseToken)) {
            releaseModalToken(releaseToken);
          }
        });
      }
      if (lastFocus.current && typeof lastFocus.current.focus === "function") {
        lastFocus.current.focus();
      }
    };
  }, [open, titleId]);

  if (!open) return null;

  return (
    <div className="modal-root" role="presentation">
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        ref={panelRef}
        className={`modal-panel modal-panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div className="modal-head-text">
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="icon-btn" data-modal-close onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

import AppModal from "./AppModal";

/**
 * Shared confirm / result modal for enable-disable style actions.
 * Replaces page-top banners for success and error feedback.
 */
export default function ActionFeedbackModal({
  open,
  mode = "confirm", // confirm | success | error | loading
  title,
  message,
  details = null,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}) {
  const locked = mode === "loading" || busy;
  const footer =
    mode === "confirm" ? (
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </>
    ) : mode === "loading" ? (
      <button type="button" className="btn-secondary" disabled>
        Please wait…
      </button>
    ) : (
      <button type="button" className="btn-primary" onClick={onClose}>
        OK
      </button>
    );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      locked={locked}
      footer={footer}
      className={`action-feedback-modal action-feedback-modal--${mode}`}
    >
      {message ? <p className="action-feedback-message">{message}</p> : null}
      {details}
      {mode === "loading" ? <p className="action-feedback-loading">Processing…</p> : null}
    </AppModal>
  );
}

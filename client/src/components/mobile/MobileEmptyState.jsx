export default function MobileEmptyState({ message, actionLabel, onAction }) {
  return (
    <div className="m-empty">
      <p>{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

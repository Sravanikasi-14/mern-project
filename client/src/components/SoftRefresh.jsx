export default function SoftRefresh({ active, label = "Updating" }) {
  if (!active) return null;
  return (
    <span className="soft-refresh" role="status" aria-live="polite">
      <span className="soft-refresh-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

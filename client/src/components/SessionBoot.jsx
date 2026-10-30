/**
 * Minimal branded boot indicator for auth restore.
 * Avoids the large auth-card / "Signing in" treatment.
 */
export default function SessionBoot({ label = "Loading" }) {
  return (
    <div className="session-boot" role="status" aria-live="polite" aria-label={label}>
      <span className="session-boot-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3c-2.8 3.4-5 6.8-5 10.2A5 5 0 0 0 12 18a5 5 0 0 0 5-4.8C17 9.8 14.8 6.4 12 3Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M12 18v3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="session-boot-spinner" aria-hidden="true" />
    </div>
  );
}

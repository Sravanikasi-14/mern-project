import { LeafIcon } from "./Icon";

/**
 * Minimal branded boot indicator for auth restore.
 * Intentionally avoids the large auth-card / "Signing in" treatment.
 */
export default function SessionBoot({ label = "Loading" }) {
  return (
    <div className="session-boot" role="status" aria-live="polite" aria-label={label}>
      <span className="session-boot-mark" aria-hidden="true">
        <LeafIcon />
      </span>
      <span className="session-boot-spinner" aria-hidden="true" />
    </div>
  );
}

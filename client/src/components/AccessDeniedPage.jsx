import "./AccessDeniedPage.css";

/**
 * Full content-area replacement when a module/route is not permitted.
 * Blank aside from the restricted message — no module tables/cards/data.
 * App shell (sidebar + header) stays via AppLayout.
 */
export default function AccessDeniedPage({
  message = "You don't have permission to view this page.",
}) {
  return (
    <div className="access-denied-page" role="region" aria-live="polite">
      <p className="access-denied-message">{message}</p>
    </div>
  );
}

/**
 * F66 — Chat React Query poll cadence for mobile webviews.
 * Pauses while the document is hidden; resumes when visible.
 */
export function chatPollIntervalMs(baseMs, _query) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return baseMs;
}

/**
 * F66 — Chat React Query poll cadence.
 * Pauses while the document is hidden; resumes when visible (RQ also
 * refetches on window focus by default).
 */
export function chatPollIntervalMs(baseMs, _query) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return baseMs;
}

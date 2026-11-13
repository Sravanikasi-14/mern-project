/**
 * F38: shared poll cadence for attendance / live-tracking queries.
 * Returns `false` to pause React Query refetch while the document is hidden.
 */
export function attendancePollIntervalMs(baseMs, query, { slowWhenEmptyMs = 0, emptyPath } = {}) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  if (slowWhenEmptyMs > 0 && emptyPath && query?.state?.data) {
    const live = emptyPath(query.state.data);
    if (Array.isArray(live) ? live.length === 0 : !live) {
      return slowWhenEmptyMs;
    }
  }
  return baseMs;
}

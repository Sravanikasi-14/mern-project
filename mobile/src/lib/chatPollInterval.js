/**
 * F66 — Chat React Query poll cadence for mobile webviews.
 * Pauses while the document is hidden; stretches the interval while visible but idle.
 */

const IDLE_AFTER_MS = 60_000;
const IDLE_MULTIPLIER = 3;

let lastActivityAt = Date.now();
let activityBound = false;

function bumpActivity() {
  lastActivityAt = Date.now();
}

function ensureActivityTracking() {
  if (activityBound || typeof document === "undefined") return;
  activityBound = true;
  const opts = { passive: true };
  document.addEventListener("pointerdown", bumpActivity, opts);
  document.addEventListener("keydown", bumpActivity, opts);
  document.addEventListener("touchstart", bumpActivity, opts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") bumpActivity();
  });
  bumpActivity();
}

/** Test helper — reset idle clock. */
export function resetChatPollActivityForTests(now = Date.now()) {
  lastActivityAt = now;
}

export function chatPollIntervalMs(baseMs, _query) {
  ensureActivityTracking();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  const base = Math.max(1_000, Number(baseMs) || 10_000);
  const idleFor = Date.now() - lastActivityAt;
  if (idleFor >= IDLE_AFTER_MS) {
    return Math.min(120_000, base * IDLE_MULTIPLIER);
  }
  return base;
}

export const CHAT_LIST_POLL_MS = 30_000;
export const CHAT_ACTIVE_THREAD_POLL_MS = 10_000;
export const CHAT_UNREAD_POLL_MS = 45_000;

/**
 * F64 — Bound SSE connection lifetime under serverless maxDuration.
 * Default 45s leaves headroom under Vercel maxDuration 60s.
 * Clients should reconnect on RECONNECT / connection close (EventSource does).
 */

export const DEFAULT_SSE_HEARTBEAT_MS = 25_000;
export const DEFAULT_SSE_MAX_DURATION_MS = 45_000;

export function resolveSseMaxDurationMs() {
  const raw = Number.parseInt(process.env.SSE_MAX_DURATION_MS || "", 10);
  if (Number.isFinite(raw) && raw >= 5_000) {
    return Math.min(raw, 55_000);
  }
  return DEFAULT_SSE_MAX_DURATION_MS;
}

/**
 * Attach heartbeat + max-lifetime close to an open SSE response.
 * @returns {{ cleanup: () => void }}
 */
export function attachSseLifecycle(req, res, {
  heartbeatMs = DEFAULT_SSE_HEARTBEAT_MS,
  maxDurationMs = resolveSseMaxDurationMs(),
  onCleanup,
} = {}) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    if (typeof onCleanup === "function") onCleanup();
  };

  const heartbeat = setInterval(() => {
    try {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    } catch {
      cleanup();
    }
  }, heartbeatMs);

  const lifetime = setTimeout(() => {
    try {
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            type: "RECONNECT",
            reason: "sse_max_duration",
            retryAfterMs: 250,
          })}\n\n`
        );
        res.end();
      }
    } catch {
      /* already closed */
    } finally {
      // Clear timers/listeners even if the transport never emits req "close".
      cleanup();
    }
  }, Math.max(1, maxDurationMs));

  req.on("close", cleanup);
  return { cleanup, heartbeat, lifetime };
}

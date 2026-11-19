/**
 * Public HTTP summary for external cron callers (Vercel Cron, cron-job.org).
 * Strips per-tenant decisions, employee ids, and other sensitive payloads.
 * Internal logs and audit entries remain the detailed source of truth.
 */

export function toPublicWorkforceCronSummary(result = {}) {
  if (!result || typeof result !== "object") {
    return { success: true };
  }

  if (result.skipped) {
    return {
      success: true,
      skipped: true,
      reason: result.reason || "skipped",
      mode: result.mode || undefined,
      hint: result.hint || undefined,
    };
  }

  const fleet = result.fleet
    ? {
        truncated: Boolean(result.fleet.truncated),
        hasCursor: Boolean(result.fleet.afterCompanyId),
        waveStartedAt: result.fleet.waveStartedAt || null,
        updatedAt: result.fleet.updatedAt || null,
      }
    : undefined;

  return {
    success: true,
    skipped: false,
    mode: result.mode || undefined,
    companies: Number(result.companies) || 0,
    discovered: Number(result.discovered) || 0,
    attempted: Number(result.attempted) || 0,
    successCount: Number(result.successCount) || 0,
    errorCount: Number(result.errorCount) || 0,
    skippedCount: Number(result.skippedCount) || 0,
    pendingRemaining: Number(result.pendingRemaining) || 0,
    truncated: Boolean(result.truncated),
    // Opaque resume cursor for operators / auto-continue (company ObjectId, not PII).
    nextAfterCompanyId: result.nextAfterCompanyId || null,
    waveStartedAt: result.waveStartedAt || null,
    waveResumed: Boolean(result.waveResumed),
    hops: Number(result.hops) || 1,
    chainDepth: Number.isFinite(result.chainDepth) ? result.chainDepth : 0,
    autoContinued: Boolean(result.autoContinued),
    autoContinueEnabled: Boolean(result.autoContinueEnabled),
    continuationStoppedReason: result.continuationStoppedReason || undefined,
    concurrency: result.concurrency,
    budgetMs: result.budgetMs,
    durationMs: Number(result.durationMs) || 0,
    fleet,
  };
}

/**
 * Strict public HTTP summary for the central dispatcher.
 * Nested job summaries are allowlisted — never pass through arbitrary objects.
 */

const JOB_SUMMARY_ALLOW = new Set([
  "mode",
  "skipped",
  "reason",
  "hint",
  "attempted",
  "successCount",
  "errorCount",
  "skippedCount",
  "companies",
  "discovered",
  "pendingRemaining",
  "truncated",
  "hops",
  "chainDepth",
  "autoContinued",
  "autoContinueEnabled",
  "continuationStoppedReason",
  "concurrency",
  "budgetMs",
  "durationMs",
  "waveResumed",
  "companiesScanned",
  "companiesWithDue",
  "dueCount",
  "published",
  "notified",
  "mutations",
  "fleet",
]);

const FLEET_ALLOW = new Set(["truncated", "hasCursor", "waveStartedAt", "updatedAt"]);

function sanitizeFleet(fleet) {
  if (!fleet || typeof fleet !== "object") return undefined;
  const out = {};
  for (const key of FLEET_ALLOW) {
    if (fleet[key] !== undefined) out[key] = fleet[key];
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeJobSummary(summary) {
  if (!summary || typeof summary !== "object") return undefined;
  const out = {};
  for (const key of JOB_SUMMARY_ALLOW) {
    if (summary[key] === undefined) continue;
    if (key === "fleet") {
      const fleet = sanitizeFleet(summary.fleet);
      if (fleet) out.fleet = fleet;
      continue;
    }
    // Never allow arrays/objects that could carry tenant payloads.
    const val = summary[key];
    if (val != null && typeof val === "object" && !Array.isArray(val) && key !== "fleet") {
      continue;
    }
    if (Array.isArray(val)) continue;
    out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

export function toPublicDispatchSummary(result = {}) {
  if (!result || typeof result !== "object") {
    return { success: true };
  }

  const jobs = Array.isArray(result.jobs)
    ? result.jobs.map((j) => ({
        jobKey: j.jobKey,
        name: j.name,
        status: j.status,
        executionMode: j.executionMode,
        durationMs: Number(j.durationMs) || 0,
        reason: j.reason || undefined,
        scheduleAction: j.scheduleAction || undefined,
        summary: sanitizeJobSummary(j.summary),
      }))
    : [];

  return {
    success: true,
    skipped: Boolean(result.skipped),
    reason: result.reason || undefined,
    dispatcherEnabled: Boolean(result.dispatcherEnabled),
    lockAcquired: result.lockAcquired != null ? Boolean(result.lockAcquired) : undefined,
    jobsDue: Number(result.jobsDue) || 0,
    jobsAttempted: Number(result.jobsAttempted) || 0,
    jobsSucceeded: Number(result.jobsSucceeded) || 0,
    jobsFailed: Number(result.jobsFailed) || 0,
    jobsSkipped: Number(result.jobsSkipped) || 0,
    truncated: Boolean(result.truncated),
    budgetMs: result.budgetMs,
    durationMs: Number(result.durationMs) || 0,
    tenantConnectionsOpened: Number(result.tenantConnectionsOpened) || 0,
    jobs,
  };
}

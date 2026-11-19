/**
 * Workforce adapter — always dry-run from the dispatcher (Phase 2).
 * Reuses runSchedulerWithAutoContinue; preserves company locks / fleet / isolation.
 */

import {
  runSchedulerWithAutoContinue,
  schedulerEnabled,
} from "../../workforceScheduler/index.js";
import { toPublicWorkforceCronSummary } from "../../workforceScheduler/publicSummary.js";

/**
 * @param {{ budgetMs?: number, now?: Date, trackTenantOpen?: Function }} options
 */
export async function runWorkforceDispatchAdapter(options = {}) {
  const started = Date.now();
  const budgetMs = Number.isFinite(options.budgetMs) ? Math.max(0, Number(options.budgetMs)) : 15_000;

  if (!schedulerEnabled()) {
    return {
      status: "skipped",
      executionMode: "dry-run",
      reason: "workforce_scheduler_disabled",
      durationMs: Date.now() - started,
      tenantConnectionsOpened: 0,
      summary: toPublicWorkforceCronSummary({
        skipped: true,
        reason: "scheduler_disabled",
        mode: "dry-run",
      }),
    };
  }

  if (budgetMs < 1_000) {
    return {
      status: "skipped",
      executionMode: "dry-run",
      reason: "insufficient_budget",
      durationMs: Date.now() - started,
      tenantConnectionsOpened: 0,
      summary: { skipped: true, reason: "insufficient_budget", mode: "dry-run" },
    };
  }

  // Force dry-run — dispatcher must not apply assignments in Phase 2.
  const result = await runSchedulerWithAutoContinue({
    mode: "dry-run",
    budgetMs,
    concurrency: 1,
    autoContinue: false,
    now: options.now,
  });

  // When enabled, the multi-tenant path opens tenant scopes.
  const tenantConnectionsOpened = result?.skipped ? 0 : Number(result?.attempted) || 0;
  if (typeof options.trackTenantOpen === "function" && tenantConnectionsOpened > 0) {
    options.trackTenantOpen(tenantConnectionsOpened);
  }

  const summary = toPublicWorkforceCronSummary({ ...result, mode: "dry-run" });
  const truncated =
    Boolean(result?.truncated) ||
    Boolean(summary?.truncated) ||
    Boolean(result?.fleet?.truncated) ||
    (Number(result?.pendingRemaining) || 0) > 0;

  return {
    status: result?.skipped ? "skipped" : "ok",
    executionMode: "dry-run",
    reason:
      truncated && !result?.skipped
        ? "budget_exhausted"
        : result?.reason || result?.continuationStoppedReason || undefined,
    truncated,
    durationMs: Date.now() - started,
    tenantConnectionsOpened,
    summary: { ...summary, truncated },
  };
}

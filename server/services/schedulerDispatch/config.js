/**
 * Central HRMS cron dispatcher configuration.
 * External trigger (cron-job.org) may poll every 15 minutes; individual jobs
 * keep independent daily schedules via nextRunAt.
 */

export const DISPATCH_LOCK_ID = "scheduler-dispatch-lock";
export const DISPATCH_LOCK_COLLECTION = "scheduler_dispatch_locks";
export const DISPATCH_JOB_COLLECTION = "scheduler_dispatch_jobs";
export const DISPATCH_HISTORY_COLLECTION = "scheduler_dispatch_history";

/** Hard ceiling for one HTTP dispatch (cron-job.org ~30s client timeout). */
export const DISPATCH_MAX_BUDGET_MS = 22_000;

/** Retry delay when work is incomplete / failed / workforce disabled. */
export const DISPATCH_RETRY_MS = 15 * 60 * 1000;

/** Lock must outlive max budget by this margin (no stolen lock mid-run). */
export const DISPATCH_LOCK_SAFETY_MS = 30_000;

export const JOB_KEYS = Object.freeze({
  WORKFORCE: "workforce-scheduler",
  ANNOUNCEMENTS: "announcements-publisher",
});

export const SCHEDULE_ACTIONS = Object.freeze({
  ADVANCE_DAILY: "advance_daily",
  RETRY_15M: "retry_15m",
  PRESERVE: "preserve",
});

export function dispatcherEnabled() {
  return String(process.env.SCHEDULER_DISPATCH_ENABLED || "").toLowerCase() === "true";
}

export function dispatcherBudgetMs() {
  const n = Number(process.env.SCHEDULER_DISPATCH_BUDGET_MS);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(DISPATCH_MAX_BUDGET_MS, Math.floor(n));
  }
  return DISPATCH_MAX_BUDGET_MS;
}

/** Never allow request/env to exceed DISPATCH_MAX_BUDGET_MS. */
export function clampDispatcherBudgetMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return dispatcherBudgetMs();
  return Math.min(DISPATCH_MAX_BUDGET_MS, Math.floor(n));
}

export function dispatcherLockTtlMs() {
  const n = Number(process.env.SCHEDULER_DISPATCH_LOCK_MS);
  const configured = Number.isFinite(n) && n > 0 ? Math.floor(n) : 60_000;
  // Always at least maxBudget + safety so expiry cannot precede execution end.
  return Math.max(configured, DISPATCH_MAX_BUDGET_MS + DISPATCH_LOCK_SAFETY_MS);
}

export function dispatcherLockTtlForBudget(budgetMs) {
  const budget = clampDispatcherBudgetMs(budgetMs);
  return Math.max(dispatcherLockTtlMs(), budget + DISPATCH_LOCK_SAFETY_MS);
}

export function dispatcherHistoryRetention() {
  const n = Number(process.env.SCHEDULER_DISPATCH_HISTORY_LIMIT);
  if (Number.isFinite(n) && n > 0) return Math.min(500, Math.floor(n));
  return 100;
}

/** Seed definitions — daily local times in Asia/Kolkata (IST). */
export function defaultJobDefinitions() {
  return [
    {
      _id: JOB_KEYS.WORKFORCE,
      name: "Workforce Scheduler",
      enabled: true,
      timezone: "Asia/Kolkata",
      schedule: { kind: "daily", hour: 7, minute: 30 },
      executionMode: "dry-run",
      description: "Multi-tenant workforce task scheduling (dry-run via dispatcher).",
    },
    {
      _id: JOB_KEYS.ANNOUNCEMENTS,
      name: "Announcements Publisher",
      enabled: true,
      timezone: "Asia/Kolkata",
      schedule: { kind: "daily", hour: 8, minute: 30 },
      executionMode: "detect-only",
      description: "Detect due announcements without publishing or notifying.",
    },
  ];
}

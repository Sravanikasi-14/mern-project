/**
 * Workforce Task Scheduling Engine — configuration and documented weights.
 *
 * Feature flags (env):
 * - WORKFORCE_SCHEDULER_ENABLED: master switch (default false)
 * - WORKFORCE_SCHEDULER_MODE: "dry-run" | "apply" (default "dry-run")
 * - WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS: soft capacity per employee (default 5)
 * - WORKFORCE_SCHEDULER_AUTO_PRIORITIES: CSV of priorities eligible for auto-assign
 *   (default "LOW,MEDIUM"). HIGH/CRITICAL always require manager approval.
 * - WORKFORCE_SCHEDULER_LOCK_MS: company run lock TTL (default 90000)
 * - WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY: max parallel tenants per invocation (default 2)
 * - WORKFORCE_SCHEDULER_BUDGET_MS: wall-clock budget per HTTP invocation (default 50000)
 * - WORKFORCE_SCHEDULER_MAX_COMPANIES: optional hard cap of tenants per invocation
 * - WORKFORCE_SCHEDULER_WAVE_STALE_MS: abandon truncated wave after this age (default 24h)
 * - WORKFORCE_SCHEDULER_AUTO_CONTINUE: when true, truncated waves continue in-process
 *   up to MAX_CHAIN_DEPTH (default false). Prefer lower BUDGET_MS so multiple hops fit
 *   under the host maxDuration (Vercel 60s).
 * - WORKFORCE_SCHEDULER_MAX_CHAIN_DEPTH: max continuation hops after the first run (default 3)
 * - WORKFORCE_SCHEDULER_CHAIN_BUDGET_MS: wall-clock for the whole chain in one invocation
 *   (default 55000 — headroom under Vercel maxDuration 60s)
 * - WORKFORCE_SCHEDULER_MIN_HOP_BUDGET_MS: skip another hop if remaining time is below this
 *   (default 5000)
 * - WORKFORCE_SCHEDULER_CONTINUE_VIA_HTTP: optional awaited HTTP self-continue when the
 *   in-process chain stops early but the wave is still truncated (default false)
 * - WORKFORCE_SCHEDULER_CONTINUE_TIMEOUT_MS: HTTP continue AbortSignal timeout (default 55000)
 * - WORKFORCE_SCHEDULER_BASE_URL: absolute origin for HTTP continue (else VERCEL_URL)
 *
 * Scoring weights (validated against unit tests; sum of employee score factors ≈ 1.0):
 * - remainingCapacity: 0.40 — prefer employees with more free slots
 * - lowUtilization: 0.30 — prefer lower current load / capacity ratio
 * - skillFit: 0.20 — fraction of requiredSkills matched (1.0 if none required)
 * - continuity: 0.10 — same department/project as task when available
 */

export const SCHEDULER_WEIGHTS = Object.freeze({
  remainingCapacity: 0.4,
  lowUtilization: 0.3,
  skillFit: 0.2,
  continuity: 0.1,
});

export const PRIORITY_RANK = Object.freeze({
  CRITICAL: 400,
  HIGH: 300,
  MEDIUM: 200,
  LOW: 100,
});

/** Deadline urgency boost: points added as deadline approaches (per day remaining). */
export const DEADLINE_URGENCY = Object.freeze({
  overdue: 500,
  within1Day: 200,
  within3Days: 100,
  within7Days: 40,
  later: 0,
});

export function schedulerEnabled() {
  return String(process.env.WORKFORCE_SCHEDULER_ENABLED || "").toLowerCase() === "true";
}

export function schedulerMode() {
  const mode = String(process.env.WORKFORCE_SCHEDULER_MODE || "dry-run").toLowerCase();
  return mode === "apply" ? "apply" : "dry-run";
}

export function maxActiveTasks() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export function autoAssignPriorities() {
  const raw = process.env.WORKFORCE_SCHEDULER_AUTO_PRIORITIES || "LOW,MEDIUM";
  return new Set(
    raw
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean)
  );
}

export function lockTtlMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_LOCK_MS);
  // Default 90s: covers one company under Vercel maxDuration=60 with headroom,
  // without holding a stuck lock for 4 minutes after a killed invocation.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90_000;
}

/** Bounded parallel tenant runs within one cron/HTTP invocation (never unbounded). */
export function companyConcurrency() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_COMPANY_CONCURRENCY);
  if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
  return 2;
}

/**
 * Wall-clock budget for one multi-tenant invocation (ms).
 * Leave headroom under Vercel maxDuration (60s) for response serialization.
 */
export function schedulerBudgetMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50_000;
}

/**
 * F53 — Per-tenant wall-clock cap within a multi-tenant wave (ms).
 * Prevents one slow company from consuming the entire fleet budget.
 * Truncated tenants keep lastRunAt unchanged so the next wave resumes them.
 */
export function perCompanyBudgetMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_PER_COMPANY_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15_000;
}

/** Optional hard cap on companies processed per invocation (0 = no cap beyond budget). */
export function maxCompaniesPerInvocation() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_MAX_COMPANIES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** NEW-S1 — feature-flagged automatic continuation after truncation (default off). */
export function schedulerAutoContinue() {
  return String(process.env.WORKFORCE_SCHEDULER_AUTO_CONTINUE || "").toLowerCase() === "true";
}

/**
 * NEW-S1 — max continuation hops after the initial run (default 3).
 * Total runs in one chain ≤ 1 + maxChainDepth.
 */
export function schedulerMaxChainDepth() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_MAX_CHAIN_DEPTH);
  if (Number.isFinite(n) && n >= 0) return Math.min(20, Math.floor(n));
  return 3;
}

/** Wall-clock for the entire in-process chain (default 55s under Vercel 60s). */
export function schedulerChainBudgetMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_CHAIN_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 55_000;
}

/** Do not start another hop if remaining chain time is below this (default 5s). */
export function schedulerMinHopBudgetMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_MIN_HOP_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5_000;
}

/**
 * Optional awaited HTTP self-continue when in-process hops stop early.
 * Default false — avoids depending on cross-invocation HTTP under serverless.
 */
export function schedulerContinueViaHttp() {
  return String(process.env.WORKFORCE_SCHEDULER_CONTINUE_VIA_HTTP || "").toLowerCase() === "true";
}

export function schedulerContinueTimeoutMs() {
  const n = Number(process.env.WORKFORCE_SCHEDULER_CONTINUE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 55_000;
}

/** Origin for HTTP continuation (WORKFORCE_SCHEDULER_BASE_URL or https://VERCEL_URL). */
export function schedulerContinueBaseUrl() {
  const explicit = String(process.env.WORKFORCE_SCHEDULER_BASE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = String(process.env.VERCEL_URL || "").trim().replace(/\/$/, "");
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "";
}

/**
 * Workforce Task Scheduling Engine — configuration and documented weights.
 *
 * Feature flags (env):
 * - WORKFORCE_SCHEDULER_ENABLED: master switch (default false)
 * - WORKFORCE_SCHEDULER_MODE: "dry-run" | "apply" (default "dry-run")
 * - WORKFORCE_SCHEDULER_MAX_ACTIVE_TASKS: soft capacity per employee (default 5)
 * - WORKFORCE_SCHEDULER_AUTO_PRIORITIES: CSV of priorities eligible for auto-assign
 *   (default "LOW,MEDIUM"). HIGH/CRITICAL always require manager approval.
 * - WORKFORCE_SCHEDULER_LOCK_MS: company run lock TTL (default 240000)
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
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 240_000;
}

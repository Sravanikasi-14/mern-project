import { SCHEDULE_ACTIONS } from "./config.js";

/**
 * Decide how to update nextRunAt after an adapter returns.
 * Pre-adapter budget exhaustion and lock contention are handled by the caller
 * (PRESERVE — do not call this).
 */
export function classifyJobScheduleAction(adapterResult = {}) {
  const status = adapterResult.status || "error";
  const reason = adapterResult.reason || "";
  const summary = adapterResult.summary && typeof adapterResult.summary === "object"
    ? adapterResult.summary
    : {};

  if (status === "error") return SCHEDULE_ACTIONS.RETRY_15M;

  if (reason === "workforce_scheduler_disabled") return SCHEDULE_ACTIONS.RETRY_15M;

  if (reason === "insufficient_budget") return SCHEDULE_ACTIONS.RETRY_15M;

  if (reason === "budget_exhausted" || summary.truncated === true || adapterResult.truncated === true) {
    return SCHEDULE_ACTIONS.RETRY_15M;
  }

  if (status === "ok") return SCHEDULE_ACTIONS.ADVANCE_DAILY;

  // Conservative: unknown skips retry soon rather than skipping a day.
  if (status === "skipped") return SCHEDULE_ACTIONS.RETRY_15M;

  return SCHEDULE_ACTIONS.RETRY_15M;
}

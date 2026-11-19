import { cronAuthorized } from "../utils/cronAuth.js";
import { HttpError } from "../utils/httpError.js";
import {
  runSchedulerDispatch,
  toPublicDispatchSummary,
  clampDispatcherBudgetMs,
  dispatcherBudgetMs,
} from "../services/schedulerDispatch/index.js";

/**
 * Central cron dispatcher — Bearer CRON_SECRET only.
 * Safe for 15-minute external polling; runs only due jobs.
 */
export async function runSchedulerDispatchCron(req, res, next) {
  try {
    const verdict = cronAuthorized(req);
    if (verdict === "unconfigured") {
      throw new HttpError(503, "Cron authentication is not configured.", {
        code: "CRON_UNCONFIGURED",
      });
    }
    if (verdict !== "ok") {
      throw new HttpError(401, "Unauthorized", { code: "CRON_UNAUTHORIZED" });
    }

    const budgetRaw = req.query.budgetMs ?? req.body?.budgetMs;
    // H3 — never trust request budget to exceed server maximum (22s).
    const budgetMs =
      budgetRaw != null && budgetRaw !== ""
        ? clampDispatcherBudgetMs(budgetRaw)
        : dispatcherBudgetMs();

    const result = await runSchedulerDispatch({
      budgetMs,
      holder: "http-dispatch",
    });

    // Service already returns a sanitized public summary; re-run through the
    // helper so accidental raw fields never leak if internals change.
    res.status(200).json(toPublicDispatchSummary(result));
  } catch (error) {
    if (!error?.status || error.status >= 500) {
      console.error("[scheduler-dispatch] failed", error?.message || error);
    }
    next(error);
  }
}

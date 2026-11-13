import { HttpError } from "../utils/httpError.js";
import { cronAuthorized } from "../services/announcementService.js";
import {
  runSchedulerForAllCompanies,
  runCompanyScheduler,
  schedulerEnabled,
  schedulerMode,
} from "../services/workforceScheduler/index.js";
import { approveSchedulerAssignmentService } from "../services/workManagementService.js";

/**
 * Secure cron entry — company-by-company scheduling.
 * Auth: Bearer CRON_SECRET (same pattern as announcement publish-due).
 */
export async function runWorkforceSchedulerCron(req, res, next) {
  try {
    const verdict = cronAuthorized(req);
    if (verdict === "unconfigured") {
      throw new HttpError(503, "Workforce scheduler cron is not configured.");
    }
    if (verdict !== "ok") {
      throw new HttpError(401, "Unauthorized");
    }

    if (!schedulerEnabled()) {
      return res.json({
        success: true,
        skipped: true,
        reason: "scheduler_disabled",
        mode: schedulerMode(),
        hint: "Set WORKFORCE_SCHEDULER_ENABLED=true to enable.",
      });
    }

    const forceDryRun = String(req.query.dryRun || req.body?.dryRun || "").toLowerCase() === "true";
    const mode = forceDryRun ? "dry-run" : schedulerMode();
    // F41: optional resume cursor + budget/concurrency overrides (cron-authenticated only).
    const afterCompanyId =
      req.query.afterCompanyId || req.body?.afterCompanyId || null;
    const budgetMsRaw = req.query.budgetMs ?? req.body?.budgetMs;
    const concurrencyRaw = req.query.concurrency ?? req.body?.concurrency;
    const maxCompaniesRaw = req.query.maxCompanies ?? req.body?.maxCompanies;
    const budgetMs = budgetMsRaw != null && budgetMsRaw !== "" ? Number(budgetMsRaw) : undefined;
    const concurrency =
      concurrencyRaw != null && concurrencyRaw !== "" ? Number(concurrencyRaw) : undefined;
    const maxCompanies =
      maxCompaniesRaw != null && maxCompaniesRaw !== "" ? Number(maxCompaniesRaw) : undefined;

    console.info("[workforce-scheduler] cron start", {
      mode,
      afterCompanyId: afterCompanyId ? String(afterCompanyId) : null,
    });
    const result = await runSchedulerForAllCompanies({
      mode,
      afterCompanyId,
      ...(Number.isFinite(budgetMs) ? { budgetMs } : {}),
      ...(Number.isFinite(concurrency) ? { concurrency } : {}),
      ...(Number.isFinite(maxCompanies) ? { maxCompanies } : {}),
    });
    console.info("[workforce-scheduler] cron done", {
      mode,
      skipped: result.skipped,
      companies: result.companies,
      attempted: result.attempted,
      truncated: result.truncated,
      nextAfterCompanyId: result.nextAfterCompanyId || null,
      reason: result.reason,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    if (!error?.status || error.status >= 500) {
      console.error("[workforce-scheduler] cron failed", error?.message || error);
    }
    next(error);
  }
}

/**
 * HR-triggered dry-run / apply for the current company (feature-flagged).
 */
export async function runWorkforceSchedulerForCompany(req, res, next) {
  try {
    if (!schedulerEnabled()) {
      throw new HttpError(503, "Workforce scheduler is disabled.");
    }
    const company = req.auth.company;
    const dryRun = String(req.query.dryRun || req.body?.dryRun || "true").toLowerCase() !== "false";
    const result = await runCompanyScheduler(company, {
      mode: dryRun ? "dry-run" : schedulerMode() === "apply" && !dryRun ? "apply" : "dry-run",
      force: true,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * Approve a pending scheduler proposal for a task (uses existing assign path).
 */
export async function approveWorkforceSchedulerAssignment(req, res, next) {
  try {
    const result = await approveSchedulerAssignmentService({
      models: req.auth.models,
      user: req.auth.user,
      taskId: req.params.id,
      hrAccess: req.hrAccess,
      company: req.auth.company,
    });
    res.json({
      success: true,
      message: "Scheduler proposal approved and task assigned",
      task: result.task,
    });
  } catch (error) {
    next(error);
  }
}

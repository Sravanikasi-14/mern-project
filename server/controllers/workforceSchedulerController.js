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
    console.info("[workforce-scheduler] cron start", { mode });
    const result = await runSchedulerForAllCompanies({ mode });
    console.info("[workforce-scheduler] cron done", {
      mode,
      skipped: result.skipped,
      companies: result.companies,
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

import { HttpError } from "../utils/httpError.js";
import { cronAuthorized } from "../utils/cronAuth.js";
import {
  runCompanyScheduler,
  schedulerEnabled,
  schedulerMode,
} from "../services/workforceScheduler/index.js";
import {
  normalizeChainDepth,
  runSchedulerWithAutoContinue,
} from "../services/workforceScheduler/autoContinue.js";
import { toPublicWorkforceCronSummary } from "../services/workforceScheduler/publicSummary.js";
import { approveSchedulerAssignmentService } from "../services/workManagementService.js";

/**
 * Secure cron entry — company-by-company scheduling.
 * Auth: Authorization Bearer CRON_SECRET (Vercel Cron / cron-job.org).
 * NEW-S1: when WORKFORCE_SCHEDULER_AUTO_CONTINUE=true and the wave is truncated,
 * awaited in-process hops continue the same wave (no fire-and-forget).
 *
 * HTTP response is a public aggregate summary only — no employee/decision payloads.
 */
export async function runWorkforceSchedulerCron(req, res, next) {
  try {
    const verdict = cronAuthorized(req);
    if (verdict === "unconfigured") {
      throw new HttpError(503, "Workforce scheduler cron is not configured.", {
        code: "CRON_UNCONFIGURED",
      });
    }
    if (verdict !== "ok") {
      throw new HttpError(401, "Unauthorized", { code: "CRON_UNAUTHORIZED" });
    }

    if (!schedulerEnabled()) {
      return res.status(200).json(
        toPublicWorkforceCronSummary({
          skipped: true,
          reason: "scheduler_disabled",
          mode: schedulerMode(),
          hint: "Set WORKFORCE_SCHEDULER_ENABLED=true to enable.",
        })
      );
    }

    const forceDryRun = String(req.query.dryRun || req.body?.dryRun || "").toLowerCase() === "true";
    const mode = forceDryRun ? "dry-run" : schedulerMode();
    // F41: optional resume cursor + budget/concurrency overrides (cron-authenticated only).
    const afterCompanyId =
      req.query.afterCompanyId || req.body?.afterCompanyId || null;
    const budgetMsRaw = req.query.budgetMs ?? req.body?.budgetMs;
    const concurrencyRaw = req.query.concurrency ?? req.body?.concurrency;
    const maxCompaniesRaw = req.query.maxCompanies ?? req.body?.maxCompanies;
    const chainDepthRaw = req.query.chainDepth ?? req.body?.chainDepth;
    const waveStartedAtRaw = req.query.waveStartedAt ?? req.body?.waveStartedAt;
    const budgetMs = budgetMsRaw != null && budgetMsRaw !== "" ? Number(budgetMsRaw) : undefined;
    const concurrency =
      concurrencyRaw != null && concurrencyRaw !== "" ? Number(concurrencyRaw) : undefined;
    const maxCompanies =
      maxCompaniesRaw != null && maxCompaniesRaw !== "" ? Number(maxCompaniesRaw) : undefined;
    const chainDepth = normalizeChainDepth(chainDepthRaw);
    const waveStartedAt = waveStartedAtRaw ? new Date(waveStartedAtRaw) : undefined;
    const waveStartedAtValid =
      waveStartedAt && !Number.isNaN(waveStartedAt.getTime()) ? waveStartedAt : undefined;

    console.info("[workforce-scheduler] cron start", {
      mode,
      method: req.method,
      afterCompanyId: afterCompanyId ? String(afterCompanyId) : null,
      chainDepth,
    });
    const result = await runSchedulerWithAutoContinue({
      mode,
      afterCompanyId: afterCompanyId ? String(afterCompanyId) : null,
      chainDepth,
      ...(waveStartedAtValid ? { waveStartedAt: waveStartedAtValid } : {}),
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
      hops: result.hops,
      chainDepth: result.chainDepth,
      autoContinued: result.autoContinued,
      continuationStoppedReason: result.continuationStoppedReason,
      reason: result.reason,
      durationMs: result.durationMs,
    });

    res.status(200).json(toPublicWorkforceCronSummary({ ...result, mode }));
  } catch (error) {
    // Never log Authorization headers or CRON_SECRET values.
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

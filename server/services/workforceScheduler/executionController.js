import crypto from "crypto";
import Company, { COMPANY_STATUSES } from "../../models/Company.js";
import { getCompanyModels, runWithTenantConnectionScope } from "../../config/db.js";
import { resolveCompanyTimezone, getCompanyBusinessDate } from "../../utils/companyTime.js";
import {
  companyConcurrency,
  lockTtlMs,
  maxActiveTasks,
  maxCompaniesPerInvocation,
  perCompanyBudgetMs,
  schedulerBudgetMs,
  schedulerEnabled,
  schedulerMode,
} from "./config.js";
import { loadAssignableTaskQueue } from "./taskQueue.js";
import { sortTasksByPriority } from "./priorityResolver.js";
import { calculateWorkloadByEmployee, applyAssignmentToWorkload } from "./workload.js";
import { decideAssignment, ASSIGNMENT_PATHS } from "./strategy.js";
import { recordPendingApproval } from "./approvalHandler.js";
import {
  ELIGIBLE_EMPLOYEE_SELECT,
  loadOnLeaveEmployeeIds,
} from "./eligibility.js";
import {
  beginOrResumeSchedulerWave,
  clearFleetProgress,
  companyNeedsSchedulerRun,
  contiguousCompletedCursor,
  loadFleetProgress,
  saveFleetProgress,
} from "./fleetProgress.js";
import { EMPLOYEE_STATUSES } from "../../models/Employee.js";

/**
 * Acquire per-company run lock on the central Company document (no new collection).
 */
export async function acquireCompanySchedulerLock(companyId, ttlMs = lockTtlMs()) {
  const token = crypto.randomUUID();
  const now = new Date();
  const locked = await Company.findOneAndUpdate(
    {
      _id: companyId,
      $or: [
        { "config.workforceScheduler.lockUntil": { $lte: now } },
        { "config.workforceScheduler.lockUntil": null },
        { "config.workforceScheduler.lockUntil": { $exists: false } },
      ],
    },
    {
      $set: {
        "config.workforceScheduler.lockUntil": new Date(now.getTime() + ttlMs),
        "config.workforceScheduler.lockToken": token,
      },
    },
    { returnDocument: "after" }
  );
  return locked ? { acquired: true, token } : { acquired: false, token: null };
}

export async function releaseCompanySchedulerLock(companyId, token) {
  if (!token) return;
  await Company.updateOne(
    {
      _id: companyId,
      "config.workforceScheduler.lockToken": token,
    },
    {
      $set: {
        "config.workforceScheduler.lockUntil": null,
        "config.workforceScheduler.lockToken": "",
      },
    }
  );
}

async function logSchedulerOutcome(models, { companyId, summary, actorEmail = "system@scheduler" }) {
  const { AuditLog } = models;
  if (!AuditLog) return;
  try {
    await AuditLog.create({
      actorUserId: null,
      actorEmail,
      actorRole: "SYSTEM",
      action: "WORKFORCE_SCHEDULER_RUN",
      targetType: "Company",
      targetId: companyId,
      changes: summary,
      timestamp: new Date(),
    });
  } catch {
    // non-blocking
  }
}

function isPastDeadline(deadline) {
  return Boolean(deadline) && Date.now() >= Number(deadline);
}

/**
 * Fair multi-tenant order:
 * 1) mid-queue truncated companies first (do not abandon them)
 * 2) oldest/null lastRunAt
 * 3) _id
 * Optional afterCompanyId slices the ordered list for explicit resume.
 */
export function orderCompaniesForScheduler(companies, { afterCompanyId = null } = {}) {
  const sorted = [...companies].sort((a, b) => {
    const truncA = a?.config?.workforceScheduler?.lastRunSummary?.truncated ? 0 : 1;
    const truncB = b?.config?.workforceScheduler?.lastRunSummary?.truncated ? 0 : 1;
    if (truncA !== truncB) return truncA - truncB;
    const ta = a?.config?.workforceScheduler?.lastRunAt
      ? new Date(a.config.workforceScheduler.lastRunAt).getTime()
      : 0;
    const tb = b?.config?.workforceScheduler?.lastRunAt
      ? new Date(b.config.workforceScheduler.lastRunAt).getTime()
      : 0;
    if (ta !== tb) return ta - tb;
    return String(a._id).localeCompare(String(b._id));
  });
  if (!afterCompanyId) return sorted;
  const idx = sorted.findIndex((c) => String(c._id) === String(afterCompanyId));
  return idx >= 0 ? sorted.slice(idx + 1) : sorted;
}

/**
 * Process items with bounded concurrency. Never launches unbounded parallel work.
 * `shouldStop` (optional) prevents starting new items when true (in-flight finish).
 */
export async function mapWithBoundedConcurrency(items, concurrency, mapper, { shouldStop } = {}) {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (shouldStop?.()) return;
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
}

/**
 * Run scheduling for one company.
 * dryRun (default): proposals only, no ownership changes.
 * apply: AUTO path uses assignUnassignedTaskService; MANAGER_APPROVAL records proposal only.
 */
export async function runCompanyScheduler(company, options = {}) {
  const enabled = options.force === true || schedulerEnabled();
  if (!enabled) {
    return {
      companyId: String(company._id),
      skipped: true,
      reason: "scheduler_disabled",
    };
  }

  const mode = options.mode || schedulerMode();
  const dryRun = mode !== "apply";
  const now = options.now || new Date();
  const timezone = resolveCompanyTimezone(company);
  const businessDate = getCompanyBusinessDate(now, timezone);
  const startedAt = Date.now();

  if (isPastDeadline(options.deadline)) {
    return {
      companyId: String(company._id),
      companySlug: company.slug,
      skipped: true,
      reason: "budget_exhausted",
      businessDate,
      timezone,
      durationMs: 0,
    };
  }

  const lock = options.skipLock
    ? { acquired: true, token: null }
    : await acquireCompanySchedulerLock(company._id);
  if (!lock.acquired) {
    return {
      companyId: String(company._id),
      skipped: true,
      reason: "lock_held",
      businessDate,
      timezone,
      durationMs: Date.now() - startedAt,
    };
  }

  const decisions = [];
  const summary = {
    mode,
    dryRun,
    businessDate,
    timezone,
    queued: 0,
    autoProposed: 0,
    autoApplied: 0,
    approvalProposed: 0,
    noEligible: 0,
    truncated: false,
    errors: [],
  };

  try {
    const models = await getCompanyModels(company);
    const queue = await loadAssignableTaskQueue(models, { limit: options.limit || 100 });
    summary.queued = queue.length;

    const prioritized = sortTasksByPriority(queue, now);

    const { Employee } = models;
    // F41: load ACTIVE roster + leave set once per company run (not per task).
    const employeeRoster = await Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
      .select(ELIGIBLE_EMPLOYEE_SELECT)
      .lean();
    const onLeaveIds = await loadOnLeaveEmployeeIds(models, company, now);
    const workloadByEmployee = await calculateWorkloadByEmployee(
      models,
      employeeRoster.map((e) => e._id)
    );

    const maxActive = maxActiveTasks();

    // Lazy import to avoid circular deps with workManagementService
    const { assignUnassignedTaskService } = await import("../workManagementService.js");

    for (const { task, score, components } of prioritized) {
      if (isPastDeadline(options.deadline)) {
        summary.truncated = true;
        summary.errors.push({
          taskId: null,
          message: "wall_clock_budget",
          remainingTasks: prioritized.length - decisions.length,
        });
        break;
      }

      try {
        const decision = await decideAssignment(models, task, workloadByEmployee, {
          maxActive,
          company,
          employees: employeeRoster,
          onLeaveIds,
          now,
        });
        decision.priorityScore = score;
        decision.priorityComponents = components;

        if (decision.path === ASSIGNMENT_PATHS.NO_ELIGIBLE) {
          summary.noEligible += 1;
          decisions.push(decision);
          continue;
        }

        if (decision.path === ASSIGNMENT_PATHS.MANAGER_APPROVAL) {
          const recorded = await recordPendingApproval(models, task._id, decision, { dryRun });
          summary.approvalProposed += 1;
          decisions.push({ ...decision, applyResult: recorded });
          continue;
        }

        // AUTO
        summary.autoProposed += 1;
        if (dryRun) {
          decisions.push({ ...decision, applyResult: { dryRun: true, applied: false } });
          if (decision.proposal?.employeeId) {
            applyAssignmentToWorkload(
              workloadByEmployee,
              decision.proposal.employeeId,
              task._id
            );
          }
          continue;
        }

        const applyResult = await assignUnassignedTaskService({
          models,
          taskId: task._id,
          assigneeId: decision.proposal.employeeId,
          source: "WORKFORCE_SCHEDULER",
          company,
          schedulerMeta: {
            score: decision.proposal.score,
            components: decision.proposal.components,
            reason: decision.reason,
          },
        });

        if (applyResult?.task) {
          summary.autoApplied += 1;
          applyAssignmentToWorkload(
            workloadByEmployee,
            decision.proposal.employeeId,
            task._id
          );
        }
        decisions.push({ ...decision, applyResult: { applied: Boolean(applyResult?.task) } });
      } catch (err) {
        summary.errors.push({
          taskId: String(task._id),
          message: err?.message || String(err),
        });
      }
    }

    // Persist progress before returning. If truncated mid-queue, keep lastRunAt unchanged
    // (or unset advance) so the same wave still selects this tenant — do not abandon it.
    const progressSet = {
      "config.workforceScheduler.lastRunSummary": summary,
    };
    if (!summary.truncated) {
      progressSet["config.workforceScheduler.lastRunAt"] = now;
    }
    await Company.updateOne({ _id: company._id }, { $set: progressSet });

    await logSchedulerOutcome(models, {
      companyId: company._id,
      summary: { ...summary, decisionsCount: decisions.length },
    });

    console.info(
      "[workforce-scheduler]",
      JSON.stringify({
        companyId: String(company._id),
        slug: company.slug,
        mode: summary.mode,
        dryRun: summary.dryRun,
        queued: summary.queued,
        autoApplied: summary.autoApplied,
        approvalProposed: summary.approvalProposed,
        noEligible: summary.noEligible,
        truncated: summary.truncated,
        errors: summary.errors.length,
        durationMs: Date.now() - startedAt,
      })
    );

    return {
      companyId: String(company._id),
      companySlug: company.slug,
      skipped: false,
      summary,
      decisions,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (!options.skipLock) {
      await releaseCompanySchedulerLock(company._id, lock.token);
    }
  }
}

/**
 * Multi-tenant scheduling with bounded concurrency, wall-clock budget, and durable wave progress.
 * One tenant failure does not abort the batch. Truncation persists a MongoDB fleet cursor for resume.
 */
export async function runSchedulerForAllCompanies(options = {}) {
  const runStartedAt = Date.now();
  if (!schedulerEnabled() && !options.force) {
    return { skipped: true, reason: "scheduler_disabled", companies: 0, results: [] };
  }

  const budgetMs = Number.isFinite(options.budgetMs)
    ? Number(options.budgetMs)
    : schedulerBudgetMs();
  const deadline =
    options.deadline != null
      ? Number(options.deadline)
      : runStartedAt + Math.max(0, budgetMs);
  const concurrency = Math.max(
    1,
    Number.isFinite(options.concurrency) ? Number(options.concurrency) : companyConcurrency()
  );
  const maxCompanies = Number.isFinite(options.maxCompanies)
    ? Number(options.maxCompanies)
    : maxCompaniesPerInvocation();

  const waveNow = options.now || new Date();
  const wave = options.waveStartedAt
    ? {
        waveStartedAt: new Date(options.waveStartedAt),
        afterCompanyId: options.afterCompanyId || null,
        resumed: Boolean(options.afterCompanyId),
      }
    : options.ignoreFleetCursor
      ? { waveStartedAt: waveNow, afterCompanyId: options.afterCompanyId || null, resumed: false }
      : await beginOrResumeSchedulerWave({ now: waveNow });

  // Explicit query/body cursor wins over stored fleet cursor.
  const resumeAfterCompanyId = options.afterCompanyId || wave.afterCompanyId || null;

  const companiesRaw = await Company.find({
    status: { $in: [COMPANY_STATUSES.ACTIVE, COMPANY_STATUSES.TRIAL] },
  })
    .select("_id slug databaseName status config")
    .lean();

  const pending = companiesRaw.filter((c) =>
    companyNeedsSchedulerRun(c, wave.waveStartedAt)
  );
  let companies = orderCompaniesForScheduler(pending, {
    afterCompanyId: resumeAfterCompanyId,
  });
  const discovered = companies.length;
  if (maxCompanies > 0 && companies.length > maxCompanies) {
    companies = companies.slice(0, maxCompanies);
  }

  let truncated = false;
  let stopNewWork = false;

  // NEW-S2: mid-wave durable checkpoints (never mark the wave complete here).
  const completedFullyIds = new Set();
  let lastCheckpointCursor =
    resumeAfterCompanyId != null ? String(resumeAfterCompanyId) : null;
  let checkpointQueue = Promise.resolve();

  const enqueueCheckpoint = (cursor) => {
    const nextCursor = cursor != null ? String(cursor) : null;
    // Only persist when the contiguous cursor advances — avoids excessive writes
    // under concurrency when earlier tenants in order are still in flight.
    if (nextCursor === lastCheckpointCursor) return checkpointQueue;
    lastCheckpointCursor = nextCursor;
    checkpointQueue = checkpointQueue
      .then(() =>
        saveFleetProgress({
          waveStartedAt: wave.waveStartedAt,
          // Always truncated while the hop is in flight — never clear early.
          truncated: true,
          afterCompanyId: nextCursor,
          now: new Date(),
        })
      )
      .catch(() => {
        // non-blocking; final persist still runs
      });
    return checkpointQueue;
  };

  const results = await mapWithBoundedConcurrency(
    companies,
    concurrency,
    async (company) => {
      if (stopNewWork || isPastDeadline(deadline)) {
        stopNewWork = true;
        truncated = true;
        // Do not mark as processed — tenant remains pending for the next invocation.
        return {
          companyId: String(company._id),
          companySlug: company.slug,
          skipped: true,
          reason: "budget_exhausted",
          pending: true,
          durationMs: 0,
        };
      }

      const companyStarted = Date.now();
      try {
        // F53: cap each tenant so one slow company cannot consume the whole fleet budget.
        const perCompanyMs = Number.isFinite(options.perCompanyBudgetMs)
          ? Number(options.perCompanyBudgetMs)
          : perCompanyBudgetMs();
        const companyDeadline = Math.min(deadline, Date.now() + Math.max(0, perCompanyMs));
        // Per-company scope: retain while scheduling, release on success/failure/return.
        const outcome = await runWithTenantConnectionScope(() =>
          runCompanyScheduler(company, { ...options, deadline: companyDeadline })
        );
        const result = {
          ...outcome,
          durationMs: outcome.durationMs ?? Date.now() - companyStarted,
        };

        // Checkpoint only after a fully completed company (not mid-queue truncated).
        if (result.companyId && !result.skipped && !result.summary?.truncated) {
          completedFullyIds.add(String(result.companyId));
          const cursor = contiguousCompletedCursor(
            companies,
            completedFullyIds,
            resumeAfterCompanyId
          );
          await enqueueCheckpoint(cursor);
        } else if (result.summary?.truncated) {
          truncated = true;
          // Persist best contiguous cursor so a kill cannot leave zero progress.
          const cursor = contiguousCompletedCursor(
            companies,
            completedFullyIds,
            resumeAfterCompanyId
          );
          await enqueueCheckpoint(cursor);
        }

        return result;
      } catch (err) {
        return {
          companyId: String(company._id),
          companySlug: company.slug,
          skipped: true,
          reason: "error",
          error: err?.message || String(err),
          durationMs: Date.now() - companyStarted,
        };
      }
    },
    {
      shouldStop: () => {
        if (isPastDeadline(deadline)) {
          stopNewWork = true;
          truncated = true;
          return true;
        }
        return false;
      },
    }
  );

  // Drain in-flight checkpoints before final fleet write.
  await checkpointQueue.catch(() => {});

  const attemptedResults = results.filter((r) => r.reason !== "budget_exhausted");
  const processedIds = new Set(results.map((r) => String(r.companyId)));
  const notStarted = companies.filter((c) => !processedIds.has(String(c._id)));
  if (notStarted.length || results.some((r) => r.reason === "budget_exhausted")) {
    truncated = true;
  }
  if (attemptedResults.some((r) => r.summary?.truncated)) {
    truncated = true;
  }

  // Resume cursor = furthest contiguous *fully completed* company only.
  // Mid-queue truncated tenants stay selectable via companyNeedsSchedulerRun +
  // truncated-first ordering — never skip them.
  const completedCursor = contiguousCompletedCursor(
    companies,
    completedFullyIds,
    resumeAfterCompanyId
  );
  let nextAfterCompanyId = truncated ? completedCursor : null;

  // Final fleet persist. clearFleetProgress only after verified zero pending —
  // interrupted runs must never mark the wave complete.
  if (truncated) {
    await saveFleetProgress({
      waveStartedAt: wave.waveStartedAt,
      truncated: true,
      afterCompanyId: nextAfterCompanyId,
      now: new Date(),
    });
  } else {
    // Re-check pending: companies completed in this invocation advanced lastRunAt.
    const refreshed = await Company.find({
      status: { $in: [COMPANY_STATUSES.ACTIVE, COMPANY_STATUSES.TRIAL] },
    })
      .select("_id config")
      .lean();
    const stillPending = refreshed.filter((c) =>
      companyNeedsSchedulerRun(c, wave.waveStartedAt)
    );
    if (stillPending.length) {
      truncated = true;
      // Preserve contiguous cursor from this hop — never wipe afterCompanyId to null
      // just because the capped slice looked complete.
      nextAfterCompanyId = completedCursor;
      await saveFleetProgress({
        waveStartedAt: wave.waveStartedAt,
        truncated: true,
        afterCompanyId: nextAfterCompanyId,
        now: new Date(),
      });
    } else {
      await clearFleetProgress({ now: new Date() });
    }
  }

  const successCount = attemptedResults.filter((r) => !r.skipped).length;
  const errorCount = attemptedResults.filter((r) => r.reason === "error").length;
  const skippedCount = attemptedResults.filter((r) => r.skipped).length;

  return {
    skipped: false,
    companies: companiesRaw.length,
    discovered: pending.length,
    pendingRemaining: truncated
      ? Math.max(0, pending.length - successCount - errorCount)
      : 0,
    attempted: attemptedResults.length,
    successCount,
    errorCount,
    skippedCount,
    truncated,
    nextAfterCompanyId,
    waveStartedAt: wave.waveStartedAt,
    waveResumed: Boolean(wave.resumed),
    concurrency,
    budgetMs,
    durationMs: Date.now() - runStartedAt,
    results: attemptedResults,
    fleet: await loadFleetProgress(),
  };
}

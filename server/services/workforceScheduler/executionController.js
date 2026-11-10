import crypto from "crypto";
import Company, { COMPANY_STATUSES } from "../../models/Company.js";
import { getCompanyModels } from "../../config/db.js";
import { resolveCompanyTimezone, getCompanyBusinessDate } from "../../utils/companyTime.js";
import {
  lockTtlMs,
  maxActiveTasks,
  schedulerEnabled,
  schedulerMode,
} from "./config.js";
import { loadAssignableTaskQueue } from "./taskQueue.js";
import { sortTasksByPriority } from "./priorityResolver.js";
import { calculateWorkloadByEmployee, applyAssignmentToWorkload } from "./workload.js";
import { decideAssignment, ASSIGNMENT_PATHS } from "./strategy.js";
import { recordPendingApproval } from "./approvalHandler.js";
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
    errors: [],
  };

  try {
    const models = await getCompanyModels(company);
    const queue = await loadAssignableTaskQueue(models, { limit: options.limit || 100 });
    summary.queued = queue.length;

    const prioritized = sortTasksByPriority(queue, now);

    const { Employee } = models;
    const activeEmployees = await Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
      .select("_id")
      .lean();
    const workloadByEmployee = await calculateWorkloadByEmployee(
      models,
      activeEmployees.map((e) => e._id)
    );

    const maxActive = maxActiveTasks();

    // Lazy import to avoid circular deps with workManagementService
    const { assignUnassignedTaskService } = await import("../workManagementService.js");

    for (const { task, score, components } of prioritized) {
      try {
        const decision = await decideAssignment(models, task, workloadByEmployee, {
          maxActive,
          company,
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

    await Company.updateOne(
      { _id: company._id },
      {
        $set: {
          "config.workforceScheduler.lastRunAt": now,
          "config.workforceScheduler.lastRunSummary": summary,
        },
      }
    );

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
        errors: summary.errors.length,
      })
    );

    return {
      companyId: String(company._id),
      companySlug: company.slug,
      skipped: false,
      summary,
      decisions,
    };
  } finally {
    if (!options.skipLock) {
      await releaseCompanySchedulerLock(company._id, lock.token);
    }
  }
}

/**
 * Company-by-company scheduling for all active/trial companies.
 */
export async function runSchedulerForAllCompanies(options = {}) {
  if (!schedulerEnabled() && !options.force) {
    return { skipped: true, reason: "scheduler_disabled", companies: 0, results: [] };
  }

  const companies = await Company.find({
    status: { $in: [COMPANY_STATUSES.ACTIVE, COMPANY_STATUSES.TRIAL] },
  }).select("_id slug databaseName status config");

  const results = [];
  for (const company of companies) {
    try {
      results.push(await runCompanyScheduler(company, options));
    } catch (err) {
      results.push({
        companyId: String(company._id),
        skipped: true,
        reason: "error",
        error: err?.message || String(err),
      });
    }
  }

  return {
    skipped: false,
    companies: companies.length,
    results,
  };
}

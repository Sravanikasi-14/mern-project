/**
 * Manager approval path: record proposed assignment on the task without activating it.
 * Uses existing Task.auditMetadata (no new collection).
 * Task remains UNASSIGNED until approved via assignUnassignedTaskService.
 */

export const SCHEDULER_PROPOSAL_STATUS = Object.freeze({
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUPERSEDED: "SUPERSEDED",
});

export function buildPendingApprovalMetadata(decision, now = new Date()) {
  if (!decision?.proposal) return null;
  return {
    workforceScheduler: {
      status: SCHEDULER_PROPOSAL_STATUS.PENDING_APPROVAL,
      path: decision.path,
      reason: decision.reason,
      proposedAssigneeId: decision.proposal.employeeId,
      proposedAssigneeName: decision.proposal.employeeName,
      score: decision.proposal.score,
      components: decision.proposal.components,
      proposedAt: now.toISOString(),
    },
  };
}

/**
 * Persist pending approval proposal. Does not set assigneeId.
 * Idempotent: if same proposedAssignee already pending, returns existing.
 */
export async function recordPendingApproval(models, taskId, decision, { dryRun = true } = {}) {
  const { Task } = models;
  const meta = buildPendingApprovalMetadata(decision);
  if (!meta) {
    return { applied: false, reason: "no_proposal" };
  }

  if (dryRun) {
    return {
      applied: false,
      dryRun: true,
      taskId: String(taskId),
      proposal: meta.workforceScheduler,
    };
  }

  const updated = await Task.findOneAndUpdate(
    {
      _id: taskId,
      status: "UNASSIGNED",
      $or: [{ assigneeId: null }, { assigneeId: { $exists: false } }],
    },
    {
      $set: {
        "auditMetadata.workforceScheduler": meta.workforceScheduler,
      },
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return { applied: false, reason: "task_not_claimable" };
  }

  return {
    applied: true,
    taskId: String(updated._id),
    proposal: updated.auditMetadata?.workforceScheduler || meta.workforceScheduler,
  };
}

export async function clearSchedulerProposal(models, taskId) {
  const { Task } = models;
  await Task.updateOne(
    { _id: taskId },
    { $unset: { "auditMetadata.workforceScheduler": 1 } }
  );
}

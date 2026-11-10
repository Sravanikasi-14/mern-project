import { TASK_STATUSES } from "../../models/Task.js";
import {
  DELEGATION_STATUSES,
  HANDOVER_STATUSES,
} from "../../constants/handoverConstants.js";

const ACTIVE_WORKLOAD_STATUSES = [
  TASK_STATUSES.ASSIGNED,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SUBMITTED,
  TASK_STATUSES.CHANGES_REQUESTED,
];

/**
 * Current workload by employee.
 * Counts tasks where the employee is the effective worker:
 * - Task.assigneeId (owner) when not covered by ACTIVE/SCHEDULED temporary delegation
 * - Plus tasks temporarily delegated TO this employee
 * Avoids double-counting: owner load excludes tasks with open delegation coverage.
 * Preserves Task.assigneeId as original owner during temporary delegation.
 */
export async function calculateWorkloadByEmployee(models, employeeIds) {
  const { Task, LeaveRequest } = models;
  const ids = employeeIds.map((id) => String(id));
  const map = new Map(ids.map((id) => [id, { activeCount: 0, taskIds: [] }]));

  if (!ids.length) return map;

  const tasks = await Task.find({
    assigneeId: { $in: employeeIds },
    status: { $in: ACTIVE_WORKLOAD_STATUSES },
  })
    .select("_id assigneeId status priority deadline")
    .lean();

  const delegatedAway = new Map(); // taskId -> delegateeId
  const delegatedTo = new Map(); // employeeId -> [taskId]

  if (LeaveRequest) {
    const leaves = await LeaveRequest.find({
      "handover.status": { $nin: [HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED] },
      "handover.items.delegation.status": {
        $in: [DELEGATION_STATUSES.ACTIVE, DELEGATION_STATUSES.SCHEDULED],
      },
    })
      .select("handover.items")
      .lean();

    for (const leave of leaves) {
      for (const item of leave.handover?.items || []) {
        const status = item?.delegation?.status;
        if (
          status !== DELEGATION_STATUSES.ACTIVE &&
          status !== DELEGATION_STATUSES.SCHEDULED
        ) {
          continue;
        }
        const taskId = item.taskId ? String(item.taskId) : null;
        const toId = item.delegation?.delegateEmployeeId
          ? String(item.delegation.delegateEmployeeId)
          : null;
        if (!taskId || !toId) continue;
        delegatedAway.set(taskId, toId);
        if (!delegatedTo.has(toId)) delegatedTo.set(toId, []);
        delegatedTo.get(toId).push(taskId);
      }
    }
  }

  for (const task of tasks) {
    const ownerId = String(task.assigneeId);
    const taskId = String(task._id);
    if (delegatedAway.has(taskId)) continue;
    if (!map.has(ownerId)) continue;
    const entry = map.get(ownerId);
    entry.activeCount += 1;
    entry.taskIds.push(taskId);
  }

  for (const [toId, taskIds] of delegatedTo.entries()) {
    if (!map.has(toId)) continue;
    const entry = map.get(toId);
    for (const taskId of taskIds) {
      if (entry.taskIds.includes(taskId)) continue;
      entry.activeCount += 1;
      entry.taskIds.push(taskId);
    }
  }

  return map;
}

export function applyAssignmentToWorkload(workloadByEmployee, employeeId, taskId) {
  const id = String(employeeId);
  if (!workloadByEmployee.has(id)) {
    workloadByEmployee.set(id, { activeCount: 0, taskIds: [] });
  }
  const entry = workloadByEmployee.get(id);
  entry.activeCount += 1;
  if (taskId) entry.taskIds.push(String(taskId));
}

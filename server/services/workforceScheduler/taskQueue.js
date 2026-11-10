import { TASK_STATUSES } from "../../models/Task.js";
import {
  DELEGATION_STATUSES,
  HANDOVER_STATUSES,
} from "../../constants/handoverConstants.js";

const OPEN_DELEGATION = [DELEGATION_STATUSES.ACTIVE, DELEGATION_STATUSES.SCHEDULED];

/**
 * Tasks eligible for new assignment: status UNASSIGNED and no assignee.
 * Excludes active lifecycle states and tasks under open leave-delegation coverage.
 */
export async function loadAssignableTaskQueue(models, { limit = 100 } = {}) {
  const { Task, LeaveRequest } = models;

  const tasks = await Task.find({
    status: TASK_STATUSES.UNASSIGNED,
    $or: [{ assigneeId: null }, { assigneeId: { $exists: false } }],
  })
    .sort({ deadline: 1, createdAt: 1 })
    .limit(limit)
    .lean();

  if (!tasks.length || !LeaveRequest) return tasks;

  const taskIds = tasks.map((t) => t._id);
  const delegated = await LeaveRequest.find({
    "handover.status": { $nin: [HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED] },
    "handover.items": {
      $elemMatch: {
        taskId: { $in: taskIds },
        "delegation.status": { $in: OPEN_DELEGATION },
      },
    },
  })
    .select("handover.items.taskId handover.items.delegation.status")
    .lean();

  const blocked = new Set();
  for (const leave of delegated) {
    for (const item of leave.handover?.items || []) {
      if (item?.taskId && OPEN_DELEGATION.includes(item.delegation?.status)) {
        blocked.add(String(item.taskId));
      }
    }
  }

  return tasks.filter((task) => !blocked.has(String(task._id)));
}

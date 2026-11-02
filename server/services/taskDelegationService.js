import mongoose from "mongoose";
import {
  DELEGATION_STATUSES,
  DELEGATION_END_REASONS,
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
} from "../constants/handoverConstants.js";
import { parseDateOnly, toDateString } from "./leaveService.js";
import { HttpError } from "../utils/httpError.js";

export function startOfTodayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function datesOverlapToday(fromDate, toDate, today = startOfTodayUtc()) {
  if (!fromDate || !toDate) return false;
  const from = parseDateOnly(toDateString(fromDate));
  const to = parseDateOnly(toDateString(toDate));
  if (!from || !to) return false;
  return from <= today && to >= today;
}

/**
 * Visibility for Dashboard / Tasks Temporary Coverage.
 * Includes coordinated SCHEDULED coverage that starts in the future, and ACTIVE windows
 * that include today. Excludes expired (toDate < today), ended, and cancelled.
 */
export function isCoverageVisibleOn(fromDate, toDate, today = startOfTodayUtc()) {
  if (!fromDate || !toDate) return false;
  const to = parseDateOnly(toDateString(toDate));
  if (!to) return false;
  return to >= today;
}

const OPEN_DELEGATION_STATUSES = [
  DELEGATION_STATUSES.ACTIVE,
  DELEGATION_STATUSES.SCHEDULED,
];

function openCoverageElemMatch(employeeId, today = startOfTodayUtc()) {
  return {
    "delegation.delegateEmployeeId": employeeId,
    "delegation.status": { $in: OPEN_DELEGATION_STATUSES },
    "delegation.toDate": { $gte: today },
  };
}

function isOpenDelegationForEmployee(delegation, employeeId, today = startOfTodayUtc()) {
  if (!delegation) return false;
  if (String(delegation.delegateEmployeeId) !== String(employeeId)) return false;
  if (!OPEN_DELEGATION_STATUSES.includes(delegation.status)) return false;
  return isCoverageVisibleOn(delegation.fromDate, delegation.toDate, today);
}

/**
 * Build a permission-facing delegation view from an embedded item.
 * Never mutates Task.assigneeId.
 */
export function toDelegationView(leaveRequest, item) {
  if (!leaveRequest || !item?.delegation) return null;
  const d = item.delegation;
  if (!d.status) return null;
  return {
    leaveRequestId: leaveRequest._id,
    handoverItemId: item._id,
    taskId: item.taskId,
    originalAssigneeId: d.originalAssigneeId,
    delegateEmployeeId: d.delegateEmployeeId,
    fromDate: d.fromDate,
    toDate: d.toDate,
    status: d.status,
    activatedAt: d.activatedAt,
    endedAt: d.endedAt,
    endReason: d.endReason,
  };
}

/**
 * Open coordinated delegation for a task + covering employee.
 * Grants access for ACTIVE windows and for coordinated SCHEDULED coverage that has not expired.
 * Expired, ended, cancelled, or cancelled-handover records never grant access.
 */
export async function getActiveDelegationForActor(models, taskId, employeeId) {
  const { LeaveRequest } = models || {};
  if (!LeaveRequest || !employeeId || !taskId) return null;
  if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(employeeId)) {
    return null;
  }

  const today = startOfTodayUtc();
  const leave = await LeaveRequest.findOne({
    "handover.status": {
      $nin: [HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED],
    },
    "handover.items": {
      $elemMatch: {
        taskId,
        ...openCoverageElemMatch(employeeId, today),
      },
    },
  });

  if (!leave?.handover?.items) return null;

  const item = leave.handover.items.find(
    (it) =>
      String(it.taskId) === String(taskId) &&
      isOpenDelegationForEmployee(it.delegation, employeeId, today)
  );
  if (!item?.delegation) return null;

  // Lazy activate SCHEDULED when the coverage window has started
  if (
    item.delegation.status === DELEGATION_STATUSES.SCHEDULED &&
    datesOverlapToday(item.delegation.fromDate, item.delegation.toDate, today)
  ) {
    await LeaveRequest.updateOne(
      {
        _id: leave._id,
        "handover.items": {
          $elemMatch: {
            _id: item._id,
            "delegation.status": DELEGATION_STATUSES.SCHEDULED,
            "delegation.fromDate": { $lte: today },
            "delegation.toDate": { $gte: today },
          },
        },
      },
      {
        $set: {
          "handover.items.$.delegation.status": DELEGATION_STATUSES.ACTIVE,
          "handover.items.$.delegation.activatedAt": new Date(),
        },
      }
    );
    item.delegation.status = DELEGATION_STATUSES.ACTIVE;
    item.delegation.activatedAt = new Date();
    if (item.status === HANDOVER_ITEM_STATUSES.APPROVED) {
      item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
    }
    if (leave.handover.status === HANDOVER_STATUSES.APPROVED) {
      leave.handover.status = HANDOVER_STATUSES.ACTIVE;
      leave.handover.activatedAt = leave.handover.activatedAt || new Date();
      leave.markModified("handover");
      await leave.save();
    }
  }

  return toDelegationView(leave, item);
}

/**
 * Task ids currently coverable by the given employee via embedded delegations.
 * Same visibility rules as listCoveringResponsibilitySummaries (single source of truth).
 */
export async function listCoveringTaskIds(models, employeeId) {
  const { LeaveRequest } = models || {};
  if (!LeaveRequest || !employeeId) return [];

  const today = startOfTodayUtc();
  const rows = await LeaveRequest.find({
    "handover.status": {
      $nin: [HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED],
    },
    "handover.items": {
      $elemMatch: openCoverageElemMatch(employeeId, today),
    },
  })
    .select("handover.items")
    .lean();

  const ids = [];
  for (const leave of rows) {
    for (const item of leave.handover?.items || []) {
      if (isOpenDelegationForEmployee(item.delegation, employeeId, today) && item.taskId) {
        ids.push(item.taskId);
      }
    }
  }

  // Do not surface temporary coverage for tasks already permanently assigned to the coverer
  const { Task } = models || {};
  if (!Task || ids.length === 0) return ids;
  const own = await Task.find({
    _id: { $in: ids },
    assigneeId: employeeId,
  })
    .select("_id")
    .lean();
  const ownSet = new Set(own.map((t) => String(t._id)));
  return ids.filter((id) => !ownSet.has(String(id)));
}

/**
 * Dashboard/Tasks shared view: coordinated temporary coverage for an employee.
 * Same rules as listCoveringTaskIds — includes upcoming SCHEDULED coverage.
 */
export async function listCoveringResponsibilitySummaries(models, employeeId, { limit = 20 } = {}) {
  const { LeaveRequest, Employee, Task } = models || {};
  if (!LeaveRequest || !employeeId) return [];

  const today = startOfTodayUtc();
  const rows = await LeaveRequest.find({
    "handover.status": {
      $nin: [HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED],
    },
    "handover.items": {
      $elemMatch: openCoverageElemMatch(employeeId, today),
    },
  })
    .select("employeeId fromDate toDate handover")
    .limit(40)
    .lean();

  const ownerIds = new Set();
  const managerIds = new Set();
  const taskIds = new Set();
  const items = [];

  for (const leave of rows) {
    for (const item of leave.handover?.items || []) {
      if (!isOpenDelegationForEmployee(item.delegation, employeeId, today)) continue;
      ownerIds.add(String(leave.employeeId));
      if (leave.handover?.managerEmployeeId) {
        managerIds.add(String(leave.handover.managerEmployeeId));
      }
      if (item.taskId) taskIds.add(String(item.taskId));
      items.push({ leave, item, delegation: item.delegation });
    }
  }

  const [owners, managers, tasks] = await Promise.all([
    Employee && ownerIds.size
      ? Employee.find({ _id: { $in: [...ownerIds] } })
          .select("fullName employeeCode")
          .lean()
      : [],
    Employee && managerIds.size
      ? Employee.find({ _id: { $in: [...managerIds] } })
          .select("fullName employeeCode")
          .lean()
      : [],
    Task && taskIds.size
      ? Task.find({ _id: { $in: [...taskIds] } })
          .select("title priority deadline status assigneeId")
          .lean()
      : [],
  ]);

  const ownerById = new Map(owners.map((e) => [String(e._id), e]));
  const managerById = new Map(managers.map((e) => [String(e._id), e]));
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));

  return items
    .map(({ leave, item, delegation }) => {
      const task = taskById.get(String(item.taskId));
      const owner = ownerById.get(String(leave.employeeId));
      const manager = managerById.get(String(leave.handover?.managerEmployeeId));
      const inWindow = datesOverlapToday(delegation.fromDate, delegation.toDate, today);
      const coverageActive =
        delegation.status === DELEGATION_STATUSES.ACTIVE || inWindow;
      const permanentAssigneeId = task?.assigneeId || leave.employeeId;
      return {
        taskId: item.taskId,
        leaveRequestId: leave._id,
        title: item.taskSnapshot?.title || task?.title || "Responsibility",
        originalOwner: owner
          ? { _id: owner._id, fullName: owner.fullName, employeeCode: owner.employeeCode }
          : null,
        coordinatedBy: manager
          ? { _id: manager._id, fullName: manager.fullName, employeeCode: manager.employeeCode }
          : null,
        instructions: item.instructions || "",
        deadline: item.taskSnapshot?.deadline || task?.deadline || null,
        priority: item.taskSnapshot?.priority || task?.priority || null,
        taskStatus: task?.status || item.taskSnapshot?.status || null,
        coverageStatus: coverageActive ? "ACTIVE" : "SCHEDULED",
        coverageLabel: "Temporary Coverage",
        coverageFrom: delegation.fromDate,
        coverageTo: delegation.toDate,
        permanentAssigneeId,
      };
    })
    .filter((row) => String(row.permanentAssigneeId) !== String(employeeId))
    .slice(0, limit);
}

/**
 * Atomically claim an open embedded delegation for a task on a handover item.
 *
 * Concurrency model (no new collections):
 * 1. Conditional findOneAndUpdate only when this item has no open delegation.
 * 2. Recount open delegations for the task across the tenant.
 * 3. If more than one open claim exists, roll this claim back and fail with 409.
 */
export async function attachDelegationToItem(models, leaveRequest, item, {
  originalAssigneeId,
  delegateEmployeeId,
  fromDate,
  toDate,
  createdByUserId,
  activateNow = false,
}) {
  const { LeaveRequest } = models || {};
  if (!LeaveRequest) throw new HttpError(500, "Leave models unavailable.");
  if (!item?._id || !item.taskId) {
    throw new HttpError(400, "Handover item and task are required for delegation.");
  }

  const openStatuses = [DELEGATION_STATUSES.ACTIVE, DELEGATION_STATUSES.SCHEDULED];
  const status = activateNow ? DELEGATION_STATUSES.ACTIVE : DELEGATION_STATUSES.SCHEDULED;
  const delegation = {
    originalAssigneeId,
    delegateEmployeeId,
    fromDate,
    toDate,
    status,
    activatedAt: activateNow ? new Date() : null,
    endedAt: null,
    endReason: null,
    createdByUserId: createdByUserId || null,
    endedByUserId: null,
    outcomeNote: "",
    migratedFromDelegationId: null,
  };

  // Pre-check (fast path) — still followed by atomic claim + recount
  const conflict = await LeaveRequest.findOne({
    "handover.items": {
      $elemMatch: {
        taskId: item.taskId,
        "delegation.status": { $in: openStatuses },
      },
    },
  })
    .select("_id")
    .lean();

  if (conflict && String(conflict._id) !== String(leaveRequest._id)) {
    throw new HttpError(409, "An active temporary transfer already exists for one of these tasks.");
  }

  const claimed = await LeaveRequest.findOneAndUpdate(
    {
      _id: leaveRequest._id,
      "handover.items": {
        $elemMatch: {
          _id: item._id,
          taskId: item.taskId,
          $or: [
            { delegation: null },
            { "delegation.status": null },
            { "delegation.status": { $exists: false } },
            {
              "delegation.status": {
                $in: [DELEGATION_STATUSES.ENDED, DELEGATION_STATUSES.CANCELLED],
              },
            },
          ],
        },
      },
    },
    {
      $set: {
        "handover.items.$.delegation": delegation,
      },
    },
    { returnDocument: "after" }
  );

  if (!claimed) {
    throw new HttpError(
      409,
      "Could not claim temporary transfer for this task (already claimed or item mismatch)."
    );
  }

  // Detect concurrent claims for the same task (cross-leave OR duplicate items on one leave).
  // Deterministic winner: smallest LeaveRequest _id, then smallest item _id.
  const openLeaves = await LeaveRequest.find({
    "handover.items": {
      $elemMatch: {
        taskId: item.taskId,
        "delegation.status": { $in: openStatuses },
      },
    },
  })
    .select("_id handover.items")
    .lean();

  const openClaims = [];
  for (const leave of openLeaves) {
    for (const it of leave.handover?.items || []) {
      if (
        String(it.taskId) === String(item.taskId) &&
        it.delegation &&
        openStatuses.includes(it.delegation.status)
      ) {
        openClaims.push({ leaveId: String(leave._id), itemId: String(it._id) });
      }
    }
  }

  if (openClaims.length > 1) {
    const winner = [...openClaims].sort((a, b) =>
      a.leaveId === b.leaveId ? a.itemId.localeCompare(b.itemId) : a.leaveId.localeCompare(b.leaveId)
    )[0];
    const selfKey = { leaveId: String(leaveRequest._id), itemId: String(item._id) };
    if (selfKey.leaveId !== winner.leaveId || selfKey.itemId !== winner.itemId) {
      await LeaveRequest.updateOne(
        {
          _id: leaveRequest._id,
          "handover.items": {
            $elemMatch: {
              _id: item._id,
              "delegation.status": { $in: openStatuses },
            },
          },
        },
        {
          $set: {
            "handover.items.$.delegation.status": DELEGATION_STATUSES.CANCELLED,
            "handover.items.$.delegation.endedAt": new Date(),
            "handover.items.$.delegation.endReason": DELEGATION_END_REASONS.REVOKED,
            "handover.items.$.delegation.outcomeNote":
              "Rolled back due to concurrent conflicting delegation claim.",
          },
        }
      );
      throw new HttpError(409, "An active temporary transfer already exists for one of these tasks.");
    }
  }

  // Keep in-memory leave document aligned for the caller
  item.delegation = delegation;
  const refreshedItem = claimed.handover?.items?.id?.(item._id);
  if (refreshedItem?.delegation) {
    item.delegation = refreshedItem.delegation;
  }

  return item.delegation;
}

export function cancelItemDelegation(item, { endedByUserId = null, reason = DELEGATION_END_REASONS.HANDOVER_CANCELLED } = {}) {
  if (!item?.delegation?.status) return;
  if (![DELEGATION_STATUSES.SCHEDULED, DELEGATION_STATUSES.ACTIVE].includes(item.delegation.status)) {
    return;
  }
  item.delegation.status = DELEGATION_STATUSES.CANCELLED;
  item.delegation.endedAt = new Date();
  item.delegation.endReason = reason;
  item.delegation.endedByUserId = endedByUserId;
}

export function endItemDelegation(item, { endedByUserId = null, reason = DELEGATION_END_REASONS.RETURN_DATE } = {}) {
  if (!item?.delegation?.status) return;
  if (![DELEGATION_STATUSES.SCHEDULED, DELEGATION_STATUSES.ACTIVE].includes(item.delegation.status)) {
    return;
  }
  item.delegation.status = DELEGATION_STATUSES.ENDED;
  item.delegation.endedAt = new Date();
  item.delegation.endReason = reason;
  item.delegation.endedByUserId = endedByUserId;
}

/**
 * Lazy activation / completion for one leave's embedded handover + delegations.
 */
export async function reconcileLeaveDelegations(leaveRequest) {
  if (!leaveRequest?.handover) return { changed: false };

  const handover = leaveRequest.handover;
  if ([HANDOVER_STATUSES.CANCELLED, HANDOVER_STATUSES.COMPLETED].includes(handover.status)) {
    return { changed: false };
  }

  const today = startOfTodayUtc();
  const from = parseDateOnly(toDateString(leaveRequest.fromDate));
  const to = parseDateOnly(toDateString(leaveRequest.toDate));
  let changed = false;

  if (handover.status === HANDOVER_STATUSES.APPROVED && from && from <= today && to && to >= today) {
    handover.status = HANDOVER_STATUSES.ACTIVE;
    handover.activatedAt = new Date();
    changed = true;
    for (const item of handover.items || []) {
      if (item.delegation?.status === DELEGATION_STATUSES.SCHEDULED) {
        item.delegation.status = DELEGATION_STATUSES.ACTIVE;
        item.delegation.activatedAt = new Date();
      }
      if (item.status === HANDOVER_ITEM_STATUSES.APPROVED) {
        item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
      }
    }
  }

  if (
    [HANDOVER_STATUSES.APPROVED, HANDOVER_STATUSES.ACTIVE].includes(handover.status) &&
    to &&
    to < today
  ) {
    handover.status = HANDOVER_STATUSES.COMPLETED;
    handover.completedAt = new Date();
    changed = true;
    for (const item of handover.items || []) {
      endItemDelegation(item, { reason: DELEGATION_END_REASONS.RETURN_DATE });
      if (
        [HANDOVER_ITEM_STATUSES.ACTIVE, HANDOVER_ITEM_STATUSES.APPROVED].includes(item.status)
      ) {
        item.status = HANDOVER_ITEM_STATUSES.COMPLETED;
      }
    }
  }

  return { changed };
}

export async function extendItemDelegation(item, newToDate, { allowReopen = false } = {}) {
  const toDate = parseDateOnly(toDateString(newToDate));
  if (!toDate) throw new HttpError(400, "Valid new end date is required.");
  item.coverageTo = toDate;
  if (item.delegation) {
    item.delegation.toDate = toDate;
    if (
      allowReopen &&
      item.delegation.status === DELEGATION_STATUSES.ENDED &&
      datesOverlapToday(item.delegation.fromDate, toDate)
    ) {
      item.delegation.status = DELEGATION_STATUSES.ACTIVE;
      item.delegation.endedAt = null;
      item.delegation.endReason = null;
      item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
    }
  }
  return toDate;
}

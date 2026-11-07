import mongoose from "mongoose";
import {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  HANDOVER_TRANSITIONS,
  HANDOVER_COORDINATABLE_STATUSES,
  DELEGATION_STATUSES,
} from "../constants/handoverConstants.js";
import { BACKUP_PROPOSAL_STATUSES } from "../models/LeaveBackupProposal.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { analyzeLeaveImpact } from "./leaveImpactAnalysisService.js";
import { getAuthenticatedEmployee } from "./workManagementService.js";
import { toDateString } from "./leaveService.js";
import {
  attachDelegationToItem,
  cancelItemDelegation,
  extendItemDelegation,
  reconcileLeaveDelegations,
  startOfTodayUtc,
} from "./taskDelegationService.js";
import { parseDateOnly } from "./leaveService.js";
import { HttpError } from "../utils/httpError.js";

function assertTransition(from, to) {
  const allowed = HANDOVER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new HttpError(400, `Invalid handover transition from ${from} to ${to}.`);
  }
}

async function recordAudit(models, actor, action, targetId, changes = {}) {
  const { AuditLog } = models || {};
  if (!AuditLog) return;
  try {
    await AuditLog.create({
      actorUserId: actor?._id || null,
      actorEmail: actor?.email || "system",
      actorRole: actor?.role || "SYSTEM",
      action,
      targetType: "LeaveRequest",
      targetId,
      changes,
    });
  } catch (err) {
    console.error("[leaveHandover] audit failed", err.message);
  }
}

async function notifyUser(models, { userId, title, message, link = "", metadata = {} }) {
  const { Notification } = models || {};
  if (!Notification || !userId) return;
  try {
    await Notification.create({
      userId,
      title,
      message,
      type: NOTIFICATION_TYPES.HANDOVER || NOTIFICATION_TYPES.LEAVE,
      link,
      metadata,
    });
  } catch (err) {
    console.error("[leaveHandover] notification failed", err.message);
  }
}

async function resolveActorContext(companyContext, user) {
  const { models } = companyContext || {};
  const employee = await getAuthenticatedEmployee(models, user);
  return { user, employee, isHr: user?.role === USER_ROLES.HR_ADMIN };
}

function hasHandover(leave) {
  return Boolean(leave?.handover && leave.handover.status);
}

function assertCanManageHandover(ctx, leave) {
  const { employee, isHr } = ctx;
  if (isHr) return true;
  if (employee && String(leave.employeeId) === String(employee._id)) return true;
  if (
    employee &&
    leave.handover?.managerEmployeeId &&
    String(leave.handover.managerEmployeeId) === String(employee._id)
  ) {
    return true;
  }
  throw new HttpError(403, "You are not authorised to manage this handover.");
}

function canViewHandover(ctx, leave) {
  const { employee, isHr } = ctx;
  if (isHr) return true;
  if (!employee || !leave?.handover) return false;
  const id = String(employee._id);
  if (String(leave.employeeId) === id) return true;
  if (leave.handover.managerEmployeeId && String(leave.handover.managerEmployeeId) === id) return true;
  return (leave.handover.items || []).some(
    (it) => it.backupEmployeeId && String(it.backupEmployeeId) === id
  );
}

function recomputeParentStatusAfterAcks(handover) {
  const activeItems = (handover.items || []).filter(
    (it) => it.status !== HANDOVER_ITEM_STATUSES.CANCELLED
  );
  if (activeItems.length === 0) return handover.status;

  const needsInfo = activeItems.some((it) => it.status === HANDOVER_ITEM_STATUSES.NEEDS_INFO);
  const declined = activeItems.some((it) => it.status === HANDOVER_ITEM_STATUSES.DECLINED);
  const awaiting = activeItems.some((it) => it.status === HANDOVER_ITEM_STATUSES.AWAITING_ACK);
  const allAcked = activeItems.every((it) =>
    [
      HANDOVER_ITEM_STATUSES.ACKNOWLEDGED,
      HANDOVER_ITEM_STATUSES.APPROVED,
      HANDOVER_ITEM_STATUSES.ACTIVE,
      HANDOVER_ITEM_STATUSES.COMPLETED,
    ].includes(it.status)
  );

  if (needsInfo || declined) return HANDOVER_STATUSES.NEEDS_REVISION;
  if (awaiting) return HANDOVER_STATUSES.AWAITING_BACKUP_ACKNOWLEDGEMENT;
  if (allAcked) return HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW;
  return handover.status;
}

/**
 * API-compatible handover DTO. `_id` is the LeaveRequest id (one handover per leave).
 */
async function enrichHandover(companyContext, leave) {
  const { models } = companyContext || {};
  const { Employee } = models || {};
  if (!leave?.handover) return null;

  const ids = new Set();
  ids.add(String(leave.employeeId));
  if (leave.handover.managerEmployeeId) ids.add(String(leave.handover.managerEmployeeId));
  for (const it of leave.handover.items || []) {
    if (it.backupEmployeeId) ids.add(String(it.backupEmployeeId));
  }

  const employees = Employee
    ? await Employee.find({ _id: { $in: [...ids] } })
        .select("fullName employeeCode job.department job.jobTitle email userId")
        .lean()
    : [];
  const byId = new Map(employees.map((e) => [String(e._id), e]));

  const mapEmp = (id) => {
    const e = byId.get(String(id));
    if (!e) return null;
    return {
      _id: e._id,
      fullName: e.fullName,
      employeeCode: e.employeeCode,
      department: e.job?.department || null,
      jobTitle: e.job?.jobTitle || null,
    };
  };

  const h = leave.handover;
  return {
    _id: leave._id,
    leaveRequestId: leave._id,
    originalEmployeeId: leave.employeeId,
    managerEmployeeId: h.managerEmployeeId,
    status: h.status,
    leaveWindow: { fromDate: leave.fromDate, toDate: leave.toDate },
    generalNotes: h.generalNotes || "",
    items: (h.items || []).map((it) => ({
      ...((typeof it.toObject === "function" ? it.toObject() : it) || {}),
      backupEmployee: mapEmp(it.backupEmployeeId),
    })),
    createdByUserId: h.createdByUserId,
    submittedAt: h.submittedAt,
    submittedByUserId: h.submittedByUserId,
    approvedAt: h.approvedAt,
    approvedByUserId: h.approvedByUserId,
    activatedAt: h.activatedAt,
    completedAt: h.completedAt,
    cancelledAt: h.cancelledAt,
    cancelReason: h.cancelReason,
    revisionReason: h.revisionReason,
    schemaVersion: h.schemaVersion || 1,
    createdAt: leave.createdAt,
    updatedAt: leave.updatedAt,
    originalEmployee: mapEmp(leave.employeeId),
    managerEmployee: mapEmp(h.managerEmployeeId),
    peopleFirst: {
      leaveApprovalIndependent: true,
      incompleteHandoverDoesNotBlockLeave: true,
      proposalIsNotAssignment: true,
    },
  };
}

async function loadLeaveForHandover(models, leaveRequestId) {
  const { LeaveRequest } = models || {};
  if (!LeaveRequest) throw new HttpError(500, "Leave models unavailable.");
  if (!mongoose.Types.ObjectId.isValid(leaveRequestId)) {
    throw new HttpError(400, "Invalid leave request id.");
  }
  const leave = await LeaveRequest.findById(leaveRequestId);
  if (!leave) throw new HttpError(404, "Leave request not found.");
  return leave;
}

export async function createOrGetHandover(companyContext, leaveRequestId, user) {
  const { models } = companyContext || {};
  const { LeaveRequest, LeaveBackupProposal, Employee, Task } = models || {};
  const leave = await loadLeaveForHandover(models, leaveRequestId);
  const ctx = await resolveActorContext(companyContext, user);

  if (hasHandover(leave)) {
    if (!canViewHandover(ctx, leave)) {
      throw new HttpError(403, "You are not authorised to view this handover.");
    }
    await reconcileLeaveDelegations(leave);
    if (leave.isModified("handover")) {
      leave.markModified("handover");
      await leave.save();
    }
    return enrichHandover(companyContext, leave.toObject());
  }

  const original = await Employee.findById(leave.employeeId).lean();
  if (!original) throw new HttpError(404, "Employee not found.");

  const isOwner = ctx.employee && String(ctx.employee._id) === String(original._id);
  const isManager =
    ctx.employee &&
    original.job?.reportingManagerId &&
    String(ctx.employee._id) === String(original.job.reportingManagerId);
  if (!ctx.isHr && !isOwner && !isManager) {
    throw new HttpError(403, "Only the employee, reporting manager, or HR can initiate a handover.");
  }

  const impact = await analyzeLeaveImpact(
    companyContext,
    leave.employeeId,
    leave.fromDate,
    leave.toDate,
    { leaveRequestId: leave._id }
  );
  const coverage = impact.responsibilities?.requiresCoverageDuringLeave || [];

  const proposals = LeaveBackupProposal
    ? await LeaveBackupProposal.find({
        leaveRequestId: leave._id,
        status: BACKUP_PROPOSAL_STATUSES.PROPOSED,
        proposedBackupEmployeeId: { $ne: null },
      }).lean()
    : [];
  const proposalByTask = new Map(proposals.map((p) => [String(p.taskId), p]));

  const taskIds = coverage.map((t) => t._id);
  const tasks = taskIds.length
    ? await Task.find({ _id: { $in: taskIds } })
        .select("title priority deadline status assigneeId")
        .lean()
    : [];
  const taskById = new Map(tasks.map((t) => [String(t._id), t]));

  const items = coverage.map((summary) => {
    const task = taskById.get(String(summary._id));
    const proposal = proposalByTask.get(String(summary._id));
    return {
      taskId: summary._id,
      proposalId: proposal?._id || null,
      backupEmployeeId: proposal?.proposedBackupEmployeeId || null,
      status: HANDOVER_ITEM_STATUSES.DRAFT,
      coverageFrom: leave.fromDate,
      coverageTo: leave.toDate,
      instructions: "",
      outstandingWork: "",
      importantDeadlines: summary.deadline ? `Deadline: ${summary.deadline}` : "",
      dependencies: "",
      documentLinks: [],
      attachments: [],
      taskSnapshot: {
        title: summary.title || task?.title || "",
        priority: summary.priority || task?.priority || "",
        deadline: task?.deadline || null,
        status: summary.status || task?.status || "",
      },
      delegation: null,
    };
  });

  leave.handover = {
    status: HANDOVER_STATUSES.DRAFT,
    managerEmployeeId: original.job?.reportingManagerId || null,
    generalNotes: "",
    items,
    createdByUserId: user._id,
    schemaVersion: 1,
  };
  leave.markModified("handover");
  await leave.save();

  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_CREATED, leave._id, {
    leaveRequestId: leave._id,
    itemCount: items.length,
  });

  return enrichHandover(companyContext, leave.toObject());
}

export async function getHandoverById(companyContext, handoverId, user) {
  // handoverId === leaveRequestId in embedded architecture
  const leave = await loadLeaveForHandover(companyContext.models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  if (!canViewHandover(ctx, leave)) {
    throw new HttpError(403, "You are not authorised to view this handover.");
  }

  const { changed } = await reconcileLeaveDelegations(leave);
  if (changed) {
    leave.markModified("handover");
    await leave.save();
  }
  return enrichHandover(companyContext, leave.toObject());
}

export async function getHandoverForLeave(companyContext, leaveRequestId, user) {
  const leave = await loadLeaveForHandover(companyContext.models, leaveRequestId);
  if (!hasHandover(leave)) return null;

  const ctx = await resolveActorContext(companyContext, user);
  if (!canViewHandover(ctx, leave)) {
    throw new HttpError(403, "You are not authorised to view this handover.");
  }

  const { changed } = await reconcileLeaveDelegations(leave);
  if (changed) {
    leave.markModified("handover");
    await leave.save();
  }
  return enrichHandover(companyContext, leave.toObject());
}

export async function updateHandoverDraft(companyContext, handoverId, user, payload = {}) {
  const { models } = companyContext || {};
  const { Employee } = models || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  assertCanManageHandover(ctx, leave);

  if (![HANDOVER_STATUSES.DRAFT, HANDOVER_STATUSES.NEEDS_REVISION].includes(leave.handover.status)) {
    throw new HttpError(400, "Handover can only be edited while in DRAFT or NEEDS_REVISION.");
  }

  if (typeof payload.generalNotes === "string") {
    leave.handover.generalNotes = payload.generalNotes.trim().slice(0, 4000);
  }

  if (Array.isArray(payload.items)) {
    for (const patch of payload.items) {
      if (!patch?.itemId) continue;
      const item = leave.handover.items.id(patch.itemId);
      if (!item) continue;
      if (typeof patch.instructions === "string") {
        item.instructions = patch.instructions.trim().slice(0, 4000);
      }
      if (typeof patch.outstandingWork === "string") {
        item.outstandingWork = patch.outstandingWork.trim().slice(0, 2000);
      }
      if (typeof patch.importantDeadlines === "string") {
        item.importantDeadlines = patch.importantDeadlines.trim().slice(0, 1000);
      }
      if (typeof patch.dependencies === "string") {
        item.dependencies = patch.dependencies.trim().slice(0, 2000);
      }
      if (Array.isArray(patch.documentLinks)) {
        item.documentLinks = patch.documentLinks
          .filter((l) => l && (l.url || l.label))
          .slice(0, 10)
          .map((l) => ({
            label: String(l.label || "").slice(0, 120),
            url: String(l.url || "").slice(0, 500),
          }));
      }
      if (patch.backupEmployeeId !== undefined) {
        if (patch.backupEmployeeId === null || patch.backupEmployeeId === "") {
          item.backupEmployeeId = null;
        } else {
          if (!mongoose.Types.ObjectId.isValid(patch.backupEmployeeId)) {
            throw new HttpError(400, "Invalid backup employee id.");
          }
          if (String(patch.backupEmployeeId) === String(leave.employeeId)) {
            throw new HttpError(400, "Cannot assign the leave-taker as their own backup.");
          }
          const backup = await Employee.findById(patch.backupEmployeeId).lean();
          if (!backup || backup.status !== EMPLOYEE_STATUSES.ACTIVE) {
            throw new HttpError(400, "Backup employee must be an active employee.");
          }
          item.backupEmployeeId = backup._id;
        }
      }
    }
  }

  leave.markModified("handover");
  await leave.save();
  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_UPDATED, leave._id, {
    fields: Object.keys(payload || {}),
  });
  return enrichHandover(companyContext, leave.toObject());
}

/**
 * Employee/HR requests manager coordination (no peer acknowledgement).
 * Prefer `coordinateHandoverCoverage` when HR can arrange coverage immediately.
 */
export async function submitHandover(companyContext, handoverId, user) {
  const { models } = companyContext || {};
  const { Employee } = models || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  assertCanManageHandover(ctx, leave);

  // HR/manager can coordinate in one step instead of a separate request
  if (
    ctx.isHr ||
    (ctx.employee &&
      leave.handover.managerEmployeeId &&
      String(ctx.employee._id) === String(leave.handover.managerEmployeeId))
  ) {
    return coordinateHandoverCoverage(companyContext, handoverId, user, {});
  }

  const from = leave.handover.status;
  if (
    ![
      HANDOVER_STATUSES.DRAFT,
      HANDOVER_STATUSES.NEEDS_REVISION,
      HANDOVER_STATUSES.SUBMITTED,
    ].includes(from)
  ) {
    throw new HttpError(400, "Handover cannot be submitted from its current status.");
  }

  const activeItems = leave.handover.items.filter(
    (it) => it.status !== HANDOVER_ITEM_STATUSES.CANCELLED
  );
  if (activeItems.length === 0) {
    throw new HttpError(400, "Add at least one responsibility before requesting coordination.");
  }
  for (const item of activeItems) {
    if (!item.backupEmployeeId) {
      throw new HttpError(
        400,
        `Select a coverage employee for task "${item.taskSnapshot?.title || item.taskId}".`
      );
    }
  }

  const to = HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW;
  if (from !== to) assertTransition(from, to);

  leave.handover.status = to;
  leave.handover.submittedAt = new Date();
  leave.handover.submittedByUserId = user._id;
  leave.handover.revisionReason = "";

  for (const item of activeItems) {
    item.status = HANDOVER_ITEM_STATUSES.DRAFT;
  }

  leave.markModified("handover");
  await leave.save();

  if (leave.handover.managerEmployeeId) {
    const mgr = await Employee.findById(leave.handover.managerEmployeeId).select("userId").lean();
    await notifyUser(models, {
      userId: mgr?.userId,
      title: "Coverage coordination requested",
      message: "A leave handover is ready for manager coordination of temporary coverage.",
      link: "/admin/leave",
      metadata: { handoverId: String(leave._id) },
    });
  }

  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_SUBMITTED, leave._id, {
    itemCount: activeItems.length,
    path: "request_coordination",
  });
  return enrichHandover(companyContext, leave.toObject());
}

/**
 * Employee-to-employee acknowledgement is retired.
 * Coverage is coordinated by HR/manager via coordinateHandoverCoverage.
 */
export async function respondToHandoverItem() {
  throw new HttpError(
    410,
    "Backup acknowledgement is no longer part of the handover workflow. HR or the reporting manager coordinates temporary coverage."
  );
}

/**
 * HR/manager coordinates temporary coverage in one step.
 * Creates SCHEDULED/ACTIVE delegations without changing Task.assigneeId.
 * Does not require receiving-employee approval.
 */
export async function coordinateHandoverCoverage(companyContext, handoverId, user, payload = {}) {
  const { models } = companyContext || {};
  const { Employee, Task } = models || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  const isManager =
    ctx.employee &&
    leave.handover.managerEmployeeId &&
    String(ctx.employee._id) === String(leave.handover.managerEmployeeId);
  if (!ctx.isHr && !isManager) {
    throw new HttpError(403, "Only the reporting manager or HR can coordinate temporary coverage.");
  }

  if (!HANDOVER_COORDINATABLE_STATUSES.includes(leave.handover.status)) {
    throw new HttpError(
      400,
      `Coverage cannot be coordinated from status ${leave.handover.status}.`
    );
  }

  const activeItems = leave.handover.items.filter(
    (it) => it.status !== HANDOVER_ITEM_STATUSES.CANCELLED
  );
  if (activeItems.length === 0) {
    throw new HttpError(400, "Add at least one responsibility before coordinating coverage.");
  }
  for (const item of activeItems) {
    if (!item.backupEmployeeId) {
      throw new HttpError(
        400,
        `Select a coverage employee for "${item.taskSnapshot?.title || item.taskId}".`
      );
    }
    if (String(item.backupEmployeeId) === String(leave.employeeId)) {
      throw new HttpError(400, "An employee cannot cover their own responsibilities.");
    }
  }

  const from = leave.handover.status;
  if (from !== HANDOVER_STATUSES.APPROVED) {
    assertTransition(from, HANDOVER_STATUSES.APPROVED);
  }
  leave.handover.status = HANDOVER_STATUSES.APPROVED;
  leave.handover.approvedAt = new Date();
  leave.handover.approvedByUserId = user._id;
  leave.handover.submittedAt = leave.handover.submittedAt || new Date();
  leave.handover.revisionReason = "";

  const today = startOfTodayUtc();
  const notes = String(payload.notes || "").trim().slice(0, 2000);

  for (const item of activeItems) {
    item.status = HANDOVER_ITEM_STATUSES.APPROVED;
    item.managerDecision = {
      decision: "APPROVE",
      reason: notes,
      decidedAt: new Date(),
      decidedByUserId: user._id,
    };

    const task = await Task.findById(item.taskId).lean();
    if (!task) continue;
    const fromDate = item.coverageFrom || leave.fromDate;
    const toDate = item.coverageTo || leave.toDate;
    const shouldActivate =
      parseDateOnly(toDateString(fromDate)) <= today &&
      parseDateOnly(toDateString(toDate)) >= today;

    if (
      item.delegation &&
      [DELEGATION_STATUSES.ACTIVE, DELEGATION_STATUSES.SCHEDULED].includes(item.delegation.status)
    ) {
      cancelItemDelegation(item, { endedByUserId: user._id });
    }

    await attachDelegationToItem(models, leave, item, {
      originalAssigneeId: task.assigneeId,
      delegateEmployeeId: item.backupEmployeeId,
      fromDate,
      toDate,
      createdByUserId: user._id,
      activateNow: shouldActivate,
    });
    if (shouldActivate) item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
  }

  const anyActive = leave.handover.items.some((i) => i.status === HANDOVER_ITEM_STATUSES.ACTIVE);
  if (anyActive) {
    if (leave.handover.status === HANDOVER_STATUSES.APPROVED) {
      assertTransition(HANDOVER_STATUSES.APPROVED, HANDOVER_STATUSES.ACTIVE);
    }
    leave.handover.status = HANDOVER_STATUSES.ACTIVE;
    leave.handover.activatedAt = new Date();
  }

  leave.markModified("handover");
  await leave.save();

  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_APPROVED, leave._id, {
    coordinated: true,
    itemCount: activeItems.length,
  });
  await recordAudit(models, user, AUDIT_ACTIONS.TASK_DELEGATED, leave._id, {
    items: activeItems.length,
  });

  const original = await Employee.findById(leave.employeeId).select("userId").lean();
  await notifyUser(models, {
    userId: original?.userId,
    title: "Temporary coverage arranged",
    message: "A manager or HR coordinated temporary coverage for your leave responsibilities.",
    link: "/app/dashboard",
    metadata: { handoverId: String(leave._id) },
  });

  for (const item of activeItems) {
    const b = await Employee.findById(item.backupEmployeeId).select("userId").lean();
    await notifyUser(models, {
      userId: b?.userId,
      title: "Temporary coverage assigned to you",
      message:
        "You have temporary coverage for a colleague's task. It appears on your Dashboard and Tasks.",
      link: item.taskId ? `/app/tasks?task=${item.taskId}` : "/app/tasks",
      metadata: { handoverId: String(leave._id), taskId: String(item.taskId) },
    });
  }

  return enrichHandover(companyContext, leave.toObject());
}


export async function reassignHandoverItemBackup(
  companyContext,
  handoverId,
  itemId,
  user,
  backupEmployeeId
) {
  const { models } = companyContext || {};
  const { Employee } = models || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  assertCanManageHandover(ctx, leave);

  const item = leave.handover.items.id(itemId);
  if (!item) throw new HttpError(404, "Handover item not found.");

  if (
    ![
      HANDOVER_STATUSES.DRAFT,
      HANDOVER_STATUSES.NEEDS_REVISION,
      HANDOVER_STATUSES.AWAITING_BACKUP_ACKNOWLEDGEMENT,
      HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW,
    ].includes(leave.handover.status)
  ) {
    throw new HttpError(400, "Backup cannot be changed in the current handover status.");
  }

  if (!mongoose.Types.ObjectId.isValid(backupEmployeeId)) {
    throw new HttpError(400, "Invalid backup employee id.");
  }
  if (String(backupEmployeeId) === String(leave.employeeId)) {
    throw new HttpError(400, "Cannot assign the leave-taker as their own backup.");
  }
  const backup = await Employee.findById(backupEmployeeId).lean();
  if (!backup || backup.status !== EMPLOYEE_STATUSES.ACTIVE) {
    throw new HttpError(400, "Backup employee must be active.");
  }

  item.backupEmployeeId = backup._id;
  item.status = HANDOVER_ITEM_STATUSES.DRAFT;
  item.backupResponse = {
    decision: null,
    comment: "",
    respondedAt: null,
    respondedByUserId: null,
  };

  // Keep in coordination-ready draft states — no peer acknowledgement loop
  if (
    [HANDOVER_STATUSES.NEEDS_REVISION, HANDOVER_STATUSES.AWAITING_BACKUP_ACKNOWLEDGEMENT].includes(
      leave.handover.status
    )
  ) {
    assertTransition(leave.handover.status, HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW);
    leave.handover.status = HANDOVER_STATUSES.READY_FOR_MANAGER_REVIEW;
  }

  leave.markModified("handover");
  await leave.save();

  await notifyUser(models, {
    userId: backup.userId,
    title: "Selected for temporary coverage",
    message:
      "You have been selected as the coverage employee for a leave responsibility. Coverage activates when HR or a manager coordinates it.",
    link: "/app/leave?tab=handovers",
    metadata: { handoverId: String(leave._id), itemId: String(itemId) },
  });
  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_ITEM_REASSIGNED, leave._id, {
    itemId,
    backupEmployeeId,
  });

  return enrichHandover(companyContext, leave.toObject());
}

export async function managerDecideHandover(companyContext, handoverId, user, payload = {}) {
  const { models } = companyContext || {};
  const { Employee, Task } = models || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  const isManager =
    ctx.employee &&
    leave.handover.managerEmployeeId &&
    String(ctx.employee._id) === String(leave.handover.managerEmployeeId);
  if (!ctx.isHr && !isManager) {
    throw new HttpError(403, "Only the reporting manager or HR can approve this handover.");
  }

  const decision = String(payload.decision || "").toUpperCase();
  if (!["APPROVE", "REVISE", "REJECT", "COORDINATE"].includes(decision)) {
    throw new HttpError(400, "decision must be APPROVE, COORDINATE, REVISE, or REJECT.");
  }
  if ((decision === "REVISE" || decision === "REJECT") && !String(payload.reason || "").trim()) {
    throw new HttpError(400, "A reason is required when requesting revision or rejecting a handover.");
  }

  if (decision === "APPROVE" || decision === "COORDINATE") {
    // One-step coordination — no employee acknowledgement required
    return coordinateHandoverCoverage(companyContext, handoverId, user, {
      notes: payload.reason || payload.notes || "",
    });
  } else if (decision === "REVISE") {
    if (!HANDOVER_COORDINATABLE_STATUSES.includes(leave.handover.status)) {
      throw new HttpError(400, "Handover cannot be revised from its current status.");
    }
    assertTransition(leave.handover.status, HANDOVER_STATUSES.NEEDS_REVISION);
    leave.handover.status = HANDOVER_STATUSES.NEEDS_REVISION;
    leave.handover.revisionReason = String(payload.reason || "").trim();
    for (const item of leave.handover.items) {
      if (item.status !== HANDOVER_ITEM_STATUSES.CANCELLED) {
        item.status = HANDOVER_ITEM_STATUSES.DRAFT;
        item.managerDecision = {
          decision: "REVISE",
          reason: leave.handover.revisionReason,
          decidedAt: new Date(),
          decidedByUserId: user._id,
        };
      }
    }
    leave.markModified("handover");
    await leave.save();
    await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_REVISION_REQUESTED, leave._id, {
      reason: leave.handover.revisionReason,
    });
    const original = await Employee.findById(leave.employeeId).select("userId").lean();
    await notifyUser(models, {
      userId: original?.userId,
      title: "Handover needs revision",
      message: leave.handover.revisionReason || "Please update the handover and resubmit.",
      link: "/app/leave?tab=handovers",
      metadata: { handoverId: String(leave._id) },
    });
  } else {
    assertTransition(leave.handover.status, HANDOVER_STATUSES.CANCELLED);
    leave.handover.status = HANDOVER_STATUSES.CANCELLED;
    leave.handover.cancelledAt = new Date();
    leave.handover.cancelReason = String(payload.reason || "").trim();
    for (const item of leave.handover.items) {
      item.status = HANDOVER_ITEM_STATUSES.CANCELLED;
      cancelItemDelegation(item, { endedByUserId: user._id });
      item.managerDecision = {
        decision: "REJECT",
        reason: leave.handover.cancelReason,
        decidedAt: new Date(),
        decidedByUserId: user._id,
      };
    }
    leave.markModified("handover");
    await leave.save();
    await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_CANCELLED, leave._id, {
      reason: leave.handover.cancelReason,
    });
  }

  return enrichHandover(companyContext, leave.toObject());
}

export async function cancelHandover(companyContext, handoverId, user, reason = "") {
  const { models } = companyContext || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  assertCanManageHandover(ctx, leave);

  if ([HANDOVER_STATUSES.COMPLETED, HANDOVER_STATUSES.CANCELLED].includes(leave.handover.status)) {
    throw new HttpError(400, "Handover is already closed.");
  }

  if (!HANDOVER_TRANSITIONS[leave.handover.status]?.includes(HANDOVER_STATUSES.CANCELLED)) {
    throw new HttpError(400, "Handover cannot be cancelled from its current status.");
  }
  assertTransition(leave.handover.status, HANDOVER_STATUSES.CANCELLED);

  leave.handover.status = HANDOVER_STATUSES.CANCELLED;
  leave.handover.cancelledAt = new Date();
  leave.handover.cancelReason = String(reason || "").trim();
  for (const item of leave.handover.items) {
    item.status = HANDOVER_ITEM_STATUSES.CANCELLED;
    cancelItemDelegation(item, { endedByUserId: user._id });
  }
  leave.markModified("handover");
  await leave.save();

  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_CANCELLED, leave._id, {
    reason: leave.handover.cancelReason,
  });
  return enrichHandover(companyContext, leave.toObject());
}

export async function listMyHandovers(companyContext, user) {
  const { models } = companyContext || {};
  const { LeaveRequest } = models || {};
  const ctx = await resolveActorContext(companyContext, user);
  if (!ctx.employee && !ctx.isHr) return { outgoing: [], incoming: [], managing: [] };

  const empId = ctx.employee?._id;
  const [outgoing, incoming, managing] = await Promise.all([
    empId
      ? LeaveRequest.find({ employeeId: empId, handover: { $ne: null }, "handover.status": { $exists: true } })
          .sort({ updatedAt: -1 })
          .limit(50)
      : [],
    empId
      ? LeaveRequest.find({ "handover.items.backupEmployeeId": empId })
          .sort({ updatedAt: -1 })
          .limit(50)
      : [],
    empId
      ? LeaveRequest.find({ "handover.managerEmployeeId": empId })
          .sort({ updatedAt: -1 })
          .limit(50)
      : [],
  ]);

  const mapList = async (rows, filterItemsForBackup = false) => {
    const out = [];
    for (const leave of rows) {
      if (!hasHandover(leave)) continue;
      const { changed } = await reconcileLeaveDelegations(leave);
      if (changed) {
        leave.markModified("handover");
        await leave.save();
      }
      const enriched = await enrichHandover(companyContext, leave.toObject());
      if (filterItemsForBackup) {
        enriched.items = (enriched.items || []).filter(
          (it) => it.backupEmployeeId && String(it.backupEmployeeId) === String(empId)
        );
      }
      out.push(enriched);
    }
    return out;
  };

  return {
    outgoing: await mapList(outgoing),
    incoming: await mapList(incoming, true),
    managing: await mapList(managing),
  };
}

export async function listHandoversForHr(companyContext, user, filters = {}) {
  const { models } = companyContext || {};
  const { LeaveRequest } = models || {};
  const ctx = await resolveActorContext(companyContext, user);
  if (!ctx.isHr) throw new HttpError(403, "HR access required.");

  let query = { handover: { $ne: null }, "handover.status": { $exists: true, $ne: null } };
  if (filters.status) query["handover.status"] = filters.status;
  if (filters.employeeId && mongoose.Types.ObjectId.isValid(filters.employeeId)) {
    query.employeeId = filters.employeeId;
  }
  if (filters.hrAccess) {
    const { mergeEmployeeIdScopeFilter } = await import("./hrAccessEnforcementService.js");
    query = mergeEmployeeIdScopeFilter(filters.hrAccess, query);
  }

  const rows = await LeaveRequest.find(query).sort({ updatedAt: -1 }).limit(100);
  const out = [];
  for (const leave of rows) {
    if (!hasHandover(leave)) continue;
    out.push(await enrichHandover(companyContext, leave.toObject()));
  }
  return out;
}

export async function extendDelegation(companyContext, handoverId, itemId, user, newToDate) {
  const { models } = companyContext || {};
  const leave = await loadLeaveForHandover(models, handoverId);
  if (!hasHandover(leave)) throw new HttpError(404, "Handover not found.");

  const ctx = await resolveActorContext(companyContext, user);
  const isManager =
    ctx.employee &&
    leave.handover.managerEmployeeId &&
    String(ctx.employee._id) === String(leave.handover.managerEmployeeId);
  if (!ctx.isHr && !isManager) {
    throw new HttpError(403, "Only the manager or HR can extend a delegation.");
  }

  const item = leave.handover.items.id(itemId);
  if (!item) throw new HttpError(404, "Handover item not found.");

  const toDate = await extendItemDelegation(item, newToDate, { allowReopen: true });
  if (leave.handover.status === HANDOVER_STATUSES.COMPLETED) {
    const today = startOfTodayUtc();
    if (toDate >= today) {
      leave.handover.status = HANDOVER_STATUSES.ACTIVE;
      leave.handover.completedAt = null;
      item.status = HANDOVER_ITEM_STATUSES.ACTIVE;
    }
  }

  leave.markModified("handover");
  await leave.save();
  await recordAudit(models, user, AUDIT_ACTIONS.HANDOVER_UPDATED, leave._id, {
    action: "EXTEND_DELEGATION",
    itemId,
    newToDate: toDateString(toDate),
  });
  return enrichHandover(companyContext, leave.toObject());
}

/**
 * Leave decision side-effect: cancel handover on reject; reconcile window on approve.
 * Never blocks leave approval.
 */
export async function onLeaveDecisionSideEffect(companyContext, leaveRequest, action, actorUser) {
  const { models } = companyContext || {};
  const { LeaveRequest } = models || {};
  if (!LeaveRequest || !leaveRequest) return;

  const leave = await LeaveRequest.findById(leaveRequest._id);
  if (!leave || !hasHandover(leave)) return;

  if (action === "REJECT") {
    if (![HANDOVER_STATUSES.COMPLETED, HANDOVER_STATUSES.CANCELLED].includes(leave.handover.status)) {
      try {
        await cancelHandover(companyContext, leave._id, actorUser, "Leave request was rejected.");
      } catch (err) {
        console.error("[leaveHandover] cancel on leave reject failed", err.message);
      }
    }
    return;
  }

  if (action === "APPROVE") {
    const { changed } = await reconcileLeaveDelegations(leave);
    if (changed) {
      leave.markModified("handover");
      await leave.save();
    }
  }
}

// Re-export delegation helpers used by task/work services (facade for stable imports during transition)
export {
  getActiveDelegationForActor,
  listCoveringTaskIds,
  listCoveringResponsibilitySummaries,
} from "./taskDelegationService.js";

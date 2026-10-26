import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { TASK_STATUSES, TASK_PRIORITIES } from "../models/Task.js";
import { TRANSACTION_TYPES, TRANSACTION_SOURCES } from "../models/ImpactPointTransaction.js";
import { getActiveCompanyHrPolicy, DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { USER_ROLES } from "../models/User.js";

/**
 * Resolves the Employee document for the currently authenticated User.
 */
export async function getAuthenticatedEmployee(models, user) {
  if (!user) return null;
  const { Employee } = models;
  return Employee.findOne({
    $or: [{ userId: user._id }, { email: user.email.toLowerCase() }],
  });
}

/**
 * Checks whether an actor is authorized to review or approve a task.
 * Enforces independent review: assignee can NEVER approve their own task.
 */
export function isAuthorizedReviewer(task, user, actorEmployee) {
  if (!task || !user) return false;

  const assigneeIdStr = String(task.assigneeId || "");
  const actorEmpIdStr = actorEmployee ? String(actorEmployee._id) : "";

  // Strict anti-self-approval guard: employee cannot approve their own task
  if (actorEmpIdStr && assigneeIdStr && actorEmpIdStr === assigneeIdStr) {
    return false;
  }

  // HR Admin can review/approve any task (except their own self-assigned tasks)
  if (user.role === USER_ROLES.HR_ADMIN) {
    return true;
  }

  // Direct assigning manager can review
  if (task.assignedByEmployeeId && actorEmpIdStr && String(task.assignedByEmployeeId) === actorEmpIdStr) {
    return true;
  }

  return false;
}

/**
 * Validates whether an assigner can assign a task to the target employee.
 */
export async function canAssignTask(models, user, actorEmployee, targetEmployee) {
  if (!user || !targetEmployee) return false;

  // HR_ADMIN can assign tasks across the company
  if (user.role === USER_ROLES.HR_ADMIN) {
    return true;
  }

  // Manager can assign to their direct reporting subordinates
  if (actorEmployee && targetEmployee.job?.reportingManagerId) {
    if (String(targetEmployee.job.reportingManagerId) === String(actorEmployee._id)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates and assigns a new task.
 */
export async function createTaskService({ models, user, data }) {
  const { Task, Employee, AuditLog } = models;
  const actorEmployee = await getAuthenticatedEmployee(models, user);

  const {
    title,
    description,
    assigneeId,
    department,
    projectName,
    priority = TASK_PRIORITIES.MEDIUM,
    acceptanceCriteria = [],
    startDate,
    deadline,
  } = data;

  if (!title || typeof title !== "string" || !title.trim()) {
    throw new HttpError(400, "Task title is required");
  }
  if (!description || typeof description !== "string" || !description.trim()) {
    throw new HttpError(400, "Task description is required");
  }
  if (!assigneeId) {
    throw new HttpError(400, "Assignee employee ID is required");
  }
  if (!deadline) {
    throw new HttpError(400, "Task deadline is required");
  }

  const parsedDeadline = new Date(deadline);
  if (Number.isNaN(parsedDeadline.getTime())) {
    throw new HttpError(400, "Invalid deadline date format");
  }

  const targetEmployee = await Employee.findById(assigneeId);
  if (!targetEmployee) {
    throw new HttpError(404, "Assignee employee record not found in tenant database");
  }

  const authorized = await canAssignTask(models, user, actorEmployee, targetEmployee);
  if (!authorized) {
    throw new HttpError(
      403,
      "You are not authorized to assign tasks to this employee. Only HR Admins and direct reporting managers can assign tasks."
    );
  }

  const parsedCriteria = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map((c) => String(c).trim()).filter(Boolean)
    : typeof acceptanceCriteria === "string" && acceptanceCriteria.trim()
    ? [acceptanceCriteria.trim()]
    : [];

  const task = await Task.create({
    title: title.trim(),
    description: description.trim(),
    assigneeId: targetEmployee._id,
    assigneeSnapshot: {
      fullName: targetEmployee.fullName,
      employeeCode: targetEmployee.employeeCode,
      email: targetEmployee.email,
      department: targetEmployee.job?.department || department || "",
    },
    assignedByUserId: user._id,
    assignedByEmployeeId: actorEmployee?._id || null,
    assignedBySnapshot: {
      fullName: actorEmployee?.fullName || user.email,
      role: user.role,
      email: user.email,
    },
    department: department || targetEmployee.job?.department || "",
    projectName: projectName || targetEmployee.job?.project?.projectName || "",
    priority: Object.values(TASK_PRIORITIES).includes(priority) ? priority : TASK_PRIORITIES.MEDIUM,
    status: TASK_STATUSES.ASSIGNED,
    acceptanceCriteria: parsedCriteria,
    startDate: startDate ? new Date(startDate) : null,
    deadline: parsedDeadline,
  });

  if (AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "TASK_CREATED",
        targetType: "Task",
        targetId: task._id,
        changes: {
          title: task.title,
          assignee: targetEmployee.fullName,
          deadline: task.deadline,
          priority: task.priority,
        },
        timestamp: new Date(),
      });
    } catch {
      // Audit log non-blocking
    }
  }

  return task;
}

/**
 * Transitions task from ASSIGNED to IN_PROGRESS.
 */
export async function startTaskService({ models, user, taskId }) {
  const { Task } = models;
  const actorEmployee = await getAuthenticatedEmployee(models, user);
  const task = await Task.findById(taskId);

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

  const isAssignee = actorEmployee && String(task.assigneeId) === String(actorEmployee._id);
  const isReviewer = isAuthorizedReviewer(task, user, actorEmployee);

  if (!isAssignee && !isReviewer) {
    throw new HttpError(403, "Only the assigned employee or an authorized manager can start this task");
  }

  if (task.status !== TASK_STATUSES.ASSIGNED && task.status !== TASK_STATUSES.CHANGES_REQUESTED) {
    throw new HttpError(400, `Task cannot be moved to in-progress from status '${task.status}'`);
  }

  task.status = TASK_STATUSES.IN_PROGRESS;
  if (!task.startDate) {
    task.startDate = new Date();
  }
  await task.save();

  return task;
}

/**
 * Submits work deliverables and evidence for review.
 * Allowed from IN_PROGRESS or CHANGES_REQUESTED.
 */
export async function submitTaskEvidenceService({ models, user, taskId, deliverables = [], submissionNotes = "" }) {
  const { Task, AuditLog } = models;
  const actorEmployee = await getAuthenticatedEmployee(models, user);
  const task = await Task.findById(taskId);

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

  const isAssignee = actorEmployee && String(task.assigneeId) === String(actorEmployee._id);
  if (!isAssignee && user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(403, "Only the assigned employee can submit evidence for this task");
  }

  if (task.status !== TASK_STATUSES.IN_PROGRESS && task.status !== TASK_STATUSES.CHANGES_REQUESTED && task.status !== TASK_STATUSES.ASSIGNED) {
    throw new HttpError(400, `Task cannot be submitted from status '${task.status}'`);
  }

  const now = new Date();
  const formattedDeliverables = Array.isArray(deliverables)
    ? deliverables.map((d) => ({
        description: d.description || "",
        links: Array.isArray(d.links) ? d.links.filter(Boolean) : [],
        documentUrl: d.documentUrl || "",
        fileName: d.fileName || "",
        fileSize: d.fileSize || 0,
        mimeType: d.mimeType || "",
        storageKey: d.storageKey || "",
        submittedAt: now,
      }))
    : [];

  // If this is a resubmission, record previous attempt in history
  if (task.status === TASK_STATUSES.CHANGES_REQUESTED && task.submittedAt) {
    const historyEntry = {
      iteration: task.resubmissionHistory.length + 1,
      submittedAt: task.submittedAt,
      deliverables: task.deliverables || [],
      submissionNotes: task.submissionNotes || "",
      reviewedAt: task.review?.reviewedAt || null,
      reviewedBySnapshot: task.review?.reviewerSnapshot || {},
      decision: task.review?.decision || "",
      comments: task.review?.comments || "",
    };
    task.resubmissionHistory.push(historyEntry);
  }

  task.deliverables = formattedDeliverables;
  task.submissionNotes = typeof submissionNotes === "string" ? submissionNotes.trim() : "";
  task.submittedAt = now;
  task.status = TASK_STATUSES.SUBMITTED;

  // Reset review status for the new iteration
  task.review = {
    reviewedByUserId: null,
    reviewedByEmployeeId: null,
    reviewerSnapshot: {},
    reviewedAt: null,
    decision: null,
    comments: "",
  };

  await task.save();

  if (AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "TASK_SUBMITTED",
        targetType: "Task",
        targetId: task._id,
        changes: { status: TASK_STATUSES.SUBMITTED, deliverablesCount: formattedDeliverables.length },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }
  }

  return task;
}

/**
 * Reviews a submitted task: APPROVE, CHANGES_REQUESTED, or REJECT.
 * Approving triggers idempotent Impact Points awards.
 */
export async function reviewTaskService({ models, user, taskId, decision, comments = "" }) {
  const { Task, CompanyHrPolicy, ImpactPointTransaction, AuditLog } = models;
  const actorEmployee = await getAuthenticatedEmployee(models, user);
  const task = await Task.findById(taskId);

  if (!task) {
    throw new HttpError(404, "Task not found");
  }

  // Independent verification authorization guard
  const canReview = isAuthorizedReviewer(task, user, actorEmployee);
  if (!canReview) {
    throw new HttpError(
      403,
      "Unauthorized: You cannot review or approve this task. Independent authorized review is strictly required, and employees cannot approve their own work."
    );
  }

  if (task.status !== TASK_STATUSES.SUBMITTED) {
    throw new HttpError(400, `Only submitted tasks can be reviewed. Current status is '${task.status}'`);
  }

  const validDecisions = [TASK_STATUSES.APPROVED, TASK_STATUSES.CHANGES_REQUESTED, TASK_STATUSES.REJECTED];
  if (!validDecisions.includes(decision)) {
    throw new HttpError(400, `Invalid review decision '${decision}'. Must be APPROVED, CHANGES_REQUESTED, or REJECTED.`);
  }

  if ((decision === TASK_STATUSES.CHANGES_REQUESTED || decision === TASK_STATUSES.REJECTED) && (!comments || !comments.trim())) {
    throw new HttpError(400, "Review comments explaining the decision are required when rejecting or requesting changes.");
  }

  const now = new Date();
  task.review = {
    reviewedByUserId: user._id,
    reviewedByEmployeeId: actorEmployee?._id || null,
    reviewerSnapshot: {
      fullName: actorEmployee?.fullName || user.email,
      email: user.email,
      role: user.role,
    },
    reviewedAt: now,
    decision,
    comments: comments.trim(),
  };

  task.status = decision;

  if (decision === TASK_STATUSES.APPROVED) {
    task.completedAt = now;

    // Automatic Impact Points Calculation and Idempotent Ledger Transaction
    const pointsResult = await processTaskCompletionPoints({
      models,
      task,
      user,
      actorEmployee,
    });

    task.pointsAwarded = pointsResult.totalPointsAwarded;
    if (pointsResult.primaryTransactionId) {
      task.pointsTransactionId = pointsResult.primaryTransactionId;
    }
  }

  await task.save();

  if (AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        action: `TASK_${decision}`,
        targetType: "Task",
        targetId: task._id,
        changes: { status: decision, comments, pointsAwarded: task.pointsAwarded },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }
  }

  return task;
}

/**
 * Calculates and idempotently credits Impact Points for task completion
 * according to company HR policy rules.
 */
export async function processTaskCompletionPoints({ models, task, user, actorEmployee }) {
  const { CompanyHrPolicy, ImpactPointTransaction, Employee } = models;
  const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
  const ipRules = policy?.impactPointRules || DEFAULT_HR_POLICY.impactPointRules;

  if (!ipRules || ipRules.enabled === false) {
    return { totalPointsAwarded: 0, transactions: [] };
  }

  const activeRules = ipRules.rules?.length ? ipRules.rules : DEFAULT_HR_POLICY.impactPointRules.rules;
  const ruleMap = new Map(activeRules.map((r) => [r.ruleCode, r]));

  let totalPoints = 0;
  const transactions = [];
  let primaryTransactionId = null;

  const now = new Date();
  const submissionTime = task.submittedAt || task.completedAt || now;
  const deadlineTime = new Date(task.deadline);
  const isOnTime = submissionTime.getTime() <= deadlineTime.getTime();
  const isEarly = deadlineTime.getTime() - submissionTime.getTime() >= 24 * 60 * 60 * 1000; // at least 24h early
  const isHighPriority = task.priority === TASK_PRIORITIES.HIGH || task.priority === TASK_PRIORITIES.CRITICAL;

  // 1. On-Time Completion Rule
  const onTimeRule = ruleMap.get("ON_TIME_COMPLETION");
  if (isOnTime && onTimeRule && onTimeRule.isEnabled) {
    const idempotencyKey = `task_completion_ontime_${task._id}`;
    const tx = await createIdempotentTransaction({
      models,
      data: {
        employeeId: task.assigneeId,
        employeeSnapshot: task.assigneeSnapshot,
        points: onTimeRule.points,
        transactionType: TRANSACTION_TYPES.EARNED,
        source: TRANSACTION_SOURCES.TASK_COMPLETION,
        eventType: "ON_TIME_COMPLETION",
        reason: `Completed task '${task.title}' on time`,
        actorUserId: user._id,
        actorEmployeeId: actorEmployee?._id || null,
        actorSnapshot: {
          fullName: actorEmployee?.fullName || user.email,
          email: user.email,
          role: user.role,
        },
        taskId: task._id,
        idempotencyKey,
        metadata: { deadline: task.deadline, completedAt: task.completedAt },
      },
    });
    totalPoints += onTimeRule.points;
    transactions.push(tx);
    if (!primaryTransactionId) primaryTransactionId = tx._id;
  }

  // 2. Early Completion Bonus (if allowed by stacking rule)
  const earlyRule = ruleMap.get("EARLY_COMPLETION_BONUS");
  if (isEarly && earlyRule && earlyRule.isEnabled && (ipRules.allowRuleStacking !== false || !isOnTime)) {
    const idempotencyKey = `task_completion_early_${task._id}`;
    const tx = await createIdempotentTransaction({
      models,
      data: {
        employeeId: task.assigneeId,
        employeeSnapshot: task.assigneeSnapshot,
        points: earlyRule.points,
        transactionType: TRANSACTION_TYPES.EARNED,
        source: TRANSACTION_SOURCES.BONUS,
        eventType: "EARLY_COMPLETION_BONUS",
        reason: `Early completion bonus for task '${task.title}' (>24h ahead of deadline)`,
        actorUserId: user._id,
        actorEmployeeId: actorEmployee?._id || null,
        actorSnapshot: {
          fullName: actorEmployee?.fullName || user.email,
          email: user.email,
          role: user.role,
        },
        taskId: task._id,
        idempotencyKey,
        metadata: { deadline: task.deadline, completedAt: task.completedAt },
      },
    });
    totalPoints += earlyRule.points;
    transactions.push(tx);
    if (!primaryTransactionId) primaryTransactionId = tx._id;
  }

  // 3. High-Priority Bonus
  const highPriorityRule = ruleMap.get("HIGH_PRIORITY_COMPLETION");
  if (isHighPriority && highPriorityRule && highPriorityRule.isEnabled) {
    const idempotencyKey = `task_completion_high_priority_${task._id}`;
    const tx = await createIdempotentTransaction({
      models,
      data: {
        employeeId: task.assigneeId,
        employeeSnapshot: task.assigneeSnapshot,
        points: highPriorityRule.points,
        transactionType: TRANSACTION_TYPES.EARNED,
        source: TRANSACTION_SOURCES.BONUS,
        eventType: "HIGH_PRIORITY_COMPLETION",
        reason: `Completed high-priority task '${task.title}' (${task.priority})`,
        actorUserId: user._id,
        actorEmployeeId: actorEmployee?._id || null,
        actorSnapshot: {
          fullName: actorEmployee?.fullName || user.email,
          email: user.email,
          role: user.role,
        },
        taskId: task._id,
        idempotencyKey,
        metadata: { priority: task.priority },
      },
    });
    totalPoints += highPriorityRule.points;
    transactions.push(tx);
    if (!primaryTransactionId) primaryTransactionId = tx._id;
  }

  return { totalPointsAwarded: totalPoints, transactions, primaryTransactionId };
}

/**
 * Idempotently records an impact point transaction in the tenant collection.
 */
export async function createIdempotentTransaction({ models, data }) {
  const { ImpactPointTransaction } = models;

  // Check if transaction with this idempotency key already exists
  const existing = await ImpactPointTransaction.findOne({ idempotencyKey: data.idempotencyKey });
  if (existing) {
    return existing;
  }

  try {
    const tx = await ImpactPointTransaction.create(data);
    return tx;
  } catch (err) {
    // If duplicate key error caught under concurrent execution, return the existing record
    if (err.code === 11000) {
      return ImpactPointTransaction.findOne({ idempotencyKey: data.idempotencyKey });
    }
    throw err;
  }
}

/**
 * Manager Recognition workflow: awards points to an eligible subordinate or team member.
 */
export async function awardManagerRecognitionService({ models, user, recipientEmployeeId, points, reason, ruleCode }) {
  const { Employee, ImpactPointTransaction, CompanyHrPolicy, AuditLog } = models;
  const actorEmployee = await getAuthenticatedEmployee(models, user);

  if (!recipientEmployeeId) {
    throw new HttpError(400, "Recipient employee ID is required");
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new HttpError(400, "Reason for recognition is required");
  }

  const recipient = await Employee.findById(recipientEmployeeId);
  if (!recipient) {
    throw new HttpError(404, "Recipient employee not found in tenant database");
  }

  // Anti-self-award guard
  if (actorEmployee && String(actorEmployee._id) === String(recipient._id)) {
    throw new HttpError(400, "Self-recognition is prohibited: you cannot award Impact Points to yourself.");
  }

  // Authorization check: HR Admin or direct reporting manager
  const isHrAdmin = user.role === USER_ROLES.HR_ADMIN;
  const isManager = actorEmployee && recipient.job?.reportingManagerId && String(recipient.job.reportingManagerId) === String(actorEmployee._id);

  if (!isHrAdmin && !isManager) {
    throw new HttpError(
      403,
      "Unauthorized: Only HR Admins and direct reporting managers can award recognition points to this employee."
    );
  }

  // Policy validation
  const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
  const ipRules = policy?.impactPointRules;
  if (ipRules && ipRules.enabled === false) {
    throw new HttpError(400, "Impact Points system is currently disabled by company HR policy.");
  }

  let finalPoints = points;
  if (!finalPoints || typeof finalPoints !== "number") {
    const defaultRule = (ipRules?.rules || []).find((r) => r.ruleCode === "MANAGER_RECOGNITION");
    finalPoints = defaultRule ? defaultRule.points : 10;
  }

  if (finalPoints <= 0 || !Number.isInteger(finalPoints)) {
    throw new HttpError(400, "Recognition points must be a positive integer.");
  }

  // Check manager monthly recognition limit if configured
  const monthlyCap = ipRules?.managerMonthlyCap || 100;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyAwardedAggregation = await ImpactPointTransaction.aggregate([
    {
      $match: {
        actorUserId: user._id,
        source: TRANSACTION_SOURCES.MANAGER_RECOGNITION,
        createdAt: { $gte: startOfMonth },
        isReversed: false,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$points" },
      },
    },
  ]);

  const currentMonthPoints = monthlyAwardedAggregation[0]?.total || 0;
  if (!isHrAdmin && currentMonthPoints + finalPoints > monthlyCap) {
    throw new HttpError(
      400,
      `Monthly recognition limit reached. You have awarded ${currentMonthPoints} points this month; the policy cap is ${monthlyCap} points.`
    );
  }

  const idempotencyKey = `recog_${user._id}_${recipient._id}_${Date.now()}`;
  const tx = await createIdempotentTransaction({
    models,
    data: {
      employeeId: recipient._id,
      employeeSnapshot: {
        fullName: recipient.fullName,
        employeeCode: recipient.employeeCode,
        department: recipient.job?.department || "",
      },
      points: finalPoints,
      transactionType: TRANSACTION_TYPES.EARNED,
      source: TRANSACTION_SOURCES.MANAGER_RECOGNITION,
      eventType: "MANAGER_RECOGNITION",
      reason: reason.trim(),
      actorUserId: user._id,
      actorEmployeeId: actorEmployee?._id || null,
      actorSnapshot: {
        fullName: actorEmployee?.fullName || user.email,
        email: user.email,
        role: user.role,
      },
      idempotencyKey,
      metadata: { ruleCode: ruleCode || "MANAGER_RECOGNITION" },
    },
  });

  if (AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "IMPACT_POINTS_RECOGNIZED",
        targetType: "Employee",
        targetId: recipient._id,
        changes: { points: finalPoints, reason },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }
  }

  return tx;
}

/**
 * Reverses an erroneous or disputed Impact Points transaction (HR Admin only).
 */
export async function reverseTransactionService({ models, user, transactionId, reason }) {
  const { ImpactPointTransaction, AuditLog } = models;

  if (user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(403, "Only HR Administrators can reverse Impact Points transactions.");
  }

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw new HttpError(400, "Reason for reversal is required.");
  }

  const originalTx = await ImpactPointTransaction.findById(transactionId);
  if (!originalTx) {
    throw new HttpError(404, "Original transaction not found.");
  }

  if (originalTx.isReversed) {
    throw new HttpError(400, "This transaction has already been reversed.");
  }

  if (originalTx.transactionType === TRANSACTION_TYPES.REVERSAL) {
    throw new HttpError(400, "Cannot reverse a reversal transaction.");
  }

  const reversalPoints = -originalTx.points;
  const idempotencyKey = `reversal_${originalTx._id}`;

  const reversalTx = await createIdempotentTransaction({
    models,
    data: {
      employeeId: originalTx.employeeId,
      employeeSnapshot: originalTx.employeeSnapshot,
      points: reversalPoints,
      transactionType: TRANSACTION_TYPES.REVERSAL,
      source: TRANSACTION_SOURCES.REVERSAL,
      eventType: "TRANSACTION_REVERSAL",
      reason: `Reversal: ${reason.trim()} (Original: ${originalTx.reason})`,
      actorUserId: user._id,
      actorEmployeeId: null,
      actorSnapshot: {
        fullName: user.email,
        email: user.email,
        role: user.role,
      },
      taskId: originalTx.taskId || null,
      idempotencyKey,
      reversalReferenceId: originalTx._id,
      metadata: { originalTransactionId: originalTx._id },
    },
  });

  originalTx.isReversed = true;
  await originalTx.save();

  if (AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "IMPACT_POINTS_REVERSED",
        targetType: "ImpactPointTransaction",
        targetId: originalTx._id,
        changes: { reversalPoints, reason },
        timestamp: new Date(),
      });
    } catch {
      // Non-blocking
    }
  }

  return { originalTransaction: originalTx, reversalTransaction: reversalTx };
}

/**
 * High-performance aggregation pipeline to compute the leaderboard.
 * Balances are computed directly from the immutable transaction ledger.
 */
export async function getLeaderboardService({
  models,
  department = "ALL",
  period,
  startDate,
  endDate,
  limit = 50,
}) {
  const { ImpactPointTransaction } = models;

  const matchStage = {
    isReversed: false,
  };

  let resolvedStartDate = startDate ? new Date(startDate) : null;
  let resolvedEndDate = endDate ? new Date(endDate) : null;

  if (period && period !== "all") {
    const now = new Date();
    if (period === "month") {
      resolvedStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === "quarter") {
      resolvedStartDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    } else if (period === "year") {
      resolvedStartDate = new Date(now.getFullYear(), 0, 1);
    }
  }

  if (resolvedStartDate || resolvedEndDate) {
    matchStage.createdAt = {};
    if (resolvedStartDate) {
      matchStage.createdAt.$gte = resolvedStartDate;
    }
    if (resolvedEndDate) {
      const end = new Date(resolvedEndDate);
      end.setHours(23, 59, 59, 999);
      matchStage.createdAt.$lte = end;
    }
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "employees",
        localField: "employeeId",
        foreignField: "_id",
        as: "employeeDoc",
      },
    },
    {
      $addFields: {
        employee: { $arrayElemAt: ["$employeeDoc", 0] },
      },
    },
    {
      $addFields: {
        // Canonical employee/user identity:
        // Use employee.userId if linked to a user account, otherwise fallback to employeeId
        canonicalId: {
          $ifNull: ["$employee.userId", "$employeeId"],
        },
        canonicalEmployeeId: {
          $ifNull: ["$employee._id", "$employeeId"],
        },
        resolvedFullName: {
          $ifNull: ["$employee.fullName", "$employeeSnapshot.fullName"],
        },
        resolvedEmployeeCode: {
          $ifNull: ["$employee.employeeCode", "$employeeSnapshot.employeeCode"],
        },
        resolvedDepartment: {
          $ifNull: ["$employee.job.department", "$employeeSnapshot.department"],
        },
      },
    },
  ];

  if (department && department !== "ALL") {
    pipeline.push({
      $match: {
        $or: [
          { resolvedDepartment: department },
          { "employeeSnapshot.department": department },
        ],
      },
    });
  }

  pipeline.push(
    {
      $group: {
        _id: "$canonicalId",
        employeeId: { $first: "$canonicalEmployeeId" },
        fullName: { $first: "$resolvedFullName" },
        employeeCode: { $first: "$resolvedEmployeeCode" },
        department: { $first: "$resolvedDepartment" },
        balance: { $sum: "$points" },
        totalPoints: { $sum: "$points" },
        pointsEarned: {
          $sum: {
            $cond: [{ $gt: ["$points", 0] }, "$points", 0],
          },
        },
        pointsDeducted: {
          $sum: {
            $cond: [{ $lt: ["$points", 0] }, { $abs: "$points" }, 0],
          },
        },
        earnedCount: {
          $sum: { $cond: [{ $eq: ["$transactionType", TRANSACTION_TYPES.EARNED] }, 1, 0] },
        },
        deductedCount: {
          $sum: { $cond: [{ $eq: ["$transactionType", TRANSACTION_TYPES.DEDUCTED] }, 1, 0] },
        },
        lastTransactionAt: { $max: "$createdAt" },
      },
    },
    { $sort: { balance: -1, lastTransactionAt: -1 } },
    { $limit: Math.min(Number(limit) || 50, 100) }
  );

  const aggregation = await ImpactPointTransaction.aggregate(pipeline);

  // Compute stable ranks (1, 2, 3...)
  let currentRank = 1;
  const ranked = aggregation.map((entry, index) => {
    if (index > 0 && entry.balance < aggregation[index - 1].balance) {
      currentRank = index + 1;
    }
    const name = entry.fullName || "Employee";
    const dept = entry.department || "Unassigned";
    return {
      rank: currentRank,
      employeeId: entry.employeeId,
      name,
      fullName: name,
      employeeCode: entry.employeeCode || "",
      department: dept,
      balance: entry.balance,
      netPoints: entry.balance,
      totalPoints: entry.totalPoints,
      pointsEarned: entry.pointsEarned,
      totalEarned: entry.pointsEarned,
      pointsDeducted: entry.pointsDeducted,
      totalDeducted: entry.pointsDeducted,
      earnedCount: entry.earnedCount,
      deductedCount: entry.deductedCount,
      lastTransactionAt: entry.lastTransactionAt,
    };
  });

  return ranked;
}

/**
 * Computes an employee's personal Impact Points summary and recent ledger entries.
 */
export async function getEmployeePointsSummaryService({ models, employeeId }) {
  const { ImpactPointTransaction, Employee } = models;

  const employee = await Employee.findById(employeeId).lean();
  if (!employee) {
    throw new HttpError(404, "Employee not found");
  }

  const targetEmployeeId = new mongoose.Types.ObjectId(employee._id);

  // 1. Total Balance
  const totalBalanceAgg = await ImpactPointTransaction.aggregate([
    { $match: { employeeId: targetEmployeeId, isReversed: false } },
    {
      $group: {
        _id: null,
        balance: { $sum: "$points" },
        totalEarned: {
          $sum: {
            $cond: [{ $and: [{ $gt: ["$points", 0] }, { $eq: ["$isReversed", false] }] }, "$points", 0],
          },
        },
        totalDeducted: {
          $sum: {
            $cond: [{ $and: [{ $lt: ["$points", 0] }, { $eq: ["$isReversed", false] }] }, "$points", 0],
          },
        },
      },
    },
  ]);

  const balance = totalBalanceAgg[0]?.balance || 0;
  const totalEarned = totalBalanceAgg[0]?.totalEarned || 0;
  const totalDeducted = Math.abs(totalBalanceAgg[0]?.totalDeducted || 0);

  // 2. This Month's Points
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthAgg = await ImpactPointTransaction.aggregate([
    {
      $match: {
        employeeId: targetEmployeeId,
        createdAt: { $gte: startOfMonth },
        isReversed: false,
      },
    },
    { $group: { _id: null, pointsThisMonth: { $sum: "$points" } } },
  ]);

  const pointsThisMonth = monthAgg[0]?.pointsThisMonth || 0;

  // 3. Overall rank in company
  const companyLeaderboard = await getLeaderboardService({ models, department: "ALL", limit: 200 });
  const rankInCompany = companyLeaderboard.find((entry) => String(entry.employeeId) === String(employee._id))?.rank || "-";

  // 4. Department rank
  let rankInDepartment = "-";
  if (employee.job?.department) {
    const deptLeaderboard = await getLeaderboardService({ models, department: employee.job.department, limit: 100 });
    rankInDepartment = deptLeaderboard.find((entry) => String(entry.employeeId) === String(employee._id))?.rank || "-";
  }

  // 5. Recent transactions
  const recentTransactions = await ImpactPointTransaction.find({ employeeId: targetEmployeeId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return {
    employeeId: employee._id,
    fullName: employee.fullName,
    employeeCode: employee.employeeCode,
    department: employee.job?.department || "",
    balance,
    totalEarned,
    pointsEarned: totalEarned,
    totalDeducted,
    pointsDeducted: totalDeducted,
    pointsThisMonth,
    rankInCompany,
    companyRank: rankInCompany,
    rankInDepartment,
    departmentRank: rankInDepartment,
    recentTransactions,
  };
}

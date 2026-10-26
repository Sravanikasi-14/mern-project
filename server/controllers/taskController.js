import { HttpError } from "../utils/httpError.js";
import { USER_ROLES } from "../models/User.js";
import { TASK_STATUSES, TASK_PRIORITIES } from "../models/Task.js";
import { saveDocumentFile, validateDocumentFile } from "../services/documentStorage.js";
import {
  createTaskService,
  startTaskService,
  submitTaskEvidenceService,
  reviewTaskService,
  getAuthenticatedEmployee,
} from "../services/workManagementService.js";

/**
 * Metadata endpoint returning user role context, direct reports (if manager),
 * company departments, and projects for assignment dropdowns.
 */
export async function getWorkManagementMeta(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;

    let directReports = [];
    if (actorEmployee) {
      directReports = await Employee.find({
        "job.reportingManagerId": actorEmployee._id,
        status: "ACTIVE",
      })
        .select("_id fullName employeeCode email job.department job.jobTitle")
        .lean();
    }

    // All active employees for HR Admin assignment
    let assignableEmployees = directReports;
    if (isHrAdmin) {
      assignableEmployees = await Employee.find({ status: "ACTIVE" })
        .select("_id fullName employeeCode email job.department job.jobTitle job.reportingManagerId")
        .sort({ fullName: 1 })
        .lean();
    }

    // Distinct departments
    const distinctDepartments = await Employee.distinct("job.department", {
      "job.department": { $nin: ["", null] },
    });

    const metaPayload = {
      userRole: req.auth.user.role,
      actorEmployeeId: actorEmployee?._id || null,
      isManager: directReports.length > 0 || isHrAdmin,
      directReportsCount: directReports.length,
      assignableEmployees,
      departments: distinctDepartments,
    };

    res.status(200).json({
      success: true,
      ...metaPayload,
      data: metaPayload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Creates and assigns a new task.
 */
export async function createTask(req, res, next) {
  try {
    const task = await createTaskService({
      models: req.auth.models,
      user: req.auth.user,
      data: req.body,
    });
    res.status(201).json({ success: true, message: "Task created and assigned successfully", task });
  } catch (error) {
    next(error);
  }
}

/**
 * Lists tasks with filtering, search, and pagination.
 */
export async function getTasks(req, res, next) {
  try {
    const { Task } = req.auth.models;
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { status, priority, department, search } = req.query;

    const rawScope = String(req.query.scope || "auto").trim().toLowerCase();
    const isMyTasks = rawScope === "my_tasks" || rawScope === "my";
    const isTeamTasks = rawScope === "team_tasks" || rawScope === "team";
    const isAll = rawScope === "all";

    const conditions = [];

    // Scope-based authorization filtering
    if (isMyTasks || (!isHrAdmin && !isTeamTasks)) {
      if (!actorEmployee) {
        return res.status(200).json({
          success: true,
          tasks: [],
          pagination: { total: 0, page, limit, pages: 1 },
          data: { tasks: [], pagination: { total: 0, page, limit, pages: 1 } },
        });
      }
      conditions.push({ assigneeId: actorEmployee._id });
    } else if (isTeamTasks) {
      if (!actorEmployee && !isHrAdmin) {
        return res.status(200).json({
          success: true,
          tasks: [],
          pagination: { total: 0, page, limit, pages: 1 },
          data: { tasks: [], pagination: { total: 0, page, limit, pages: 1 } },
        });
      }
      if (actorEmployee) {
        const directReports = await req.auth.models.Employee.find({
          "job.reportingManagerId": actorEmployee._id,
        }).select("_id");
        const reportIds = directReports.map((r) => r._id);
        conditions.push({
          $or: [
            { assignedByEmployeeId: actorEmployee._id },
            { assigneeId: { $in: reportIds } },
          ],
        });
      }
    } else if (isAll && !isHrAdmin) {
      throw new HttpError(403, "Access restricted to HR Administrators");
    }

    if (status && Object.values(TASK_STATUSES).includes(status)) {
      conditions.push({ status });
    }
    if (priority && Object.values(TASK_PRIORITIES).includes(priority)) {
      conditions.push({ priority });
    }
    if (department && department !== "ALL") {
      conditions.push({
        $or: [
          { department },
          { "assigneeSnapshot.department": department },
        ],
      });
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), "i");
      conditions.push({
        $or: [
          { title: regex },
          { description: regex },
          { "assigneeSnapshot.fullName": regex },
          { "assigneeSnapshot.employeeCode": regex },
        ],
      });
    }

    const query =
      conditions.length === 0
        ? {}
        : conditions.length === 1
        ? conditions[0]
        : { $and: conditions };

    const [total, tasks] = await Promise.all([
      Task.countDocuments(query),
      Task.find(query)
        .sort({ deadline: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const pagination = {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };

    res.status(200).json({
      success: true,
      tasks,
      pagination,
      data: {
        tasks,
        pagination,
      },
    });
  } catch (error) {
    console.error("[taskController:getTasks] Failed to fetch task list:", error.message);
    next(error);
  }
}

/**
 * Gets a single task by ID with permissions check.
 */
export async function getTaskById(req, res, next) {
  try {
    const { Task } = req.auth.models;
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;

    const task = await Task.findById(req.params.id).lean();
    if (!task) {
      throw new HttpError(404, "Task not found");
    }

    // Authorization: HR Admin, assignee, or assigning manager
    const isAssignee = actorEmployee && String(task.assigneeId) === String(actorEmployee._id);
    const isAssigner = actorEmployee && task.assignedByEmployeeId && String(task.assignedByEmployeeId) === String(actorEmployee._id);

    if (!isHrAdmin && !isAssignee && !isAssigner) {
      throw new HttpError(403, "You do not have permission to view this task");
    }

    res.status(200).json({ success: true, task });
  } catch (error) {
    next(error);
  }
}

/**
 * Updates task parameters (title, description, deadline, priority, acceptance criteria).
 * Restricted to assigner or HR Admin before task completion.
 */
export async function updateTask(req, res, next) {
  try {
    const { Task, AuditLog } = req.auth.models;
    const actorEmployee = await getAuthenticatedEmployee(req.auth.models, req.auth.user);
    const isHrAdmin = req.auth.user.role === USER_ROLES.HR_ADMIN;

    const task = await Task.findById(req.params.id);
    if (!task) {
      throw new HttpError(404, "Task not found");
    }

    if (task.status === TASK_STATUSES.APPROVED) {
      throw new HttpError(400, "Approved tasks cannot be edited");
    }

    const isAssigner = actorEmployee && task.assignedByEmployeeId && String(task.assignedByEmployeeId) === String(actorEmployee._id);
    if (!isHrAdmin && !isAssigner) {
      throw new HttpError(403, "Only the assigning manager or an HR Admin can update this task");
    }

    const { title, description, priority, deadline, acceptanceCriteria, projectName } = req.body;
    if (title && title.trim()) task.title = title.trim();
    if (description && description.trim()) task.description = description.trim();
    if (priority && Object.values(TASK_PRIORITIES).includes(priority)) task.priority = priority;
    if (deadline) task.deadline = new Date(deadline);
    if (projectName !== undefined) task.projectName = projectName.trim();
    if (Array.isArray(acceptanceCriteria)) {
      task.acceptanceCriteria = acceptanceCriteria.map((c) => String(c).trim()).filter(Boolean);
    }

    await task.save();

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: "TASK_UPDATED",
          targetType: "Task",
          targetId: task._id,
          changes: req.body,
          timestamp: new Date(),
        });
      } catch {
        // Non-blocking
      }
    }

    res.status(200).json({ success: true, message: "Task updated successfully", task });
  } catch (error) {
    next(error);
  }
}

/**
 * Starts task execution (ASSIGNED -> IN_PROGRESS).
 */
export async function startTask(req, res, next) {
  try {
    const task = await startTaskService({
      models: req.auth.models,
      user: req.auth.user,
      taskId: req.params.id,
    });
    res.status(200).json({ success: true, message: "Task started and marked In Progress", task });
  } catch (error) {
    next(error);
  }
}

/**
 * Submits deliverable evidence and notes for review.
 */
export async function submitEvidence(req, res, next) {
  try {
    const { deliverables, submissionNotes } = req.body;
    const task = await submitTaskEvidenceService({
      models: req.auth.models,
      user: req.auth.user,
      taskId: req.params.id,
      deliverables,
      submissionNotes,
    });
    res.status(200).json({ success: true, message: "Work deliverables submitted for review successfully", task });
  } catch (error) {
    next(error);
  }
}

/**
 * Reviews a submitted task (APPROVE, CHANGES_REQUESTED, REJECT).
 */
export async function reviewTask(req, res, next) {
  try {
    const { decision, comments } = req.body;
    const task = await reviewTaskService({
      models: req.auth.models,
      user: req.auth.user,
      taskId: req.params.id,
      decision,
      comments,
    });

    const actionText =
      decision === TASK_STATUSES.APPROVED
        ? (task.pointsAwarded > 0
            ? `Task approved and ${task.pointsAwarded} Impact Points credited successfully`
            : "Task approved successfully")
        : decision === TASK_STATUSES.CHANGES_REQUESTED
        ? "Changes requested from employee"
        : "Task submission rejected";

    res.status(200).json({ success: true, message: actionText, task });
  } catch (error) {
    next(error);
  }
}

/**
 * Uploads a document/file attachment to attach as deliverable evidence.
 * Securely uses documentStorage without storing raw blobs in MongoDB.
 */
export async function uploadTaskAttachment(req, res, next) {
  try {
    const { fileName, fileData, mimeType } = req.body;

    if (!fileName || !fileData) {
      throw new HttpError(400, "File name and base64 file data are required");
    }

    const saved = await saveDocumentFile({
      databaseName: req.auth.company.databaseName,
      employeeId: req.auth.user._id,
      fileName,
      fileData,
      mimeType,
    });

    const fileUrl = `/api/tasks/attachments/${saved.storageKey}`;

    res.status(200).json({
      success: true,
      attachment: {
        fileName: saved.fileName,
        fileSize: saved.fileSize,
        mimeType: saved.mimeType,
        documentUrl: fileUrl,
        storageKey: saved.storageKey,
      },
      data: {
        fileName: saved.fileName,
        fileSize: saved.fileSize,
        mimeType: saved.mimeType,
        fileUrl,
        storageKey: saved.storageKey,
      },
    });
  } catch (error) {
    next(error);
  }
}

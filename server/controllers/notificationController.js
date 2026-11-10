import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import {
  notificationSubjectEmployeeId,
  notificationVisibilityFilter,
} from "../utils/notificationVisibility.js";

/**
 * GET /api/notifications
 * Retrieves real notifications for the authenticated user based on role and authorizations.
 */
export async function getNotifications(req, res, next) {
  try {
    const { user, models } = req.auth;
    const { Notification, LeaveRequest, Task, Employee } = models;

    const {
      resolveHrAccessContext,
      mergeEmployeeIdScopeFilter,
      isEmployeeIdInScope,
      assertHrPermission,
    } = await import("../services/hrAccessEnforcementService.js");
    const { USER_ROLES } = await import("../models/User.js");

    let hrAccess = req.hrAccess;
    if (!hrAccess && user.role === USER_ROLES.HR_ADMIN) {
      hrAccess = await resolveHrAccessContext({
        user,
        company: req.auth.company,
        models,
      });
    }

    const userReadIds = new Set(
      (user.preferences?.readNotificationIds || []).map((id) => String(id))
    );
    const readAllAt = user.preferences?.readAllNotificationsAt
      ? new Date(user.preferences.readAllNotificationsAt).getTime()
      : 0;

    const items = [];

    // 1. Fetch persisted database notifications owned by / broadcast to this user.
    // Never match `{ role: null }` alone — personal docs often store role:null with a userId.
    if (Notification) {
      const persisted = await Notification.find(notificationVisibilityFilter(user))
        .sort({ createdAt: -1 })
        .limit(40)
        .lean();

      for (const notif of persisted) {
        const subjectEmployeeId = notificationSubjectEmployeeId(notif);
        // When ENFORCED, drop role-broadcast notifications that name an out-of-scope employee
        if (
          user.role === USER_ROLES.HR_ADMIN &&
          hrAccess?.enforced &&
          subjectEmployeeId &&
          !notif.userId &&
          !isEmployeeIdInScope(hrAccess, subjectEmployeeId)
        ) {
          continue;
        }

        const isRead =
          notif.isRead ||
          (notif.readBy && notif.readBy.some((uid) => String(uid) === String(user._id))) ||
          userReadIds.has(String(notif._id)) ||
          new Date(notif.createdAt).getTime() <= readAllAt;

        items.push({
          id: String(notif._id),
          title: notif.title,
          message: notif.message,
          type: notif.type || "SYSTEM",
          link: notif.link || "",
          createdAt: notif.createdAt,
          isRead,
        });
      }
    }

    // 2. Fetch live data for HR_ADMIN (scoped + permission-gated when ENFORCED)
    if (user.role === USER_ROLES.HR_ADMIN) {
      let canViewLeave = true;
      let canViewPeople = true;
      try {
        assertHrPermission(hrAccess, "leave.view");
      } catch {
        canViewLeave = false;
      }
      try {
        assertHrPermission(hrAccess, "people.view");
      } catch {
        canViewPeople = false;
      }

      if (LeaveRequest && canViewLeave) {
        const leaveQuery = mergeEmployeeIdScopeFilter(hrAccess, { status: "PENDING" });
        const pendingLeaves = await LeaveRequest.find(leaveQuery)
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();

        const empIds = pendingLeaves.map((l) => l.employeeId).filter(Boolean);
        const empMap = new Map();
        if (Employee && empIds.length > 0) {
          const emps = await Employee.find({ _id: { $in: empIds } })
            .select("fullName firstName lastName")
            .lean();
          emps.forEach((e) =>
            empMap.set(
              String(e._id),
              e.fullName || `${e.firstName || ""} ${e.lastName || ""}`.trim()
            )
          );
        }

        for (const lr of pendingLeaves) {
          const empName = empMap.get(String(lr.employeeId)) || "An employee";
          const id = `leave-${lr._id}`;
          const isRead = userReadIds.has(String(lr._id)) || new Date(lr.createdAt).getTime() <= readAllAt;
          items.push({
            id,
            title: `Leave Request: ${empName}`,
            message: `${lr.leaveTypeCode} leave for ${lr.daysCount || 1} day(s)${lr.reason ? ` ("${lr.reason}")` : ""}`,
            type: "LEAVE",
            link: "/admin/leave?status=PENDING",
            createdAt: lr.createdAt,
            isRead,
          });
        }
      }

      if (Task && canViewPeople) {
        const taskQuery = mergeEmployeeIdScopeFilter(hrAccess, { status: "IN_REVIEW" }, "assigneeId");
        const reviewTasks = await Task.find(taskQuery)
          .sort({ updatedAt: -1 })
          .limit(5)
          .lean();

        for (const task of reviewTasks) {
          const id = `task-${task._id}`;
          const isRead = userReadIds.has(String(task._id)) || new Date(task.updatedAt).getTime() <= readAllAt;
          items.push({
            id,
            title: `Task Submitted for Review`,
            message: `"${task.title}" is awaiting review and impact approval.`,
            type: "TASK",
            link: "/admin/work-management",
            createdAt: task.updatedAt || task.createdAt,
            isRead,
          });
        }
      }
    }

    // 3. Fetch live data for EMPLOYEE
    if (user.role === "EMPLOYEE" && user.employeeId) {
      if (LeaveRequest) {
        const myLeaves = await LeaveRequest.find({ employeeId: user.employeeId })
          .sort({ updatedAt: -1 })
          .limit(5)
          .lean();

        for (const lr of myLeaves) {
          const id = `leave-${lr._id}`;
          const notifDate = lr.decision?.decidedAt || lr.updatedAt || lr.createdAt;
          const isRead = userReadIds.has(String(lr._id)) || new Date(notifDate).getTime() <= readAllAt;
          const statusText = lr.status === "PENDING" ? "Submitted" : lr.status;
          items.push({
            id,
            title: `Leave Request ${statusText}`,
            message: `Your ${lr.leaveTypeCode} leave for ${lr.daysCount || 1} day(s) is ${lr.status.toLowerCase()}${
              lr.decision?.remarks ? `: "${lr.decision.remarks}"` : "."
            }`,
            type: "LEAVE",
            link: "/app/leave",
            createdAt: notifDate,
            isRead,
          });
        }
      }

      if (Task) {
        const myTasks = await Task.find({
          assigneeId: user.employeeId,
          status: { $nin: ["APPROVED", "REJECTED"] },
        })
          .sort({ updatedAt: -1 })
          .limit(5)
          .lean();

        for (const task of myTasks) {
          const id = `task-${task._id}`;
          const isRead = userReadIds.has(String(task._id)) || new Date(task.updatedAt || task.createdAt).getTime() <= readAllAt;
          items.push({
            id,
            title: `Active Task: ${task.title}`,
            message: `Status: ${task.status}. Priority: ${task.priority || "MEDIUM"}.`,
            type: "TASK",
            link: "/app/tasks",
            createdAt: task.updatedAt || task.createdAt,
            isRead,
          });
        }
      }
    }

    // Sort all combined items by createdAt descending
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Panel shows unread only. Read docs stay in the DB; mark-read APIs never delete.
    const unread = items.filter((n) => !n.isRead);
    const notifications = unread.slice(0, 20);
    const unreadCount = unread.length;

    res.json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read
 */
export async function markNotificationRead(req, res, next) {
  try {
    const { user, models } = req.auth;
    const { Notification, User } = models;
    const rawId = req.params.id;

    const cleanId = rawId.replace(/^(leave|task)-/, "");

    // Scope to notifications this user is allowed to see. Never flip global
    // isRead on shared/role broadcasts — that would mark them read for everyone.
    if (mongoose.Types.ObjectId.isValid(cleanId) && Notification) {
      const updated = await Notification.findOneAndUpdate(
        {
          _id: cleanId,
          ...notificationVisibilityFilter(user),
        },
        { $addToSet: { readBy: user._id } },
        { new: true }
      );
      if (!updated) {
        const exists = await Notification.findById(cleanId).select("_id userId role").lean();
        if (exists) {
          throw new HttpError(403, "You cannot modify another user's notification.");
        }
      }
    }

    // Persist per-user read state (synthetic leave-/task- ids and DB ids)
    if (User) {
      await User.findByIdAndUpdate(user._id, {
        $addToSet: { "preferences.readNotificationIds": cleanId },
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/notifications/mark-all-read
 * Mark all notifications as read for current user
 */
export async function markAllNotificationsRead(req, res, next) {
  try {
    const { user, models } = req.auth;
    const { Notification, User } = models;

    const now = new Date();

    if (Notification) {
      // Per-user read tracking only — do not flip shared/role notifications globally.
      await Notification.updateMany(notificationVisibilityFilter(user), {
        $addToSet: { readBy: user._id },
      });
    }

    if (User) {
      await User.findByIdAndUpdate(user._id, {
        $set: { "preferences.readAllNotificationsAt": now },
      });
    }

    res.json({ success: true, readAllAt: now });
  } catch (error) {
    next(error);
  }
}

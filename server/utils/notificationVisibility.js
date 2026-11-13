import { USER_ROLES } from "../models/User.js";

/**
 * Visibility filter for persisted Notification documents.
 *
 * Personal notifications are stored with a concrete userId (role is often null).
 * Role broadcasts use userId: null and a concrete role (e.g. HR_ADMIN).
 * Company-wide broadcasts use userId: null and role: null.
 *
 * Company Admin shares the HR portal with HR Admin, so COMPANY_ADMIN users also
 * see HR_ADMIN role broadcasts (attendance, exceptions, etc.).
 *
 * IMPORTANT: Never match `{ role: null }` alone — that leaks every personal
 * notification (messages, attendance, tasks) to every authenticated user.
 */
export function notificationVisibilityFilter(user) {
  if (!user?._id) {
    return { _id: null };
  }

  return {
    $or: notificationVisibilityBranches(user),
  };
}

/**
 * Discrete indexed predicates for parallel finds (avoids a single $or plan that
 * merges poorly with sort). Same semantics as notificationVisibilityFilter.
 */
export function notificationVisibilityBranches(user) {
  if (!user?._id) return [{ _id: null }];

  const branches = [
    { userId: user._id },
    { userId: null, role: user.role },
    { userId: null, role: null },
  ];
  if (user.role === USER_ROLES.COMPANY_ADMIN) {
    branches.push({ userId: null, role: USER_ROLES.HR_ADMIN });
  }
  return branches;
}

const LIST_SELECT =
  "_id title message type link createdAt isRead readBy userId role metadata employeeId";

/**
 * Fetch newest visible notifications using per-branch indexed queries.
 * @param {import('mongoose').Model} Notification
 * @param {object} user
 * @param {{ limit?: number }} [options]
 */
export async function findVisibleNotifications(Notification, user, { limit = 40 } = {}) {
  if (!Notification || !user?._id) return [];

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const branches = notificationVisibilityBranches(user);

  const batches = await Promise.all(
    branches.map((filter) =>
      Notification.find(filter)
        .select(LIST_SELECT)
        .sort({ createdAt: -1 })
        .limit(safeLimit)
        .lean()
    )
  );

  const byId = new Map();
  for (const batch of batches) {
    for (const doc of batch) {
      byId.set(String(doc._id), doc);
    }
  }

  return [...byId.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, safeLimit);
}

/** Employee id referenced by a notification, if any (for HR scope filtering). */
export function notificationSubjectEmployeeId(notif) {
  if (!notif) return null;
  if (notif.employeeId) return notif.employeeId;
  const meta = notif.metadata || {};
  return meta.employeeId || null;
}

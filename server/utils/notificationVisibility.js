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

  const roleBroadcasts = [{ userId: null, role: user.role }];
  if (user.role === USER_ROLES.COMPANY_ADMIN) {
    roleBroadcasts.push({ userId: null, role: USER_ROLES.HR_ADMIN });
  }

  return {
    $or: [{ userId: user._id }, ...roleBroadcasts, { userId: null, role: null }],
  };
}

/** Employee id referenced by a notification, if any (for HR scope filtering). */
export function notificationSubjectEmployeeId(notif) {
  if (!notif) return null;
  if (notif.employeeId) return notif.employeeId;
  const meta = notif.metadata || {};
  return meta.employeeId || null;
}

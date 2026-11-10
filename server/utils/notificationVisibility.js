/**
 * Visibility filter for persisted Notification documents.
 *
 * Personal notifications are stored with a concrete userId (role is often null).
 * Role broadcasts use userId: null and a concrete role (e.g. HR_ADMIN).
 * Company-wide broadcasts use userId: null and role: null.
 *
 * IMPORTANT: Never match `{ role: null }` alone — that leaks every personal
 * notification (messages, attendance, tasks) to every authenticated user.
 */
export function notificationVisibilityFilter(user) {
  if (!user?._id) {
    return { _id: null };
  }
  return {
    $or: [
      { userId: user._id },
      { userId: null, role: user.role },
      { userId: null, role: null },
    ],
  };
}

/** Employee id referenced by a notification, if any (for HR scope filtering). */
export function notificationSubjectEmployeeId(notif) {
  if (!notif) return null;
  if (notif.employeeId) return notif.employeeId;
  const meta = notif.metadata || {};
  return meta.employeeId || null;
}

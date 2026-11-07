export const ACCESS_RESTRICTED_TITLE = "Access Restricted";
export const ACCESS_RESTRICTED_MESSAGE =
  "You don't have permission to perform this action. Your HR Admin access is limited by the permissions assigned by your Company Admin.";

const PERMISSION_CODES = new Set([
  "HR_PERMISSION_DENIED",
  "HR_SCOPE_DENIED",
  "HR_ACCESS_NOT_CONFIGURED",
  "HR_SCOPE_MODE_INVALID",
]);

let snapshot = { role: null, enforcement: "OFF" };
const listeners = new Set();
let noticeOpen = false;

export function setAccessSnapshot(user, company) {
  snapshot = {
    role: user?.role || null,
    enforcement: company?.hrAccessEnforcement?.mode === "ENFORCED" ? "ENFORCED" : "OFF",
  };
}

export function getAccessSnapshot() {
  return snapshot;
}

export function isHrPermissionDenial(error) {
  if (snapshot.role !== "HR_ADMIN" || snapshot.enforcement !== "ENFORCED") return false;
  const status = error?.response?.status;
  const code = error?.response?.data?.code || error?.code;
  return status === 403 && PERMISSION_CODES.has(code);
}

export function shouldAnnouncePermissionDenial(error) {
  if (!isHrPermissionDenial(error) && !error?.accessRestricted) return false;
  const config = error?.config || {};
  if (config.permissionNotice === "silent") return false;
  if (config.permissionNotice === "notify") return true;
  const method = String(config.method || "get").toLowerCase();
  return method !== "get" && method !== "head" && method !== "options";
}

export function subscribeAccessNotice(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One modal for a burst of permission denials. A later denial can open it again after it closes. */
export function announceAccessRestricted() {
  if (noticeOpen) return false;
  noticeOpen = true;
  const notice = {
    id: Date.now(),
    title: ACCESS_RESTRICTED_TITLE,
    message: ACCESS_RESTRICTED_MESSAGE,
  };
  listeners.forEach((listener) => listener(notice));
  return true;
}

export function dismissAccessNotice() {
  if (!noticeOpen) return;
  noticeOpen = false;
  listeners.forEach((listener) => listener(null));
}

export function resetAccessNoticeForTests() {
  noticeOpen = false;
  snapshot = { role: null, enforcement: "OFF" };
  listeners.clear();
}

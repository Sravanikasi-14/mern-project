/**
 * Centralized notification → in-app route resolver (desktop + mobile).
 * Pure function: no API calls. Pages that deep-link must tolerate missing/unauthorized records.
 */

export const NOTIFICATION_NAV_TYPES = Object.freeze({
  LEAVE: "LEAVE",
  TASK: "TASK",
  PAYROLL: "PAYROLL",
  SYSTEM: "SYSTEM",
  HANDOVER: "HANDOVER",
  MESSAGE: "MESSAGE",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  ATTENDANCE: "ATTENDANCE",
});

function str(value) {
  if (value == null) return "";
  return String(value).trim();
}

function metaOf(notification) {
  const raw = notification?.metadata;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function stripSyntheticPrefix(id) {
  return str(id).replace(/^(leave|task)-/i, "");
}

function isSafeInternalPath(path) {
  if (!path || typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return true;
}

function splitPath(href) {
  const raw = str(href);
  if (!isSafeInternalPath(raw)) return null;
  const qIndex = raw.indexOf("?");
  const hashIndex = raw.indexOf("#");
  let end = raw.length;
  if (qIndex >= 0) end = Math.min(end, qIndex);
  if (hashIndex >= 0) end = Math.min(end, hashIndex);
  const pathname = raw.slice(0, end) || "/";
  const search =
    qIndex >= 0
      ? raw.slice(qIndex + 1, hashIndex >= 0 && hashIndex > qIndex ? hashIndex : undefined)
      : "";
  return { pathname, search, params: new URLSearchParams(search) };
}

function joinPath(pathname, params) {
  const qs = params?.toString?.() || "";
  return qs ? `${pathname}?${qs}` : pathname;
}

function portalKind(role) {
  const r = str(role).toUpperCase();
  if (r === "EMPLOYEE") return "employee";
  if (r === "COMPANY_ADMIN") return "company";
  if (r === "HR_ADMIN") return "hr";
  return "unknown";
}

function homePath(role, platform) {
  const kind = portalKind(role);
  if (kind === "employee") return "/app/dashboard";
  if (kind === "company" && platform === "mobile") return "/company";
  if (kind === "company" || kind === "hr") return "/admin/dashboard";
  return "/";
}

function messagesBase(role, platform) {
  const kind = portalKind(role);
  if (kind === "employee") return "/app/messages";
  if (kind === "company" && platform === "mobile") return "/company/messages";
  return "/admin/messages";
}

function leaveBase(role) {
  return portalKind(role) === "employee" ? "/app/leave" : "/admin/leave";
}

function tasksBase(role) {
  return portalKind(role) === "employee" ? "/app/tasks" : "/admin/work-management";
}

function payrollBase(role, platform) {
  if (portalKind(role) === "employee") return "/app/payslips";
  if (portalKind(role) === "company" && platform === "mobile") return "/company";
  return "/admin/payroll";
}

function rewriteLegacyEmployeePath(pathname) {
  if (pathname === "/employee/attendance" || pathname.startsWith("/employee/attendance/")) {
    return "/app/attendance";
  }
  if (pathname === "/employee/leave" || pathname.startsWith("/employee/leave/")) {
    return "/app/leave";
  }
  if (pathname === "/employee/tasks" || pathname.startsWith("/employee/tasks/")) {
    return "/app/tasks";
  }
  return pathname;
}

function adaptPathForRolePlatform(pathname, searchParams, role, platform) {
  let path = rewriteLegacyEmployeePath(pathname);
  const kind = portalKind(role);
  const params = new URLSearchParams(searchParams?.toString?.() || "");

  // Company-admin mobile has no /admin module shell — keep messages, else home.
  if (kind === "company" && platform === "mobile") {
    if (path === "/admin/messages" || path.startsWith("/admin/messages/")) {
      path = path.replace(/^\/admin\/messages/, "/company/messages");
    } else if (path.startsWith("/admin/")) {
      return { to: "/company", recordId: null, module: "company" };
    }
  }

  // Employee must not land on admin routes via stale links.
  if (kind === "employee" && path.startsWith("/admin/")) {
    if (path.startsWith("/admin/leave")) path = "/app/leave";
    else if (path.startsWith("/admin/attendance")) path = "/app/attendance";
    else if (path.startsWith("/admin/work-management") || path.startsWith("/admin/work-impact")) {
      path = "/app/tasks";
    } else if (path.startsWith("/admin/messages")) path = "/app/messages";
    else if (path.startsWith("/admin/payroll")) path = "/app/payslips";
    else return { to: homePath(role, platform), recordId: null, module: "home" };
  }

  // HR / company-admin desktop must not land on /app employee shell.
  if ((kind === "hr" || kind === "company") && path.startsWith("/app/")) {
    if (path.startsWith("/app/leave")) path = "/admin/leave";
    else if (path.startsWith("/app/attendance")) path = "/admin/attendance";
    else if (path.startsWith("/app/tasks") || path.startsWith("/app/work-impact")) {
      path = "/admin/work-management";
    } else if (path.startsWith("/app/messages")) path = "/admin/messages";
    else if (path.startsWith("/app/payslips")) path = "/admin/payroll";
    else if (kind === "company" && platform === "mobile") {
      return { to: "/company", recordId: null, module: "company" };
    } else return { to: homePath(role, platform), recordId: null, module: "home" };
  }

  return { path, params };
}

function conversationIdFrom(notification, params) {
  const meta = metaOf(notification);
  return (
    str(meta.conversationId) ||
    str(params?.get?.("c")) ||
    ""
  );
}

function announcementIdFrom(notification, params) {
  const meta = metaOf(notification);
  return str(meta.announcementId) || str(params?.get?.("a")) || "";
}

function leaveIdFrom(notification) {
  const meta = metaOf(notification);
  return (
    str(meta.leaveId) ||
    str(meta.handoverId) ||
    (str(notification?.type).toUpperCase() === "LEAVE"
      ? stripSyntheticPrefix(notification?.id)
      : "") ||
    ""
  );
}

function taskIdFrom(notification, params) {
  const meta = metaOf(notification);
  return (
    str(meta.taskId) ||
    str(params?.get?.("task")) ||
    (str(notification?.type).toUpperCase() === "TASK"
      ? stripSyntheticPrefix(notification?.id)
      : "") ||
    ""
  );
}

function buildMessagesPath({ role, platform, conversationId, announcementId, view }) {
  const base = messagesBase(role, platform);
  if (conversationId) {
    if (platform === "mobile") {
      return { to: `${base}/${conversationId}`, recordId: conversationId, module: "messages" };
    }
    const params = new URLSearchParams();
    params.set("c", conversationId);
    return { to: joinPath(base, params), recordId: conversationId, module: "messages" };
  }
  if (announcementId || view === "announcements") {
    const params = new URLSearchParams();
    params.set("view", "announcements");
    if (announcementId) params.set("a", announcementId);
    return {
      to: joinPath(base, params),
      recordId: announcementId || null,
      module: "announcements",
    };
  }
  return { to: base, recordId: null, module: "messages" };
}

/**
 * Resolve where a notification click should navigate.
 *
 * @param {object} notification
 * @param {{ role?: string, platform?: 'desktop'|'mobile' }} [options]
 * @returns {{ to: string|null, recordId: string|null, module: string, type: string }}
 */
export function resolveNotificationNavigation(notification, options = {}) {
  const role = str(options.role) || "EMPLOYEE";
  const platform = options.platform === "mobile" ? "mobile" : "desktop";
  const type = str(notification?.type).toUpperCase() || NOTIFICATION_NAV_TYPES.SYSTEM;
  const meta = metaOf(notification);
  const parsedLink = splitPath(notification?.link);
  const adapted = parsedLink
    ? adaptPathForRolePlatform(parsedLink.pathname, parsedLink.params, role, platform)
    : null;

  if (adapted?.to && !adapted.path) {
    return { to: adapted.to, recordId: adapted.recordId ?? null, module: adapted.module || "home", type };
  }

  const path = adapted?.path || null;
  const params = adapted?.params || new URLSearchParams();

  switch (type) {
    case NOTIFICATION_NAV_TYPES.MESSAGE: {
      const conversationId = conversationIdFrom(notification, params);
      return {
        ...buildMessagesPath({ role, platform, conversationId }),
        type,
      };
    }
    case NOTIFICATION_NAV_TYPES.ANNOUNCEMENT: {
      const announcementId = announcementIdFrom(notification, params);
      return {
        ...buildMessagesPath({
          role,
          platform,
          announcementId,
          view: "announcements",
        }),
        type,
      };
    }
    case NOTIFICATION_NAV_TYPES.LEAVE:
    case NOTIFICATION_NAV_TYPES.HANDOVER: {
      const leaveId = leaveIdFrom(notification);
      const taskId = taskIdFrom(notification, params);
      if (taskId && portalKind(role) === "employee") {
        const p = new URLSearchParams();
        p.set("task", taskId);
        return { to: joinPath("/app/tasks", p), recordId: taskId, module: "tasks", type };
      }
      const base = path?.startsWith(leaveBase(role)) ? path : leaveBase(role);
      const p = new URLSearchParams(params);
      if (type === NOTIFICATION_NAV_TYPES.HANDOVER && portalKind(role) === "employee") {
        if (!p.get("tab")) p.set("tab", "handovers");
      }
      const handoverId = str(meta.handoverId);
      if (handoverId) p.set("handoverId", handoverId);
      if (leaveId) p.set("leaveId", leaveId);
      if (portalKind(role) !== "employee" && !p.get("status") && type === NOTIFICATION_NAV_TYPES.LEAVE) {
        // Keep explicit PENDING deep links from synthetic HR feed when present on original link.
        if (str(notification?.link).includes("status=PENDING")) p.set("status", "PENDING");
      }
      return {
        to: joinPath(base, p),
        recordId: leaveId || null,
        module: "leave",
        type,
      };
    }
    case NOTIFICATION_NAV_TYPES.TASK: {
      const taskId = taskIdFrom(notification, params);
      const base = path?.startsWith("/app/tasks") || path?.startsWith("/admin/work")
        ? path
        : tasksBase(role);
      const p = new URLSearchParams();
      if (taskId) p.set("task", taskId);
      return {
        to: joinPath(base, p),
        recordId: taskId || null,
        module: "tasks",
        type,
      };
    }
    case NOTIFICATION_NAV_TYPES.ATTENDANCE: {
      const employeeId = str(meta.employeeId);
      const sessionId = str(meta.sessionId);
      const remoteId = str(meta.remoteWorkRequestId);
      const kind = portalKind(role);

      if (kind === "employee") {
        const p = new URLSearchParams();
        if (remoteId) p.set("remoteWorkRequestId", remoteId);
        if (sessionId) p.set("sessionId", sessionId);
        return {
          to: joinPath("/app/attendance", p),
          recordId: remoteId || sessionId || null,
          module: "attendance",
          type,
        };
      }

      if (kind === "company" && platform === "mobile") {
        return { to: "/company", recordId: employeeId || sessionId || null, module: "company", type };
      }

      // Mobile HR has a per-employee attendance detail route.
      if (platform === "mobile" && employeeId) {
        return {
          to: `/admin/attendance/${employeeId}`,
          recordId: employeeId,
          module: "attendance",
          type,
        };
      }

      const base = path?.startsWith("/admin/attendance") ? path : "/admin/attendance";
      const p = new URLSearchParams(params);
      if (employeeId) p.set("employeeId", employeeId);
      if (sessionId) p.set("sessionId", sessionId);
      if (remoteId) p.set("remoteWorkRequestId", remoteId);
      if (!p.get("workspace") && str(meta.type) === "OUTSIDE_GEOFENCE") {
        p.set("workspace", "exceptions");
      }
      return {
        to: joinPath(base, p),
        recordId: employeeId || sessionId || remoteId || null,
        module: "attendance",
        type,
      };
    }
    case NOTIFICATION_NAV_TYPES.PAYROLL: {
      if (path?.startsWith("/admin/payroll") || path?.startsWith("/app/payslips")) {
        return { to: joinPath(path, params), recordId: null, module: "payroll", type };
      }
      return { to: payrollBase(role, platform), recordId: null, module: "payroll", type };
    }
    case NOTIFICATION_NAV_TYPES.SYSTEM:
    default: {
      // Prefer a sanitized, role-adapted link; otherwise portal home (never throw).
      if (path) {
        // Hiring / people deep links already encoded in link.
        if (str(meta.offerId) && path.startsWith("/admin/hiring")) {
          const p = new URLSearchParams(params);
          if (!p.get("offerId")) p.set("offerId", str(meta.offerId));
          return { to: joinPath(path, p), recordId: str(meta.offerId), module: "hiring", type };
        }
        if (str(meta.employeeId) && (path === "/admin" || path.startsWith("/admin/employees"))) {
          return {
            to: `/admin/employees/${str(meta.employeeId)}`,
            recordId: str(meta.employeeId),
            module: "people",
            type,
          };
        }
        return {
          to: joinPath(path, params),
          recordId:
            str(meta.offerId) ||
            str(meta.employeeId) ||
            str(meta.taskId) ||
            str(meta.leaveId) ||
            null,
          module: "link",
          type,
        };
      }
      return {
        to: homePath(role, platform),
        recordId: null,
        module: "home",
        type,
      };
    }
  }
}

/**
 * Mark-read + navigate orchestration used by desktop/mobile notification UIs.
 * Nested control clicks should call with { navigate: false }.
 */
export async function activateNotification(notification, handlers = {}) {
  const {
    role,
    platform = "desktop",
    markRead,
    navigateTo,
    closePanel,
    shouldNavigate = true,
  } = handlers;

  const id = notification?.id || notification?._id;
  if (id && typeof markRead === "function" && notification?.isRead !== true) {
    await markRead(notification);
  }

  if (typeof closePanel === "function") {
    closePanel();
  }

  if (!shouldNavigate) {
    return { navigated: false, target: null };
  }

  const target = resolveNotificationNavigation(notification, { role, platform });
  if (target?.to && typeof navigateTo === "function") {
    navigateTo(target.to, { state: { fromNotification: true, notificationId: id || null, recordId: target.recordId } });
    return { navigated: true, target };
  }
  return { navigated: false, target };
}

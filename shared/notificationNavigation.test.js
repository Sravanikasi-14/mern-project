import test from "node:test";
import assert from "node:assert/strict";
import {
  activateNotification,
  resolveNotificationNavigation,
} from "./notificationNavigation.js";

test("LEAVE HR pending maps to leave module with leaveId", () => {
  const target = resolveNotificationNavigation(
    {
      id: "leave-abc123",
      type: "LEAVE",
      link: "/admin/leave?status=PENDING",
      metadata: { leaveId: "abc123" },
    },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.equal(target.recordId, "abc123");
  assert.match(target.to, /^\/admin\/leave\?/);
  assert.match(target.to, /leaveId=abc123/);
  assert.match(target.to, /status=PENDING/);
});

test("LEAVE employee maps to /app/leave with leaveId", () => {
  const target = resolveNotificationNavigation(
    {
      id: "leave-abc123",
      type: "LEAVE",
      link: "/app/leave",
      metadata: { leaveId: "abc123" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/leave?leaveId=abc123");
  assert.equal(target.recordId, "abc123");
});

test("TASK employee passes task id", () => {
  const target = resolveNotificationNavigation(
    {
      id: "task-t1",
      type: "TASK",
      link: "/app/tasks",
      metadata: { taskId: "t1" },
    },
    { role: "EMPLOYEE", platform: "mobile" }
  );
  assert.equal(target.to, "/app/tasks?task=t1");
  assert.equal(target.recordId, "t1");
});

test("TASK HR maps to work-management with task id", () => {
  const target = resolveNotificationNavigation(
    {
      id: "task-t9",
      type: "TASK",
      link: "/admin/work-management",
      metadata: { taskId: "t9" },
    },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.equal(target.to, "/admin/work-management?task=t9");
});

test("MESSAGE desktop uses ?c= conversation id", () => {
  const target = resolveNotificationNavigation(
    {
      type: "MESSAGE",
      link: "/app/messages?c=conv1",
      metadata: { conversationId: "conv1" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/messages?c=conv1");
  assert.equal(target.recordId, "conv1");
});

test("MESSAGE mobile uses path param", () => {
  const target = resolveNotificationNavigation(
    {
      type: "MESSAGE",
      link: "/admin/messages?c=conv2",
      metadata: { conversationId: "conv2" },
    },
    { role: "HR_ADMIN", platform: "mobile" }
  );
  assert.equal(target.to, "/admin/messages/conv2");
});

test("MESSAGE company-admin mobile uses /company/messages/:id", () => {
  const target = resolveNotificationNavigation(
    {
      type: "MESSAGE",
      link: "/admin/messages?c=conv3",
      metadata: { conversationId: "conv3" },
    },
    { role: "COMPANY_ADMIN", platform: "mobile" }
  );
  assert.equal(target.to, "/company/messages/conv3");
});

test("ANNOUNCEMENT opens announcements view with a=", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ANNOUNCEMENT",
      link: "/app/messages?view=announcements&a=ann1",
      metadata: { announcementId: "ann1" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.match(target.to, /view=announcements/);
  assert.match(target.to, /a=ann1/);
  assert.equal(target.recordId, "ann1");
});

test("ATTENDANCE HR desktop includes employeeId and workspace", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/admin/attendance?workspace=exceptions",
      metadata: { employeeId: "emp1", sessionId: "sess1", type: "OUTSIDE_GEOFENCE" },
    },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.match(target.to, /^\/admin\/attendance\?/);
  assert.match(target.to, /employeeId=emp1/);
  assert.match(target.to, /workspace=exceptions/);
  assert.equal(target.recordId, "emp1");
});

test("ATTENDANCE HR mobile opens employee detail route", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/admin/attendance",
      metadata: { employeeId: "emp9" },
    },
    { role: "HR_ADMIN", platform: "mobile" }
  );
  assert.equal(target.to, "/admin/attendance/emp9");
});

test("ATTENDANCE rewrites legacy /employee/attendance for employees", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/employee/attendance",
      metadata: { sessionId: "s1" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/attendance?sessionId=s1");
});

test("ATTENDANCE employee includes remoteWorkRequestId", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/app/attendance",
      metadata: { remoteWorkRequestId: "rw9" },
    },
    { role: "EMPLOYEE", platform: "mobile" }
  );
  assert.equal(target.to, "/app/attendance?remoteWorkRequestId=rw9");
  assert.equal(target.recordId, "rw9");
});

test("HANDOVER employee sets tab=handovers and handoverId", () => {
  const target = resolveNotificationNavigation(
    {
      type: "HANDOVER",
      link: "/app/leave?tab=handovers",
      metadata: { handoverId: "leave55" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.match(target.to, /tab=handovers/);
  assert.match(target.to, /handoverId=leave55/);
});

test("HANDOVER with taskId for employee opens tasks", () => {
  const target = resolveNotificationNavigation(
    {
      type: "HANDOVER",
      link: "/app/tasks?task=task77",
      metadata: { handoverId: "leave1", taskId: "task77" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/tasks?task=task77");
  assert.equal(target.recordId, "task77");
});

test("HANDOVER HR opens leave with leaveId", () => {
  const target = resolveNotificationNavigation(
    {
      type: "HANDOVER",
      link: "/admin/leave",
      metadata: { handoverId: "leave55" },
    },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.match(target.to, /^\/admin\/leave\?/);
  assert.match(target.to, /leaveId=leave55/);
  assert.match(target.to, /handoverId=leave55/);
});

test("PAYROLL falls back to payroll module", () => {
  const target = resolveNotificationNavigation(
    { type: "PAYROLL", link: "" },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.equal(target.to, "/admin/payroll");
});

test("SYSTEM with safe link is preserved", () => {
  const target = resolveNotificationNavigation(
    {
      type: "SYSTEM",
      link: "/admin/hiring?offerId=off1",
      metadata: { offerId: "off1" },
    },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.match(target.to, /offerId=off1/);
  assert.equal(target.recordId, "off1");
});

test("unknown type with unsafe link falls back to home", () => {
  const target = resolveNotificationNavigation(
    { type: "WEIRD_TYPE", link: "https://evil.example/phish" },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/dashboard");
});

test("unknown type without link falls back without throwing", () => {
  const target = resolveNotificationNavigation(
    { type: "NOT_A_REAL_TYPE" },
    { role: "HR_ADMIN", platform: "mobile" }
  );
  assert.equal(target.to, "/admin/dashboard");
});

test("missing related metadata still lands on module page", () => {
  const target = resolveNotificationNavigation(
    { type: "LEAVE", link: "/admin/leave?status=PENDING", metadata: {} },
    { role: "HR_ADMIN", platform: "desktop" }
  );
  assert.match(target.to, /^\/admin\/leave/);
  assert.equal(target.recordId, null);
});

test("employee cannot keep admin attendance link", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/admin/attendance?workspace=remote",
      metadata: { remoteWorkRequestId: "rw1" },
    },
    { role: "EMPLOYEE", platform: "desktop" }
  );
  assert.equal(target.to, "/app/attendance?remoteWorkRequestId=rw1");
  assert.doesNotMatch(target.to, /\/admin\//);
});

test("company-admin mobile attendance falls back to company home", () => {
  const target = resolveNotificationNavigation(
    {
      type: "ATTENDANCE",
      link: "/admin/attendance",
      metadata: { employeeId: "e1" },
    },
    { role: "COMPANY_ADMIN", platform: "mobile" }
  );
  assert.equal(target.to, "/company");
});

test("activateNotification marks read then navigates", async () => {
  const calls = [];
  const result = await activateNotification(
    {
      id: "n1",
      type: "TASK",
      isRead: false,
      link: "/app/tasks",
      metadata: { taskId: "t1" },
    },
    {
      role: "EMPLOYEE",
      platform: "desktop",
      markRead: async (n) => {
        calls.push(`read:${n.id}`);
      },
      closePanel: () => calls.push("close"),
      navigateTo: (to) => calls.push(`nav:${to}`),
    }
  );
  assert.deepEqual(calls, ["read:n1", "close", "nav:/app/tasks?task=t1"]);
  assert.equal(result.navigated, true);
});

test("activateNotification skips navigation when shouldNavigate is false", async () => {
  const calls = [];
  const result = await activateNotification(
    { id: "n2", type: "MESSAGE", isRead: false, metadata: { conversationId: "c1" } },
    {
      role: "EMPLOYEE",
      platform: "desktop",
      shouldNavigate: false,
      markRead: async () => calls.push("read"),
      closePanel: () => calls.push("close"),
      navigateTo: (to) => calls.push(`nav:${to}`),
    }
  );
  assert.deepEqual(calls, ["read", "close"]);
  assert.equal(result.navigated, false);
});

test("activateNotification does not re-mark already read items", async () => {
  let marked = false;
  await activateNotification(
    { id: "n3", type: "SYSTEM", isRead: true, link: "/app/dashboard" },
    {
      role: "EMPLOYEE",
      platform: "desktop",
      markRead: async () => {
        marked = true;
      },
      navigateTo: () => {},
    }
  );
  assert.equal(marked, false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { activateNotification } from "../../../shared/notificationNavigation.js";

const root = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(root, "NotificationPanel.jsx"), "utf8");
const toast = readFileSync(join(root, "Toast.jsx"), "utf8");

describe("desktop mark-read failure toast", () => {
  it("wires toast on mark-read failure while keeping activateNotification", () => {
    assert.match(panel, /useToast/);
    assert.match(panel, /Could not mark the notification as read/);
    assert.match(panel, /activateNotification/);
    assert.match(panel, /notificationsQuery\.refetch/);
  });

  it("ToastProvider dedupes identical messages", () => {
    assert.match(toast, /prev\.some\(\(item\) => item\.message === text\)/);
  });

  it("activateNotification still navigates after markRead rejects when caught by caller", async () => {
    const calls = [];
    await activateNotification(
      {
        id: "n-fail",
        type: "TASK",
        isRead: false,
        link: "/app/tasks",
        metadata: { taskId: "t1" },
      },
      {
        role: "EMPLOYEE",
        platform: "desktop",
        markRead: async () => {
          calls.push("read-failed-handled");
          // UI catches API errors before rethrowing — simulate handled failure.
        },
        closePanel: () => calls.push("close"),
        navigateTo: (to) => calls.push(`nav:${to}`),
      }
    );
    assert.deepEqual(calls, ["read-failed-handled", "close", "nav:/app/tasks?task=t1"]);
  });
});

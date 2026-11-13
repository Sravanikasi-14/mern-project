import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(join(root, "NotificationSheet.jsx"), "utf8");
const toast = readFileSync(join(root, "Toast.jsx"), "utf8");

describe("mobile mark-read failure toast", () => {
  it("shows toast on mark-read failure and still activates navigation", () => {
    assert.match(sheet, /useToast/);
    assert.match(sheet, /Could not mark the notification as read/);
    assert.match(sheet, /activateNotification/);
    assert.match(sheet, /notesQuery\.refetch/);
  });

  it("dedupes identical toast messages", () => {
    assert.match(toast, /prev\.some\(\(item\) => item\.message === text\)/);
  });
});

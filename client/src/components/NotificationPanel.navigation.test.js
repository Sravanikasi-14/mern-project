import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "NotificationPanel.jsx"), "utf8");

describe("NotificationPanel context-aware navigation wiring", () => {
  it("uses shared activateNotification helper", () => {
    assert.match(src, /activateNotification/);
    assert.match(src, /@shared\/notificationNavigation/);
  });

  it("marks nested mark-all / close controls with data-notif-stop", () => {
    assert.match(src, /data-notif-stop="true"/);
    assert.match(src, /closest\?\.\("\[data-notif-stop\]"\)/);
  });

  it("does not navigate using raw notif.link alone", () => {
    assert.doesNotMatch(src, /navigate\(notif\.link\)/);
  });

  it("passes desktop platform and user role into activation", () => {
    assert.match(src, /platform:\s*"desktop"/);
    assert.match(src, /role:\s*user\?\.role/);
  });
});

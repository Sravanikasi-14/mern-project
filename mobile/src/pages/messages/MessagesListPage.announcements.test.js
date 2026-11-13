import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "MessagesListPage.jsx"), "utf8");

describe("mobile MessagesListPage announcement deep links", () => {
  it("consumes view=announcements and a=announcementId", () => {
    assert.match(src, /useSearchParams/);
    assert.match(src, /view === "announcements"|get\("view"\)/);
    assert.match(src, /get\("a"\)/);
    assert.match(src, /\/announcements\/\$\{selectedAnnouncementId\}|\/announcements\/\$\{/);
  });

  it("opens announcement detail modal for deep-linked id", () => {
    assert.match(src, /selectedAnnouncementId/);
    assert.match(src, /<Modal/);
    assert.match(src, /This announcement could not be opened/);
  });

  it("preserves chats list when announcement params are absent", () => {
    assert.match(src, /Chats/);
    assert.match(src, /useConversationsQuery/);
    assert.match(src, /showAnnouncements \?/);
  });
});

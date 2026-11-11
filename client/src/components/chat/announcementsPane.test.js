import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  announcementTiming,
  audienceLabelFor,
  formatAnnouncementDate,
  timingPrefix,
} from "./announcementDisplay.js";

const root = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(root, "AnnouncementsPane.jsx"), "utf8");
const css = readFileSync(join(root, "../../pages/Messages.css"), "utf8");

describe("announcement display helpers", () => {
  it("formats dates with month, day, year, and time", () => {
    const label = formatAnnouncementDate("2026-03-15T10:30:00.000Z");
    assert.ok(label.includes("2026"));
    assert.ok(label.includes("15") || label.includes("Mar"));
    assert.equal(formatAnnouncementDate(""), "");
    assert.equal(formatAnnouncementDate("not-a-date"), "");
  });

  it("picks publication, schedule, and archive timing from stored fields", () => {
    assert.equal(
      announcementTiming({ status: "PUBLISHED", publishedAt: "2026-01-02T08:00:00.000Z" }).kind,
      "published"
    );
    assert.equal(
      announcementTiming({ status: "SCHEDULED", scheduledAt: "2026-04-01T09:00:00.000Z" }).kind,
      "scheduled"
    );
    assert.equal(
      announcementTiming({
        status: "WITHDRAWN",
        withdrawnAt: "2026-02-01T12:00:00.000Z",
        createdAt: "2026-01-01T12:00:00.000Z",
      }).kind,
      "withdrawn"
    );
    assert.equal(timingPrefix("published"), "Published");
    assert.equal(timingPrefix("withdrawn"), "Archived");
  });

  it("maps audience and status labels from API values", () => {
    assert.equal(audienceLabelFor({ audience: "COMPANY" }), "Entire company");
    assert.equal(
      audienceLabelFor({ audience: "DEPARTMENTS", departmentNames: ["Engineering", "HR"] }),
      "Engineering, HR"
    );
    assert.equal(audienceLabelFor({ audience: "DEPARTMENTS", departmentNames: [] }), "Selected departments");
    assert.equal(PRIORITY_LABEL.URGENT, "Urgent");
    assert.equal(STATUS_LABEL.DRAFT, "Draft");
    assert.equal(STATUS_LABEL.WITHDRAWN, "Archived");
  });
});

describe("announcements pane markup contracts", () => {
  it("maps author, priority, status, audience, and body from API fields", () => {
    assert.match(jsx, /publishedByName/);
    assert.match(jsx, /PRIORITY_LABEL/);
    assert.match(jsx, /STATUS_LABEL/);
    assert.match(jsx, /audienceLabelFor/);
    assert.match(jsx, /detail\.body/);
    assert.match(jsx, /msg-announcement-text/);
    assert.doesNotMatch(jsx, /dummy announcement/i);
    assert.doesNotMatch(jsx, /lorem ipsum/i);
  });

  it("keeps create, edit, publish, and withdraw workflows", () => {
    assert.match(jsx, /api\.post\("\/announcements"/);
    assert.match(jsx, /api\.patch\(`\/announcements\/\$\{editingId\}`/);
    assert.match(jsx, /\/announcements\/\$\{detail\.id\}\/withdraw/);
    assert.match(jsx, /Publish now/);
    assert.match(jsx, /Save as draft/);
  });

  it("uses a dedicated list item layout instead of the chat avatar grid", () => {
    assert.match(css, /\.msg-announce-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    assert.match(css, /\.msg-announce-item\.is-active/);
    assert.match(css, /\.msg-status\.is-draft/);
    assert.match(css, /\.msg-announcement-text/);
    assert.match(css, /white-space:\s*pre-wrap/);
    assert.match(jsx, /msg-announce-item/);
    assert.doesNotMatch(jsx, /className=\{`msg-person/);
  });
});

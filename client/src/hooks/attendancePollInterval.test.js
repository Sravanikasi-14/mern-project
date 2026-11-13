import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { attendancePollIntervalMs } from "../lib/attendancePollInterval.js";

const root = dirname(fileURLToPath(import.meta.url));
const livePage = readFileSync(join(root, "../pages/AdminLiveTracking.jsx"), "utf8");
const overviewPage = readFileSync(join(root, "../pages/AdminAttendanceOverview.jsx"), "utf8");

describe("F38 attendance polling helpers", () => {
  it("pauses polling when the document is hidden", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "hidden" };
    try {
      assert.equal(attendancePollIntervalMs(60_000, { state: { data: { live: [{}] } } }), false);
    } finally {
      globalThis.document = prev;
    }
  });

  it("slows polling when the live list is empty", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "visible" };
    try {
      const ms = attendancePollIntervalMs(60_000, { state: { data: { live: [] } } }, {
        slowWhenEmptyMs: 180_000,
        emptyPath: (data) => data?.live,
      });
      assert.equal(ms, 180_000);
    } finally {
      globalThis.document = prev;
    }
  });

  it("AdminLiveTracking polls live only (history has no refetchInterval ticker)", () => {
    assert.match(livePage, /refetchInterval:\s*false/);
    assert.match(livePage, /slowWhenEmptyMs:\s*POLL_EMPTY_MS/);
    // One live poll cadence; history query must not schedule an interval ticker.
    const slowUses = livePage.match(/slowWhenEmptyMs:\s*POLL_EMPTY_MS/g) || [];
    assert.equal(slowUses.length, 1);
    assert.match(livePage, /historyQuery = useTrackingSessionsQuery\([\s\S]*?refetchInterval:\s*false/);
  });

  it("AdminAttendanceOverview disables polling in range mode", () => {
    assert.match(overviewPage, /refetchInterval:\s*isRangeMode/);
    assert.match(overviewPage, /attendancePollIntervalMs\(OVERVIEW_POLL_MS/);
  });
});

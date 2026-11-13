import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "LeavePage.jsx"), "utf8");

describe("mobile employee leave notification deep links", () => {
  it("consumes leaveId and opens leave detail", () => {
    assert.match(src, /get\("leaveId"\)/);
    assert.match(src, /setSelected\(hit\)/);
  });

  it("activates handovers section from tab=handovers", () => {
    assert.match(src, /tab.*handovers|handovers.*tab/);
    assert.match(src, /section === "handovers"|setSection\("handovers"\)/);
    assert.match(src, /\/handovers\/mine/);
  });

  it("focuses handoverId records", () => {
    assert.match(src, /get\("handoverId"\)/);
    assert.match(src, /setFocusedHandoverId/);
    assert.match(src, /handover-card-/);
  });
});

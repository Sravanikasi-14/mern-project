import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "EmployeeLeave.jsx"), "utf8");
const handoverSrc = readFileSync(join(root, "../components/HandoverWorkspace.jsx"), "utf8");

describe("desktop employee leave notification deep links", () => {
  it("consumes leaveId and opens leave detail", () => {
    assert.match(src, /useSearchParams/);
    assert.match(src, /get\("leaveId"\)/);
    assert.match(src, /setSelectedLeave/);
    assert.match(src, /Leave request/);
  });

  it("activates handovers tab from tab=handovers", () => {
    assert.match(src, /tab === "handovers"|get\("tab"\).*handovers/);
    assert.match(src, /HandoverWorkspace/);
    assert.match(src, /pageTab === "handovers"/);
  });

  it("passes handoverId focus into HandoverWorkspace", () => {
    assert.match(src, /focusHandoverId/);
    assert.match(src, /get\("handoverId"\)/);
    assert.match(handoverSrc, /focusHandoverId/);
    assert.match(handoverSrc, /handover-card-/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(root, "AttendanceLocationWorkspace.jsx"), "utf8");
const overview = readFileSync(join(root, "../pages/AdminAttendanceOverview.jsx"), "utf8");
const employeeAtt = readFileSync(join(root, "../pages/EmployeeAttendance.jsx"), "utf8");

describe("attendance notification deep links", () => {
  it("consumes remoteWorkRequestId and sessionId focus props", () => {
    assert.match(jsx, /focusRemoteWorkRequestId/);
    assert.match(jsx, /focusSessionId/);
    assert.match(jsx, /status=ALL|\"ALL\"/);
    assert.match(jsx, /alw-card-/);
    assert.match(jsx, /is-focused/);
  });

  it("admin attendance wires focus params into workspaces", () => {
    assert.match(overview, /remoteWorkRequestId/);
    assert.match(overview, /sessionId/);
    assert.match(overview, /focusRemoteWorkRequestId/);
    assert.match(overview, /focusSessionId/);
    assert.match(overview, /inferredWorkspace/);
  });

  it("employee attendance consumes remoteWorkRequestId gracefully", () => {
    assert.match(employeeAtt, /get\("remoteWorkRequestId"\)/);
    assert.match(employeeAtt, /focusedRemoteId/);
    assert.match(employeeAtt, /remote-req-/);
  });

  it("does not invent authorization for deep-linked records", () => {
    assert.match(jsx, /punchEligibility|eligibilityFromRow/);
    assert.doesNotMatch(jsx, /bypassAuth|skipAuth/);
  });
});

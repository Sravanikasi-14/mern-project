import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(root, "AttendanceLocationWorkspace.jsx"), "utf8");
const css = readFileSync(join(root, "AttendanceLocationWorkspace.css"), "utf8");
const overview = readFileSync(join(root, "../pages/AdminAttendanceOverview.jsx"), "utf8");

describe("attendance location workspace contracts", () => {
  it("renders backend punchEligibility instead of inventing authorization", () => {
    assert.match(jsx, /row\?\.punchEligibility|eligibilityFromRow/);
    assert.match(jsx, /punchEligibility/);
    assert.match(jsx, /Remote punch: allowed/);
    assert.match(jsx, /Remote punch: not allowed/);
    assert.doesNotMatch(jsx, /function remoteEligibility\(/);
    assert.doesNotMatch(jsx, /function exceptionEligibility\(/);
  });

  it("keeps remote approvals distinct from location exceptions", () => {
    assert.match(jsx, /Remote Approvals/);
    assert.match(jsx, /Location Exceptions/);
    assert.match(jsx, /does <em>not<\/em> grant remote punch/);
    assert.match(jsx, /Mark regularized/);
    assert.match(jsx, /Approve remote day/);
    assert.match(jsx, /whyListed/);
  });

  it("preserves notification workspace deep links in admin attendance", () => {
    assert.match(overview, /workspace=remote|set\("workspace"/);
    assert.match(overview, /requestedTab === "remote"/);
    assert.match(overview, /requestedTab === "exceptions"/);
    assert.match(overview, /AttendanceLocationWorkspace mode="remote"/);
    assert.match(overview, /AttendanceLocationWorkspace mode="exceptions"/);
  });

  it("styles eligibility prominently for desktop and mobile", () => {
    assert.match(css, /\.alw-elig/);
    assert.match(css, /\.alw-elig\.is-ok/);
    assert.match(css, /\.alw-elig\.is-pending/);
    assert.match(css, /@media \(max-width: 720px\)/);
  });
});

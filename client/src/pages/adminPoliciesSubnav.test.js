import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { getPolicySubsections } from "./policySubsections.js";

const root = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(root, "AdminPolicies.jsx"), "utf8");
const css = readFileSync(join(root, "AdminPolicies.css"), "utf8");

describe("HR policy subsection navigation", () => {
  it("returns dynamic subsections for each known policy card", () => {
    const attendance = getPolicySubsections("attendance_leave");
    assert.equal(attendance.length, 8);
    assert.equal(attendance[0].id, "pol-shift-timings");
    assert.equal(attendance.at(-1).id, "pol-wfh-hybrid");

    const payroll = getPolicySubsections("payroll_compensation");
    assert.equal(payroll.length, 3);

    const few = getPolicySubsections("company_conduct");
    assert.equal(few.length, 2);

    const single = getPolicySubsections("workplace_compliance");
    assert.equal(single.length, 1);
    assert.equal(single[0].id, "pol-documents");
  });

  it("handles missing policies and empty input safely", () => {
    assert.deepEqual(getPolicySubsections("does_not_exist"), []);
    assert.deepEqual(getPolicySubsections(null), []);
    assert.deepEqual(getPolicySubsections(undefined), []);
  });

  it("ensures every declared subsection id exists exactly once in the editor markup", () => {
    const policies = [
      "attendance_leave",
      "payroll_compensation",
      "employment_recruitment",
      "workplace_compliance",
      "company_conduct",
      "revision_history",
    ];
    for (const policyId of policies) {
      const sections = getPolicySubsections(policyId);
      const ids = sections.map((s) => s.id);
      assert.equal(new Set(ids).size, ids.length, `${policyId} has duplicate subsection ids`);
      for (const id of ids) {
        const matches = jsx.match(new RegExp(`id="${id}"`, "g")) || [];
        assert.equal(
          matches.length,
          1,
          `${policyId} subsection ${id} should appear once as an element id (found ${matches.length})`
        );
      }
    }
  });

  it("keeps the subsection nav sticky with horizontal overflow support", () => {
    assert.match(css, /\.policies-subnav\s*\{[^}]*position:\s*sticky/s);
    assert.match(css, /\.policies-subnav\s*\{[^}]*top:\s*var\(--safe-top/s);
    assert.match(css, /\.policies-subnav\s*\{[\s\S]*?top:\s*var\(--safe-top,\s*0px\);/);
    assert.equal(/\/\*\s*Stick to the top of \.app-main-content/.test(css), true);
    assert.match(css, /\.policies-subnav-track\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(css, /\.policies-subnav-btn\.is-active/);
    assert.match(css, /\.policies-section-card\s*\{[^}]*scroll-margin-top/s);
  });

  it("wires AdminPolicies to the shared subsection helper and scroll sync", () => {
    assert.match(jsx, /from "\.\/policySubsections"/);
    assert.match(jsx, /getPolicySubsections/);
    assert.match(jsx, /scrollToPolicySection/);
    assert.match(jsx, /scrollingFromSubnavClickRef/);
    assert.match(jsx, /POLICY_SUBNAV_STICKY_OFFSET_PX/);
    assert.match(jsx, /getPolicyScrollParent/);
    assert.match(jsx, /\.app-main-content/);
  });
});

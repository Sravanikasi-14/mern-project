import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "EmployeeProfileView.css"),
  "utf8"
);

describe("employee profile shared card tokens", () => {
  it("defines the shared profile-card token block", () => {
    for (const token of [
      "--profile-card-radius",
      "--profile-card-padding",
      "--profile-card-border",
      "--profile-card-shadow",
      "--profile-card-bg",
      "--profile-stack-gap",
      "--profile-title-size",
      "--profile-icon-box",
      "--profile-empty-pad",
    ]) {
      assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("routes major card surfaces through shared tokens", () => {
    const surfaces = [
      ".epd-card",
      ".epd-stat",
      ".epd-toolbar",
      ".profile-card",
      ".epv-kpi-card",
      ".epv-person-card",
      ".epv-format-card",
      ".epv-records-panel",
    ];
    for (const selector of surfaces) {
      const re = new RegExp(
        `${selector.replace(".", "\\.")}\\s*\\{[^}]*--profile-card-(radius|padding|border|shadow|bg)`,
        "m"
      );
      assert.match(css, re, `${selector} should consume profile card tokens`);
    }
  });

  it("keeps stack/grid gaps on the shared spacing token", () => {
    assert.match(css, /\.epd-stack[\s\S]{0,120}--profile-stack-gap/);
    assert.match(css, /\.epd-grid-2[\s\S]{0,120}--profile-stack-gap/);
    assert.match(css, /\.epd-stat-row[\s\S]{0,160}--profile-stack-gap/);
  });

  it("standardizes empty-state and header icon sizing", () => {
    assert.match(css, /\.epd-empty[\s\S]{0,220}--profile-empty-pad/);
    assert.match(css, /\.epd-empty-icon[\s\S]{0,160}--profile-icon-box/);
    assert.match(css, /\.card-header-icon[\s\S]{0,160}--profile-icon-box/);
  });
});

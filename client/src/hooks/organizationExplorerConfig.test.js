import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeExplorerConfig,
  resolveActiveExplorerView,
} from "./organizationExplorerConfig.js";

describe("normalizeExplorerConfig", () => {
  it("fills defaults for missing / partial config", () => {
    const a = normalizeExplorerConfig(undefined);
    assert.deepEqual(a.enabledViews, ["reporting", "teams", "projects", "departments"]);
    assert.equal(a.defaultView, "reporting");
    assert.equal(a.allowCompletedProjectsFilter, false);

    const b = normalizeExplorerConfig({});
    assert.equal(b.defaultView, "reporting");
    assert.ok(b.enabledViews.includes("departments"));
  });

  it("keeps a subset of enabled views and falls back defaultView", () => {
    const cfg = normalizeExplorerConfig({
      enabledViews: ["teams", "departments"],
      defaultView: "reporting",
    });
    assert.deepEqual(cfg.enabledViews, ["teams", "departments"]);
    assert.equal(cfg.defaultView, "teams");
  });

  it("dedupes and lowercases view ids", () => {
    const cfg = normalizeExplorerConfig({
      enabledViews: ["Reporting", "reporting", "projects"],
      defaultView: "PROJECTS",
    });
    assert.deepEqual(cfg.enabledViews, ["reporting", "projects"]);
    assert.equal(cfg.defaultView, "projects");
  });

  it("ignores unknown views", () => {
    const cfg = normalizeExplorerConfig({
      enabledViews: ["reporting", "galaxy"],
      defaultView: "galaxy",
    });
    assert.deepEqual(cfg.enabledViews, ["reporting"]);
    assert.equal(cfg.defaultView, "reporting");
  });
});

describe("resolveActiveExplorerView", () => {
  it("prefers an enabled user selection", () => {
    assert.equal(resolveActiveExplorerView("projects", ["reporting", "projects"]), "projects");
  });

  it("falls back when preferred is disabled or missing", () => {
    assert.equal(resolveActiveExplorerView("teams", ["reporting", "departments"]), "reporting");
    assert.equal(resolveActiveExplorerView(null, ["departments", "teams"]), "departments");
  });

  it("returns null when nothing is enabled", () => {
    assert.equal(resolveActiveExplorerView("reporting", []), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFilterPanelPlacement,
  filterPanelFitsViewport,
  FILTER_PANEL_MIN_HEIGHT,
} from "./moduleFilterPanelPlacement.js";

describe("module filter panel placement", () => {
  it("keeps the panel inside a tall desktop viewport when opened below the trigger", () => {
    const viewport = { innerWidth: 1440, innerHeight: 900 };
    const trigger = { top: 120, right: 1400, bottom: 160, left: 1280, width: 120, height: 40 };
    const placed = computeFilterPanelPlacement(trigger, viewport);
    assert.equal(placed.openBelow, true);
    assert.equal(filterPanelFitsViewport(placed, viewport), true);
    assert.ok(placed.maxHeight >= FILTER_PANEL_MIN_HEIGHT);
  });

  it("opens above when there is little space below (short viewport / scrolled trigger)", () => {
    const viewport = { innerWidth: 1280, innerHeight: 700 };
    const trigger = { top: 560, right: 1240, bottom: 600, left: 1120, width: 120, height: 40 };
    const placed = computeFilterPanelPlacement(trigger, viewport);
    assert.equal(placed.openBelow, false);
    assert.equal(filterPanelFitsViewport(placed, viewport), true);
    assert.ok(placed.top + placed.maxHeight <= viewport.innerHeight - 12);
  });

  it("fits a short laptop viewport with many filter fields (long content capped by maxHeight)", () => {
    const viewport = { innerWidth: 1366, innerHeight: 640 };
    const trigger = { top: 96, right: 1320, bottom: 136, left: 1200, width: 120, height: 40 };
    const placed = computeFilterPanelPlacement(trigger, viewport);
    assert.equal(filterPanelFitsViewport(placed, viewport), true);
    assert.ok(placed.maxHeight <= Math.floor(viewport.innerHeight * 0.78));
    // Simulated long filter body still constrained by panel maxHeight (footer stays reachable)
    const longContentHeight = 1200;
    const scrollableBody = Math.max(0, placed.maxHeight - 64);
    assert.ok(scrollableBody < longContentHeight);
    assert.ok(scrollableBody >= FILTER_PANEL_MIN_HEIGHT - 64);
  });

  it("clamps horizontally on narrow viewports", () => {
    const viewport = { innerWidth: 390, innerHeight: 720 };
    const trigger = { top: 80, right: 380, bottom: 120, left: 260, width: 120, height: 40 };
    const placed = computeFilterPanelPlacement(trigger, viewport);
    assert.equal(filterPanelFitsViewport(placed, viewport), true);
    assert.ok(placed.width <= viewport.innerWidth - 24);
    assert.ok(placed.left >= 12);
  });
});

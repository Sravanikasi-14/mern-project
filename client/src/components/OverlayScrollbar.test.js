import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  computeOverlayThumbLayout,
  createRafScheduler,
} from "./overlayScrollbarSync.js";

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, "OverlayScrollbar.jsx"), "utf8");

describe("OverlayScrollbar Phase 2 sync helpers", () => {
  it("hides the thumb when the container is not scrollable", () => {
    assert.deepEqual(computeOverlayThumbLayout(400, 400, 0), {
      overflow: false,
      thumbH: 0,
      top: 0,
    });
    assert.deepEqual(computeOverlayThumbLayout(400, 401, 0), {
      overflow: false,
      thumbH: 0,
      top: 0,
    });
  });

  it("treats zero-height containers as non-scrollable", () => {
    assert.deepEqual(computeOverlayThumbLayout(0, 2000, 100), {
      overflow: false,
      thumbH: 0,
      top: 0,
    });
  });

  it("clamps thumb height and tracks scroll position", () => {
    const atTop = computeOverlayThumbLayout(400, 2000, 0);
    assert.equal(atTop.overflow, true);
    assert.ok(atTop.thumbH >= 20 && atTop.thumbH <= 40);
    assert.equal(atTop.top, 0);

    const atBottom = computeOverlayThumbLayout(400, 2000, 1600);
    assert.equal(atBottom.overflow, true);
    assert.equal(atBottom.thumbH, atTop.thumbH);
    const track = Math.max(400 - 8, 1);
    const maxTop = Math.max(track - atBottom.thumbH, 0);
    assert.equal(atBottom.top, maxTop);
  });

  it("coalesces multiple schedule calls into one rAF callback", () => {
    const pending = new Map();
    let nextId = 1;
    const raf = (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    };
    const caf = (id) => {
      pending.delete(id);
    };

    let runs = 0;
    const scheduler = createRafScheduler(
      () => {
        runs += 1;
      },
      { raf, caf }
    );

    assert.equal(scheduler.schedule(), true);
    assert.equal(scheduler.schedule(), false);
    assert.equal(scheduler.schedule(), false);
    assert.equal(scheduler.isPending(), true);
    assert.equal(runs, 0);

    for (const cb of pending.values()) cb();
    pending.clear();

    assert.equal(runs, 1);
    assert.equal(scheduler.isPending(), false);
  });

  it("cancels a pending rAF without running the callback", () => {
    const pending = new Map();
    let nextId = 1;
    const raf = (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    };
    const caf = (id) => pending.delete(id);

    let runs = 0;
    const scheduler = createRafScheduler(
      () => {
        runs += 1;
      },
      { raf, caf }
    );

    scheduler.schedule();
    scheduler.cancel();
    assert.equal(scheduler.isPending(), false);
    assert.equal(pending.size, 0);
    assert.equal(runs, 0);

    assert.equal(scheduler.schedule(), true);
    for (const cb of pending.values()) cb();
    assert.equal(runs, 1);
  });
});

describe("OverlayScrollbar Phase 2 source contracts", () => {
  it("uses rAF scheduling and does not keep the 1200ms sync poll", () => {
    assert.match(src, /createRafScheduler/);
    assert.match(src, /scheduler\.cancel/);
    assert.doesNotMatch(src, /setInterval\(\s*sync/);
    assert.doesNotMatch(src, /setInterval\(\s*scheduleSync/);
    assert.doesNotMatch(src, /setInterval\(syncNow/);
    assert.match(src, /ENSURE_MS/);
    assert.match(src, /setInterval\(ensure/);
  });

  it("scopes drag listeners to the active drag and cleans them up", () => {
    assert.match(src, /bindDragListeners/);
    assert.match(src, /unbindDragListeners/);
    assert.match(src, /pointercancel/);
    // Window pointer listeners exist only inside bindDragListeners (not at attach time).
    assert.match(src, /const bindDragListeners[\s\S]*window\.addEventListener\("pointermove"/);
    assert.match(src, /thumb\.addEventListener\("pointerdown", onPointerDown\)/);
    const attachTail = src.slice(src.indexOf("thumb.addEventListener(\"pointerdown\""));
    const beforeCleanup = attachTail.slice(0, attachTail.indexOf("return () =>"));
    assert.doesNotMatch(beforeCleanup, /window\.addEventListener\("pointermove"/);
  });

  it("keeps MutationObserver but drops characterData observation", () => {
    assert.match(src, /MutationObserver/);
    assert.match(src, /childList:\s*true/);
    assert.match(src, /subtree:\s*true/);
    assert.doesNotMatch(src, /characterData:\s*true/);
  });

  it("skips redundant thumb style writes via last layout cache", () => {
    assert.match(src, /lastThumbH/);
    assert.match(src, /lastTop/);
    assert.match(src, /lastOverflow/);
  });

  it("detaches overlays for disconnected scroll containers during ensure", () => {
    assert.match(src, /!el\.isConnected/);
  });
});

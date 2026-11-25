import { useEffect } from "react";
import {
  computeOverlayThumbLayout,
  createRafScheduler,
} from "./overlayScrollbarSync.js";

/**
 * Custom ultra-thin overlay scrollbars for primary HRMS scrollports.
 * Hides native chrome (no content-size change) and paints a short dark thumb.
 *
 * Phase 2: scroll/resize/mutation work is coalesced to one rAF sync per frame,
 * style writes are skipped when unchanged, and the 1200ms sync poll is removed
 * in favor of ResizeObserver on the container + direct children.
 */
const SELECTORS = [".app-main-content", ".sidebar-nav"];
const HIDE_MS = 1200;
/** Remount / late-mount recovery for SPA route shells. */
const ENSURE_MS = 1500;

function attachOverlay(el) {
  if (!el || el.dataset.overlayScroll === "1") return () => {};
  el.dataset.overlayScroll = "1";

  const prevPosition = getComputedStyle(el).position;
  if (prevPosition === "static") el.style.position = "relative";

  const rail = document.createElement("div");
  rail.className = "hrms-overlay-scroll-rail";
  rail.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "hrms-overlay-scroll-thumb";
  rail.appendChild(thumb);
  el.appendChild(rail);

  let hideTimer = null;
  let dragging = false;
  let dragStartY = 0;
  let dragStartScroll = 0;
  let lastOverflow = null;
  let lastThumbH = null;
  let lastTop = null;
  let dragListenersBound = false;

  const show = () => {
    rail.classList.add("is-visible");
    window.clearTimeout(hideTimer);
    if (!dragging) {
      hideTimer = window.setTimeout(() => rail.classList.remove("is-visible"), HIDE_MS);
    }
  };

  const syncNow = () => {
    const clientHeight = el.clientHeight;
    const scrollHeight = el.scrollHeight;
    const scrollTop = el.scrollTop;
    const layout = computeOverlayThumbLayout(clientHeight, scrollHeight, scrollTop);

    if (layout.overflow !== lastOverflow) {
      rail.style.display = layout.overflow ? "block" : "none";
      lastOverflow = layout.overflow;
    }
    if (!layout.overflow) return;

    if (layout.thumbH !== lastThumbH) {
      thumb.style.height = `${layout.thumbH}px`;
      lastThumbH = layout.thumbH;
    }
    // Visual offset matches prior behavior (4px inset from track top).
    if (layout.top !== lastTop) {
      thumb.style.transform = `translateY(${layout.top + 4}px)`;
      lastTop = layout.top;
    }
  };

  const scheduler = createRafScheduler(syncNow);
  const scheduleSync = () => {
    scheduler.schedule();
  };

  const onScroll = () => {
    scheduleSync();
    show();
  };

  const unbindDragListeners = () => {
    if (!dragListenersBound) return;
    thumb.removeEventListener("pointermove", onPointerMove);
    thumb.removeEventListener("pointerup", onPointerUp);
    thumb.removeEventListener("pointercancel", onPointerUp);
    // Window fallback for environments without reliable pointer capture.
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    dragListenersBound = false;
  };

  const bindDragListeners = () => {
    if (dragListenersBound) return;
    thumb.addEventListener("pointermove", onPointerMove);
    thumb.addEventListener("pointerup", onPointerUp);
    thumb.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    dragListenersBound = true;
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    dragStartY = event.clientY;
    dragStartScroll = el.scrollTop;
    rail.classList.add("is-dragging");
    show();
    bindDragListeners();
    thumb.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    const { clientHeight, scrollHeight } = el;
    const layout = computeOverlayThumbLayout(clientHeight, scrollHeight, 0);
    if (!layout.overflow) return;
    const track = Math.max(clientHeight - 8, 1);
    const maxTop = Math.max(track - layout.thumbH, 0);
    const delta = event.clientY - dragStartY;
    const scrollRange = Math.max(scrollHeight - clientHeight, 1);
    el.scrollTop = dragStartScroll + (delta / Math.max(maxTop, 1)) * scrollRange;
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove("is-dragging");
    try {
      thumb.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
    unbindDragListeners();
    show();
    scheduleSync();
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", scheduleSync);
  thumb.addEventListener("pointerdown", onPointerDown);

  const isOverlayChrome = (node) =>
    node === rail || node === thumb || node?.classList?.contains("hrms-overlay-scroll-rail");

  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          scheduleSync();
        })
      : null;
  ro?.observe(el);
  // Direct children cover deep content growth (child box changes when descendants reflow).
  const observeSizeTarget = (node) => {
    if (!ro || !node || node.nodeType !== 1 || isOverlayChrome(node)) return;
    try {
      ro.observe(node);
    } catch {
      /* ignore disconnected / unsupported */
    }
  };
  for (const child of el.children) {
    observeSizeTarget(child);
  }

  // childList/subtree: content mount/unmount. Skip characterData (high noise; size covered by RO).
  const mo = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        observeSizeTarget(node);
      });
      mutation.removedNodes.forEach((node) => {
        if (!ro || !node || node.nodeType !== 1 || isOverlayChrome(node)) return;
        try {
          ro.unobserve(node);
        } catch {
          /* ignore */
        }
      });
    }
    scheduleSync();
  });
  mo.observe(el, { childList: true, subtree: true });

  syncNow();

  return () => {
    window.clearTimeout(hideTimer);
    scheduler.cancel();
    el.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", scheduleSync);
    thumb.removeEventListener("pointerdown", onPointerDown);
    unbindDragListeners();
    ro?.disconnect();
    mo.disconnect();
    rail.remove();
    delete el.dataset.overlayScroll;
    if (prevPosition === "static") el.style.position = "";
  };
}

export default function OverlayScrollbar() {
  useEffect(() => {
    const cleanups = new Map();

    const ensure = () => {
      for (const [el, cleanup] of [...cleanups.entries()]) {
        if (!el.isConnected) {
          cleanup?.();
          cleanups.delete(el);
        }
      }
      SELECTORS.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (cleanups.has(el)) return;
          cleanups.set(el, attachOverlay(el));
        });
      });
    };

    ensure();
    const id = window.setInterval(ensure, ENSURE_MS);
    return () => {
      window.clearInterval(id);
      cleanups.forEach((fn) => fn?.());
      cleanups.clear();
    };
  }, []);

  return null;
}

export { computeOverlayThumbLayout, createRafScheduler };

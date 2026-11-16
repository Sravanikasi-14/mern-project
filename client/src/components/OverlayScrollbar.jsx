import { useEffect } from "react";

/**
 * Custom ultra-thin overlay scrollbars for primary HRMS scrollports.
 * Hides native chrome (no content-size change) and paints a short dark thumb.
 */
const SELECTORS = [".app-main-content", ".sidebar-nav"];
const THUMB_MIN = 20;
const THUMB_MAX = 40;
const HIDE_MS = 1200;

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

  const show = () => {
    rail.classList.add("is-visible");
    window.clearTimeout(hideTimer);
    if (!dragging) {
      hideTimer = window.setTimeout(() => rail.classList.remove("is-visible"), HIDE_MS);
    }
  };

  const sync = () => {
    const { clientHeight, scrollHeight, scrollTop } = el;
    const overflow = scrollHeight > clientHeight + 1;
    rail.style.display = overflow ? "block" : "none";
    if (!overflow) return;

    const track = Math.max(clientHeight - 8, 1);
    const ratio = clientHeight / scrollHeight;
    const rawH = Math.round(track * ratio);
    const thumbH = Math.min(THUMB_MAX, Math.max(THUMB_MIN, rawH));
    const maxTop = Math.max(track - thumbH, 0);
    const top =
      scrollHeight === clientHeight
        ? 0
        : Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop);

    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top + 4}px)`;
  };

  const onScroll = () => {
    sync();
    show();
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    dragStartY = event.clientY;
    dragStartScroll = el.scrollTop;
    rail.classList.add("is-dragging");
    show();
    thumb.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    const { clientHeight, scrollHeight } = el;
    const track = Math.max(clientHeight - 8, 1);
    const ratio = clientHeight / scrollHeight;
    const thumbH = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(track * ratio)));
    const maxTop = Math.max(track - thumbH, 0);
    const delta = event.clientY - dragStartY;
    const scrollRange = Math.max(scrollHeight - clientHeight, 1);
    el.scrollTop = dragStartScroll + (delta / Math.max(maxTop, 1)) * scrollRange;
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove("is-dragging");
    thumb.releasePointerCapture?.(event.pointerId);
    show();
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", sync);
  thumb.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  const ro =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => sync()) : null;
  ro?.observe(el);
  // scrollHeight can grow without changing the element's border box
  const mo = new MutationObserver(() => sync());
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  const poll = window.setInterval(sync, 1200);
  sync();

  return () => {
    window.clearTimeout(hideTimer);
    window.clearInterval(poll);
    el.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", sync);
    thumb.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
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
      SELECTORS.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (cleanups.has(el)) return;
          cleanups.set(el, attachOverlay(el));
        });
      });
    };

    ensure();
    const id = window.setInterval(ensure, 1500);
    return () => {
      window.clearInterval(id);
      cleanups.forEach((fn) => fn?.());
      cleanups.clear();
    };
  }, []);

  return null;
}

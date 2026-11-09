import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import "./tumble-deck-showcase.css";

/*
 * Tumble Deck Showcase — exact reference pose math (fallAngle / deckAdvance /
 * cardPose). Two drive modes:
 * - "scroll": position is controlled by the parent (ScrollTrigger). No wheel
 *   hijack — page scroll stays native.
 * - "pointer": original local wheel/drag/keyboard scrub (clamped, not endless
 *   when maxPos is set).
 */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Euclidean modulo: card k of an endless deck shows image wrap(k, n). */
export const wrap = (k, n) => (n ? ((k % n) + n) % n : 0);

/**
 * Hinge angle (deg, CSS rotateX) of a card `t` of the way through its fall.
 * 0 stands upright, -90 lies flat towards the viewer.
 */
export function fallAngle(t) {
  const u = clamp01(t);
  const land = 0.78;
  if (u <= land) {
    const k = u / land;
    return -90 * k * k * k;
  }
  const k = (u - land) / (1 - land);
  return -90 + 6 * Math.sin(Math.PI * k) * (1 - k);
}

/** How far the deck has slid forward, in card gaps, at deck position `pos`. */
export function deckAdvance(pos) {
  const i = Math.floor(pos);
  const f = pos - i;
  const k = clamp01((f - 0.28) / 0.6);
  return i + k * k * (3 - 2 * k);
}

/**
 * Pose of virtual card `k` when the deck is at `pos`.
 */
export function cardPose(k, pos, depth) {
  const t = pos - k;
  const lift = (k - Math.floor(pos) + 3) * 0.6;
  if (t >= 1) {
    return { angle: -90, z: 0, lift, opacity: t < 3 ? 1 : 0, flat: true };
  }
  if (t > 0) return { angle: fallAngle(t), z: 0, lift, opacity: 1, flat: false };
  const rel = k - deckAdvance(pos);
  const opacity = clamp01(depth + 1 - rel);
  return { angle: 0, z: -Math.max(rel, 0), lift: 0, opacity, flat: false };
}

export default function TumbleDeckShowcase({
  cards,
  height = "100svh",
  aspect = 2.06,
  scrollPerCard = 240,
  depth = 5,
  background = "var(--lp-bg, #f7faf5)",
  className,
  style,
  ariaLabel = "How HRMS works showcase",
  /** "scroll" = parent drives position via `position`; no wheel capture. */
  drive = "pointer",
  /** Absolute deck position (card units). Used when drive="scroll". */
  position = 0,
}) {
  const rootRef = useRef(null);
  const sceneRef = useRef(null);
  const cardRefs = useRef([]);
  const imgRefs = useRef([]);
  const slotK = useRef([]);
  const state = useRef({ pos: 0 });
  const geo = useRef({ h: 200, gap: 44 });
  const n = cards.length;
  const pool = n ? depth + 5 : 0;
  const maxPos = n;
  const isScrollDrive = drive === "scroll";

  const paint = useCallback(() => {
    const { pos } = state.current;
    const { gap } = geo.current;
    const base = Math.floor(pos) - 2;
    cardRefs.current.forEach((el, j) => {
      const img = imgRefs.current[j];
      if (!el || !img || j >= pool) return;
      const k = base + wrap(j - base, pool);
      // Only the real journey cards. Negative indexes were already lying flat
      // on entry, and k >= n wrapped back to card 1 at the end of the pin.
      if (k < 0 || k >= n) {
        slotK.current[j] = k;
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        return;
      }
      if (slotK.current[j] !== k) {
        slotK.current[j] = k;
        const c = cards[k];
        img.src = c.src;
        img.alt = c.alt ?? "";
      }
      const p = cardPose(k, pos, depth);
      el.style.transform = `translate3d(0, ${-p.lift}px, ${p.z * gap}px) rotateX(${p.angle}deg)`;
      el.style.opacity = String(p.opacity);
      el.style.visibility = p.opacity > 0 ? "visible" : "hidden";
      const shade = p.flat ? 0.06 : (-p.angle / 90) * 0.06;
      el.style.setProperty("--td-shade", String(shade));
    });
  }, [depth, pool, cards, n]);

  useLayoutEffect(() => {
    slotK.current = [];
  }, [cards]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const scene = sceneRef.current;
    if (!root || !scene) return undefined;
    const fit = () => {
      const W0 = root.clientWidth;
      const H0 = root.clientHeight;
      if (W0 < 8 || H0 < 8) return;
      const wFrac = W0 < 640 ? 0.92 : 0.9;
      // Large front card, with clearance above the stacked cards and below the
      // hinge so the forward fall stays inside the showcase.
      const h = Math.max(180, Math.min((W0 * wFrac) / aspect, H0 * 0.6));
      const w = h * aspect;
      const top = Math.max(24, (H0 - h) * 0.26);
      geo.current = { h, gap: Math.max(24, h * 0.1) };
      scene.style.perspective = `${5.5 * h}px`;
      scene.style.perspectiveOrigin = `50% ${top - 1.25 * h}px`;
      root.style.setProperty("--td-w", `${w}px`);
      root.style.setProperty("--td-h", `${h}px`);
      root.style.setProperty("--td-top", `${top}px`);
      paint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, [aspect, paint]);

  // Scroll-driven: parent owns position; never intercept wheel.
  useLayoutEffect(() => {
    if (!isScrollDrive) return undefined;
    const next = Math.max(0, Math.min(maxPos, Number(position) || 0));
    state.current.pos = next;
    paint();
    return undefined;
  }, [isScrollDrive, position, maxPos, paint]);

  const api = useRef({ step: () => {} });
  const dragged = useRef(false);

  // Pointer-driven local scrub (mobile / fallback). Clamped to [0, n] so it
  // cannot trap the visitor in an endless loop.
  useEffect(() => {
    if (isScrollDrive) return undefined;
    const root = rootRef.current;
    if (!root || n === 0) return undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = state.current;
    let target = s.pos;
    let running = false;
    let idle;
    let acc = 0;

    const follow = () => {
      const dt = gsap.ticker.deltaRatio(60) / 60;
      s.pos += (target - s.pos) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - s.pos) < 2e-3) {
        s.pos = target;
        gsap.ticker.remove(follow);
        running = false;
      }
      paint();
    };

    const push = (to) => {
      // Clamp to the finite journey — never endless on the landing page.
      const capped = Math.max(0, Math.min(maxPos, to));
      // A hard fling still travels card by card instead of skipping the deck.
      target = Math.max(Math.round(s.pos) - 3, Math.min(Math.round(s.pos) + 3, capped));
      target = Math.max(0, Math.min(maxPos, target));
      if (reduce) {
        s.pos = target;
        paint();
      } else if (!running) {
        running = true;
        gsap.ticker.add(follow);
      }
    };

    const settle = (bias = 0) =>
      push(bias > 0 ? Math.floor(target + 0.7) : bias < 0 ? Math.ceil(target - 0.7) : Math.round(target));

    api.current.step = (dir) => push(Math.round(target) + dir);

    // Only capture wheel when the deck still has cards to show in that direction.
    // Otherwise let the page scroll continue (enter/leave the section).
    const onWheel = (e) => {
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * scale;
      const atStart = target <= 0.02 && d < 0;
      const atEnd = target >= maxPos - 0.02 && d > 0;
      if (atStart || atEnd) return; // release page scroll

      e.preventDefault();
      if (reduce) {
        acc += d;
        while (Math.abs(acc) >= scrollPerCard) {
          const dir = Math.sign(acc);
          acc -= dir * scrollPerCard;
          push(target + dir);
        }
        return;
      }
      push(target + d / scrollPerCard);
      clearTimeout(idle);
      idle = setTimeout(() => settle(Math.sign(d)), 140);
    };

    let drag = null;
    const onDown = (e) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, y: e.clientY, travel: 0, last: 0 };
      dragged.current = false;
      clearTimeout(idle);
    };
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = drag.y - e.clientY;
      drag.y = e.clientY;
      drag.travel += Math.abs(dy);
      if (dy) drag.last = Math.sign(dy);
      if (drag.travel > 6 && !dragged.current) {
        dragged.current = true;
        root.setPointerCapture(e.pointerId);
      }
      if (dragged.current && !reduce) push(target + dy / (geo.current.h * 1.1));
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (dragged.current) {
        if (reduce) push(Math.round(target) + (drag.last || 0));
        else settle(drag.last);
      }
      drag = null;
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    paint();

    return () => {
      clearTimeout(idle);
      gsap.ticker.remove(follow);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
    };
  }, [isScrollDrive, n, maxPos, scrollPerCard, paint]);

  const onKey = (e) => {
    if (isScrollDrive) return; // page scroll owns progression
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      api.current.step(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      api.current.step(-1);
    }
  };

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={isScrollDrive ? -1 : 0}
      onKeyDown={onKey}
      onClick={() => {
        if (isScrollDrive) return;
        if (!dragged.current) api.current.step(1);
      }}
      className={["td-root", isScrollDrive ? "td-root--scroll" : null, className].filter(Boolean).join(" ")}
      style={{ height, background, ...style }}
    >
      <div ref={sceneRef} className="td-scene">
        {Array.from({ length: pool }, (_, j) => (
          <div
            key={j}
            ref={(el) => {
              cardRefs.current[j] = el;
            }}
            className="td-card"
          >
            <img
              ref={(el) => {
                imgRefs.current[j] = el;
              }}
              alt=""
              width={720}
              height={Math.round(720 / aspect)}
              draggable={false}
              decoding="async"
            />
          </div>
        ))}
      </div>
      <span className="lp-sr-only" aria-live="polite">
        {n} journey steps. {isScrollDrive ? "Scroll the page to flip through them." : "Scroll, drag, click or press the arrow keys to flip through them."}
      </span>
    </div>
  );
}

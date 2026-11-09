import { useEffect, useId, useRef, useState } from "react";
import "./TiltedGridHero.css";

/* Adapted from supplied tilted-grid-hero (shadcn/TS/Tailwind) to React JSX + vanilla CSS.
 * Behaviour: one curved row of images orbits on a cylinder; tiles are sliced into facets. */

const SLICES = 16;
const CAMERA = 1.6;
const MAX_WIDTH = 55;

function arc(bend) {
  return (CAMERA - 1 + Math.cos(bend)) / (2 * CAMERA * Math.sin(bend));
}

function measure(width, height, tile, aspect, gap, bend) {
  const h = Math.min((tile / 100) * height, ((MAX_WIDTH / 100) * width) / aspect);
  const radius = width * arc(bend);
  if (!(h > 0) || !(radius > 0)) return { columns: 2, sweep: 0, unit: 0, limit: 0 };
  const deg = (rad) => (rad * 180) / Math.PI;
  const unit = deg(h / radius);
  const pitch = (aspect + gap / 100) * unit;
  const limit = deg(bend) + (aspect * unit) / 2;
  const columns = Math.min(60, Math.max(2, Math.ceil((2 * limit) / pitch)));
  const round = (n) => +n.toFixed(4);
  const sweep = round((columns * pitch) / 2);
  return {
    columns,
    sweep,
    unit: round(unit),
    limit: round(Math.min(sweep, limit)),
  };
}

export function TiltedGridHero({
  images = [],
  speed = 4,
  tileHeight = 26,
  aspectRatio = 16 / 9,
  gap = 6,
  axis = 56,
  curve = 80,
  fade = 12,
  children,
  className = "",
  style,
  ...props
}) {
  const ref = useRef(null);
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const orbit = `tgh-o-${rawId}`;
  const tileClass = `tgh-t-${rawId}`;
  const bend = (Math.min(85, Math.max(5, curve)) * Math.PI) / 180;

  const [layout, setLayout] = useState(null);
  const [shown, setShown] = useState({});

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = measure(width, height, tileHeight, aspectRatio, gap, bend);
      setLayout((prev) =>
        prev?.columns === next.columns && prev.sweep === next.sweep && prev.unit === next.unit
          ? prev
          : next
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tileHeight, aspectRatio, gap, bend]);

  useEffect(() => {
    for (const { src } of images) {
      const img = new Image();
      img.src = src;
    }
  }, [images]);

  const { columns, sweep, unit, limit } =
    layout ?? measure(1200, 560, tileHeight, aspectRatio, gap, bend);

  const u = (n) =>
    `calc(${(+n).toFixed(4)} * min(${tileHeight}cqh, ${(MAX_WIDTH / aspectRatio).toFixed(4)}cqw))`;

  const r = 100 * arc(bend);
  const radius = `${(+r).toFixed(3)}cqw`;
  const turn = (deg) =>
    `translateZ(${radius}) rotateY(${(+deg).toFixed(4)}deg) translateZ(-${radius})`;

  const hide = +(((sweep - limit) / (2 * sweep || 1)) * 100).toFixed(4);
  const css =
    `@keyframes ${orbit}{` +
    `from{transform:${turn(-sweep)}}to{transform:${turn(sweep)}}` +
    `0%,${hide}%,${100 - hide}%,100%{visibility:hidden}` +
    `${hide + 0.001}%,${100 - hide - 0.001}%{visibility:visible}}` +
    `@media(prefers-reduced-motion:reduce){.${tileClass}{animation-play-state:paused!important}}`;

  const duration = columns * speed;
  const mask = `linear-gradient(90deg,transparent,#000 ${fade}%,#000 ${100 - fade}%,transparent)`;
  const sliceSpan = (aspectRatio * unit) / SLICES;
  const safeLen = Math.max(images.length, 1);

  return (
    <div
      ref={ref}
      className={`tgh-root${className ? ` ${className}` : ""}`}
      style={{ containerType: "size", ...style }}
      {...props}
    >
      <style>{css}</style>

      <div
        aria-hidden="true"
        className="tgh-band"
        style={{
          opacity: layout ? 1 : 0,
          perspective: `${(+(r * CAMERA)).toFixed(3)}cqw`,
          perspectiveOrigin: `50% ${axis}%`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        {Array.from({ length: columns }, (_, t) => {
          const first = columns - 1 - t;
          const img = images[(shown[t] ?? first) % safeLen] || images[0];
          return (
            <div
              key={t}
              className={`tgh-tile ${tileClass}`}
              style={{
                left: `calc(50% - ${u(aspectRatio / 2)})`,
                top: `calc(${axis}% - ${u(0.5)})`,
                width: u(aspectRatio),
                height: u(1),
                transformStyle: "preserve-3d",
                animation: `${orbit} ${duration}s linear ${-t * speed}s infinite`,
              }}
              onAnimationIteration={() => {
                setShown((prev) => ({
                  ...prev,
                  [t]: ((prev[t] ?? first) + 1) % safeLen,
                }));
              }}
            >
              {Array.from({ length: SLICES }, (_, s) => {
                const da = (s + 0.5 - SLICES / 2) * sliceSpan;
                return (
                  <div
                    key={s}
                    className="tgh-slice"
                    style={{
                      left: `${(s / SLICES) * 100}%`,
                      width: `${100 / SLICES}%`,
                      // Local facet angle only — tile carries the cylinder orbit.
                      transform: `rotateY(${(+da).toFixed(4)}deg)`,
                    }}
                  >
                    <div
                      className="tgh-slice-img"
                      style={{
                        width: `${SLICES * 100}%`,
                        marginLeft: `${-s * 100}%`,
                        backgroundImage: img?.src ? `url(${img.src})` : "none",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {children ? <div className="tgh-content">{children}</div> : null}
    </div>
  );
}

export default TiltedGridHero;

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Leave-style pill sub-tabs with a sliding white selection indicator.
 * Drop-in for existing `module-tabs` / `module-tab` markup.
 */
export default function SegmentedTabs({
  tabs = [],
  value,
  onChange,
  ariaLabel = "Sections",
  className = "",
}) {
  const listRef = useRef(null);
  const btnRefs = useRef(new Map());
  const [indicator, setIndicator] = useState({ left: 4, width: 0, ready: false });

  const setBtnRef = (key) => (node) => {
    if (node) btnRefs.current.set(key, node);
    else btnRefs.current.delete(key);
  };

  const measure = () => {
    const list = listRef.current;
    const active = btnRefs.current.get(value);
    if (!list || !active) {
      setIndicator((prev) => ({ ...prev, width: 0, ready: false }));
      return;
    }
    // offsetLeft/Width stay correct when the tab strip scrolls horizontally;
    // getBoundingClientRect would place the pill relative to the viewport clip.
    setIndicator({
      left: active.offsetLeft,
      width: active.offsetWidth,
      ready: true,
    });
  };

  useLayoutEffect(() => {
    measure();
  }, [value, tabs]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const onScrollOrResize = () => measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScrollOrResize) : null;
    ro?.observe(list);
    list.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    // Remeasure after fonts/layout settle so the first paint lands correctly.
    const raf = window.requestAnimationFrame(onScrollOrResize);
    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      list.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [value, tabs]);

  return (
    <div
      ref={listRef}
      className={`module-tabs has-sliding-indicator ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        className={`module-tabs-indicator${indicator.ready ? " is-ready" : ""}`}
        style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        aria-hidden="true"
      />
      {tabs.map((tab) => {
        const key = tab.value;
        const active = value === key;
        return (
          <button
            key={key}
            ref={setBtnRef(key)}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab-value={key}
            className={`module-tab${active ? " is-active" : ""}`}
            disabled={Boolean(tab.disabled)}
            onClick={() => {
              if (!tab.disabled && typeof onChange === "function") onChange(key);
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge !== "" ? (
              <span className="module-tab-badge">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

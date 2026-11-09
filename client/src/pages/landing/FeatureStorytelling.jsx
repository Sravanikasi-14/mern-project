import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { FEATURE_STORIES } from "./featureStories";
import { StoryVisual } from "./FeatureStoryVisuals";

gsap.registerPlugin(ScrollTrigger);

/**
 * Per-feature scroll travel while pinned.
 * Each story owns an identical slice of the pin distance (this many viewport
 * heights). Index comes only from ScrollTrigger progress, so reversing scroll
 * walks back through the same slices.
 */
const SCROLL_VH_PER_FEATURE = 2.15;

/**
 * Scroll-pinned feature storytelling via GSAP ScrollTrigger.
 * Enter → pin once first story is fully in view → progress one story at a time → release.
 * Coordinates with How It Works via distinct ScrollTrigger ids (no shared controllers).
 */
export default function FeatureStorytelling() {
  const sectionRef = useRef(null);
  const triggerRef = useRef(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const count = FEATURE_STORIES.length;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    const mm = gsap.matchMedia();

    mm.add("(min-width: 981px)", () => {
      ScrollTrigger.getById("lp-features-pin")?.kill();

      const setIndex = (next) => {
        const clamped = Math.min(count - 1, Math.max(0, next));
        if (clamped === activeRef.current) return;
        activeRef.current = clamped;
        setActive(clamped);
      };

      const progressToIndex = (p) => {
        if (p >= 1) return count - 1;
        // Equal bands: [0,1/n), [1/n,2/n), … — last band holds through the end.
        return Math.min(count - 1, Math.max(0, Math.floor(p * count)));
      };

      const st = ScrollTrigger.create({
        id: "lp-features-pin",
        trigger: section,
        pin: true,
        pinSpacing: true,
        pinType: "fixed",
        start: "top top",
        // Identical pixel length per feature. Progress 0..1 maps onto those bands.
        end: () => `+=${Math.round(window.innerHeight * SCROLL_VH_PER_FEATURE) * count}`,
        anticipatePin: 0,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          // Equal bands from scroll progress only — no wheel counting, no direction flag.
          setIndex(progressToIndex(self.progress));
        },
        onRefresh: (self) => {
          setIndex(progressToIndex(self.progress));
        },
      });

      triggerRef.current = st;
      requestAnimationFrame(() => ScrollTrigger.refresh());

      return () => {
        st.kill();
        if (triggerRef.current === st) triggerRef.current = null;
      };
    });

    mm.add("(max-width: 980px)", () => {
      triggerRef.current = null;
      return undefined;
    });

    return () => {
      mm.revert();
      triggerRef.current = null;
    };
  }, [count]);

  const jumpTo = (index) => {
    const clamped = Math.min(count - 1, Math.max(0, index));
    const st = triggerRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (st) {
      // Jump scroll position first (instant) so onUpdate maps to the same index.
      // Smooth scroll would leave progress behind and snap the card back.
      const progress = Math.min(0.999, (clamped + 0.45) / count);
      const top = st.start + (st.end - st.start) * progress;
      window.scrollTo({ top, behavior: "auto" });
      ScrollTrigger.update();
      activeRef.current = clamped;
      setActive(clamped);
      return;
    }

    activeRef.current = clamped;
    setActive(clamped);
    sectionRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const story = FEATURE_STORIES[active] || FEATURE_STORIES[0];

  return (
    <section
      className="lp-features"
      id="features"
      aria-labelledby="features-title"
      ref={sectionRef}
      style={{ "--lp-story-count": count }}
    >
      <div className="lp-story-sticky">
        <div className="lp-features-shell">
          <div className="lp-section-head lp-story-head lp-reveal">
            <h2 id="features-title">What happens when people operations work as one?</h2>
            <p>
              One HRMS workspace for hiring, people data, attendance, payroll, work, and everyday
              employee self-service — so teams spend less time chasing updates and more time moving
              work forward.
            </p>
          </div>

          <div className="lp-story-layout">
            <nav className="lp-story-nav" aria-label="Feature stories">
              {FEATURE_STORIES.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`lp-story-nav-item${index === active ? " is-active" : ""}`}
                  aria-current={index === active ? "true" : undefined}
                  onClick={() => jumpTo(index)}
                >
                  {item.navTitle}
                </button>
              ))}
            </nav>

            <div className="lp-story-stage" aria-live="polite">
              <div key={story.id} className="lp-story-stage-inner">
                <h3>{story.panelTitle}</h3>
                <p>{story.panelBody}</p>
                <StoryVisual type={story.visual} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

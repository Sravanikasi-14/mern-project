import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { HOW_DECK_CARDS } from "./landingContent";
import TumbleDeckShowcase from "@/components/ui/tumble-deck-showcase";

gsap.registerPlugin(ScrollTrigger);

/**
 * Per-card scroll travel while How It Works is pinned.
 * Tuned so one ordinary scroll gesture drives a single tumble (not several):
 * ~1.85×vh ≈ 1.5k px at 800px height, with brief upright/land dwells inside
 * each band (see progressToDeckPos).
 */
const SCROLL_VH_PER_CARD = 1.85;

/** Fraction of each card's scroll band spent upright before the fall starts. */
const CARD_HOLD_UPRIGHT = 0.1;
/** Fraction of each card's scroll band spent landed before the next card. */
const CARD_HOLD_LANDED = 0.08;

/**
 * Map pin progress → deck position with predictable per-card intervals.
 * Within each unit: brief upright hold → full fallAngle arc → brief land hold.
 * Reverse scroll restores the same mapping.
 */
function progressToDeckPos(progress, n) {
  if (n <= 0) return 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return n;

  const raw = progress * n;
  const i = Math.min(n - 1, Math.floor(raw));
  const f = raw - i;
  const fallStart = CARD_HOLD_UPRIGHT;
  const fallEnd = 1 - CARD_HOLD_LANDED;

  if (f <= fallStart) return i;
  if (f >= fallEnd) return i + 1;
  return i + (f - fallStart) / (fallEnd - fallStart);
}

/**
 * How It Works — ScrollTrigger pins the section and maps page scroll onto the
 * Tumble Deck position (0 → N). Wheel is NOT hijacked; native scrolling drives
 * the fall animation and releases after the last card.
 */
export default function HowItWorks() {
  const sectionRef = useRef(null);
  const triggerRef = useRef(null);
  const [deckPos, setDeckPos] = useState(0);
  const cardCount = HOW_DECK_CARDS.length;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || cardCount === 0) return undefined;

    const mm = gsap.matchMedia();

    mm.add("(min-width: 981px)", () => {
      // Kill any stale how-it-works trigger before creating a new one.
      ScrollTrigger.getById("lp-how-pin")?.kill();

      const st = ScrollTrigger.create({
        id: "lp-how-pin",
        trigger: section,
        pin: true,
        pinSpacing: true,
        pinType: "fixed",
        start: "top top",
        // Identical pixel length per card. Deck position is a pure function of progress.
        end: () => `+=${Math.round(window.innerHeight * SCROLL_VH_PER_CARD) * cardCount}`,
        anticipatePin: 0,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          setDeckPos(progressToDeckPos(self.progress, cardCount));
        },
        onRefresh: (self) => {
          setDeckPos(progressToDeckPos(self.progress, cardCount));
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
      setDeckPos(0);
      return undefined;
    });

    return () => {
      mm.revert();
      triggerRef.current = null;
    };
  }, [cardCount]);

  return (
    <section className="lp-how" id="how-it-works" aria-labelledby="how-title" ref={sectionRef}>
      <div className="lp-how-pin">
        <div className="lp-section-head lp-reveal">
          <h2 id="how-title">How HRMS works</h2>
          <p>From organization setup to everyday operations — one connected company workspace.</p>
        </div>

        <div className="lp-how-showcase lp-reveal">
          <TumbleDeckShowcase
            className="lp-how-tumble"
            cards={HOW_DECK_CARDS}
            height="100%"
            aspect={2.06}
            depth={5}
            background="transparent"
            ariaLabel="HRMS journey card showcase"
            drive="scroll"
            position={deckPos}
          />
          <p className="lp-how-hint">Scroll to flip through each step of the journey.</p>
        </div>
      </div>
    </section>
  );
}

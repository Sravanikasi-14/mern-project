import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HERO_CHIPS, NAV_LINKS } from "./landing/landingContent";
import FeatureStorytelling from "./landing/FeatureStorytelling";
import HowItWorks from "./landing/HowItWorks";
import FaqSection from "./landing/FaqSection";
import { HeroCardStack } from "./landing/LandingMockups";
import "./LandingPage.css";

function useScrolled(threshold = 10) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const nodes = root.querySelectorAll(".lp-reveal");
    if (!nodes.length) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.01, rootMargin: "0px 0px -2% 0px" }
    );
    nodes.forEach((node) => observer.observe(node));
    requestAnimationFrame(() => {
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
          node.classList.add("is-visible");
          observer.unobserve(node);
        }
      });
    });
    return () => observer.disconnect();
  }, []);
  return ref;
}

function BrandMark() {
  return (
    <span className="lp-brand-mark" aria-hidden="true">
      <span className="lp-brand-orb dark" />
      <span className="lp-brand-orb light" />
    </span>
  );
}

function ChipIcon({ type }) {
  if (type === "pulse") {
    return <span className="lp-chip-icon is-pulse" aria-hidden="true" />;
  }
  if (type === "pay") {
    return <span className="lp-chip-icon is-pay" aria-hidden="true" />;
  }
  return <span className="lp-chip-icon is-people" aria-hidden="true" />;
}

export default function LandingPage() {
  const scrolled = useScrolled();
  const revealRoot = useReveal();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const previous = document.title;
    document.title = "HRMS — Connected people operations";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="lp-page" ref={revealRoot}>
      <div className="lp-wash" aria-hidden="true" />

      <header className={`lp-nav${scrolled ? " is-scrolled" : ""}`}>
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label="HRMS home" onClick={closeMenu}>
            <BrandMark />
            <span className="lp-brand-text">HRMS</span>
          </Link>

          <nav className="lp-nav-links" aria-label="Landing">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav-actions">
            <Link to="/login" className="lp-nav-login">
              Login
            </Link>
            <Link to="/login" className="lp-btn lp-btn-primary lp-nav-cta">
              Get started
            </Link>
          </div>

          <div className="lp-nav-mobile-actions">
            <Link to="/login" className="lp-btn lp-btn-primary lp-nav-mobile-cta" onClick={closeMenu}>
              Get started
            </Link>
            <button
              type="button"
              className="lp-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="lp-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="lp-sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          id="lp-mobile-menu"
          className={`lp-mobile-menu${menuOpen ? " is-open" : ""}`}
          hidden={!menuOpen}
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
          <Link to="/login" onClick={closeMenu}>
            Login
          </Link>
          <Link to="/login" className="lp-btn lp-btn-primary" onClick={closeMenu}>
            Get started
          </Link>
        </div>
      </header>

      <main>
        <section className="lp-hero" id="product">
          <div className="lp-hero-copy lp-reveal">
            <div className="lp-hero-chips">
              {HERO_CHIPS.map((chip, index) => (
                <span
                  key={chip.label}
                  className={`lp-chip lp-chip-${index + 1}`}
                  style={{ animationDelay: `${index * 0.35}s` }}
                >
                  <ChipIcon type={chip.icon} />
                  {chip.label}
                </span>
              ))}
            </div>

            <h1>
              Connected people
              <br />
              <span className="lp-highlight">operations</span>
            </h1>

            <p className="lp-hero-lead">
              HRMS brings people, attendance, leave, payroll, hiring, assets, work, and everyday
              employee experience into one company workspace — for Company Admin, HR Admin, and
              Employee.
            </p>

            <div className="lp-hero-actions">
              <Link to="/login" className="lp-btn lp-btn-primary">
                Get started
              </Link>
            </div>
          </div>

          <div className="lp-hero-visual lp-reveal" style={{ transitionDelay: "90ms" }}>
            <HeroCardStack />
          </div>
        </section>

        <FeatureStorytelling />

        <HowItWorks />

        <FaqSection />

        <section className="lp-final-cta" aria-labelledby="final-cta-title">
          <div className="lp-final-cta-inner lp-reveal">
            <h2 id="final-cta-title">Bring your people operations together</h2>
            <p>Sign in to continue with your company workspace.</p>
            <div className="lp-hero-actions">
              <Link to="/login" className="lp-btn lp-btn-primary">
                Get started
              </Link>
              <Link to="/login" className="lp-btn lp-btn-ghost">
                Login
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <Link to="/" className="lp-brand">
            <BrandMark />
            <span className="lp-brand-text">HRMS</span>
          </Link>
          <div className="lp-footer-links">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            <Link to="/login">Login</Link>
          </div>
          <p className="lp-footer-note">© {new Date().getFullYear()} HRMS. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

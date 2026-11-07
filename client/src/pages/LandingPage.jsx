import { Link } from "react-router-dom";
import "./LandingPage.css";

const FEATURES = [
  {
    title: "People directory",
    body: "Maintain employee records, departments, and workforce allocation in one organised place.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Attendance & leave",
    body: "Track punches, location-aware attendance, leave balances, and approval workflows.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    title: "Payroll & settlements",
    body: "Run payroll cycles, review payslips, and manage full-and-final settlements with confidence.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: "Work & impact",
    body: "Assign tasks, review deliverables, and recognise contribution with Impact Points.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15 8.5 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 9 8.5 12 2" />
      </svg>
    ),
  },
];

const BENEFITS = [
  {
    audience: "For HR teams",
    points: [
      "Centralised people, attendance, leave, and payroll operations",
      "Policy controls for leave, punch rules, and compliance documents",
      "Recruitment and onboarding connected to employee records",
    ],
  },
  {
    audience: "For employees",
    points: [
      "Clear self-service for attendance, leave, payslips, and tasks",
      "Transparent balances and recognition through Impact Points",
      "Secure access to personal profile and company policies",
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="lp-page">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label="Verdant HRMS home">
            <span className="lp-brand-mark" aria-hidden="true" />
            <span className="lp-brand-text">Verdant HRMS</span>
          </Link>
          <nav className="lp-nav-links" aria-label="Landing">
            <a href="#features">Features</a>
            <a href="#benefits">Benefits</a>
            <a href="#security">Security</a>
            <Link to="/login" className="lp-nav-login">
              Login
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Human resources, organised</p>
            <h1>Run your workforce with clarity from day one.</h1>
            <p className="lp-hero-lead">
              Verdant HRMS brings people, attendance, leave, payroll, and workplace policies together
              in a calm forest-green workspace built for HR teams and employees.
            </p>
            <div className="lp-hero-actions">
              <Link to="/login" className="btn-primary lp-cta">
                Continue
              </Link>
              <a href="#preview" className="btn-secondary">
                See product preview
              </a>
            </div>
          </div>
          <div className="lp-hero-visual" id="preview" aria-label="Product dashboard preview">
            <div className="lp-preview-shell">
              <div className="lp-preview-top">
                <span />
                <span />
                <span />
              </div>
              <div className="lp-preview-body">
                <aside className="lp-preview-rail" aria-hidden="true">
                  <div className="lp-preview-rail-item is-active" />
                  <div className="lp-preview-rail-item" />
                  <div className="lp-preview-rail-item" />
                  <div className="lp-preview-rail-item" />
                </aside>
                <div className="lp-preview-main">
                  <div className="lp-preview-kpi-row">
                    <div className="lp-preview-kpi" />
                    <div className="lp-preview-kpi" />
                    <div className="lp-preview-kpi" />
                  </div>
                  <div className="lp-preview-panel">
                    <div className="lp-preview-line" />
                    <div className="lp-preview-line short" />
                    <div className="lp-preview-bars">
                      <span style={{ height: "62%" }} />
                      <span style={{ height: "84%" }} />
                      <span style={{ height: "48%" }} />
                      <span style={{ height: "70%" }} />
                      <span style={{ height: "56%" }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-section-head">
            <h2>Everything HR needs in one product</h2>
            <p>Modern modules for the full employee lifecycle — without cluttered dashboards.</p>
          </div>
          <div className="lp-feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="lp-feature-card">
                <div className="lp-feature-icon" aria-hidden="true">
                  {feature.icon}
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-section-muted" id="benefits">
          <div className="lp-section-head">
            <h2>Built for HR teams and employees</h2>
            <p>Role-aware portals keep administration powerful and self-service simple.</p>
          </div>
          <div className="lp-benefit-grid">
            {BENEFITS.map((block) => (
              <article key={block.audience} className="lp-benefit-card">
                <h3>{block.audience}</h3>
                <ul>
                  {block.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section" id="security">
          <div className="lp-trust">
            <div>
              <h2>Security and trust by design</h2>
              <p>
                Company-isolated tenancy, role-based access, signed sessions, and secure document
                handling help protect sensitive people data while your teams stay productive.
              </p>
            </div>
            <ul className="lp-trust-list">
              <li>Role-based HR and employee portals</li>
              <li>Company-scoped authentication</li>
              <li>Protected payroll and personal records</li>
              <li>Policy-driven workplace controls</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="lp-footer" id="contact">
        <div className="lp-footer-inner">
          <div>
            <strong>Verdant HRMS</strong>
            <p>People operations for growing organisations.</p>
          </div>
          <div className="lp-footer-links">
            <Link to="/login">Sign in</Link>
            <a href="mailto:support@verdant-hrms.example">Contact support</a>
          </div>
          <p className="lp-footer-note">© {new Date().getFullYear()} Verdant HRMS. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

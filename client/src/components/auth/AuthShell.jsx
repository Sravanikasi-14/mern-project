import { Leaf } from "lucide-react";
import "./AuthShell.css";

/** Exact uploaded login illustration — do not substitute or recolor. */
const ILLUSTRATION_SRC = "/illustrations/hrms-login-illustration.png";

const PORTAL_META = {
  employee: {
    brandTitle: "HRMS",
    eyebrow: "Employee",
  },
  hr: {
    brandTitle: "HRMS",
    eyebrow: "HR / Company Admin",
  },
  platform: {
    brandTitle: "HRMS",
    eyebrow: "Platform Admin",
  },
};

/**
 * Minimal auth layout: logo + short heading + illustration | compact form.
 */
export default function AuthShell({
  portal = "employee",
  title = "Welcome back",
  children,
  footer = null,
  illustrationSrc = ILLUSTRATION_SRC,
}) {
  const meta = PORTAL_META[portal] || PORTAL_META.employee;

  return (
    <main className="hrms-auth" data-portal={portal}>
      <div className="hrms-auth-stage">
        <section className="hrms-auth-brand" aria-label="HRMS">
          <div className="hrms-auth-mark">
            <span className="hrms-auth-mark-badge" aria-hidden="true">
              <Leaf size={18} strokeWidth={2.25} />
            </span>
            <span>{meta.brandTitle}</span>
          </div>
          <h1>Work, connected.</h1>
          <div className="hrms-auth-illustration">
            <img
              src={illustrationSrc}
              alt="Illustrated professionals collaborating with speech bubbles, ladders, and connected workplace scenes"
              width={776}
              height={726}
              decoding="async"
              fetchPriority="high"
            />
          </div>
        </section>

        <section className="hrms-auth-form-pane" aria-label={title}>
          <div className="hrms-auth-eyebrow">{meta.eyebrow}</div>
          <h2>{title}</h2>
          {children}
          {footer}
        </section>
      </div>
    </main>
  );
}

export { ILLUSTRATION_SRC, PORTAL_META };

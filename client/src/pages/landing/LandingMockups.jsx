/** Illustrative product UI only — sample labels are not marketing claims. */

export function HeroCardStack() {
  return (
    <div className="lp-card-stage" aria-hidden="true">
      <div className="lp-orb" />
      <svg className="lp-doodle lp-doodle-a" viewBox="0 0 120 80" fill="none">
        <path
          d="M8 42c18-28 38-34 58-18 14 11 28 8 42-8"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="98" cy="18" r="10" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      <svg className="lp-doodle lp-doodle-b" viewBox="0 0 90 60" fill="none">
        <path
          d="M6 30c12 18 28 22 44 8 10-9 22-8 34 4"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      <div className="lp-stack-card lp-stack-back">
        <div className="lp-stack-chip">Employee</div>
        <strong>Self-service</strong>
        <em>Punch · Leave · Payslip</em>
        <div className="lp-stack-frost-rows">
          <span />
          <span />
          <span className="short" />
        </div>
      </div>

      <div className="lp-stack-card lp-stack-mid">
        <div className="lp-stack-mid-top">
          <span>Leave approval</span>
          <b>Pending</b>
        </div>
        <div className="lp-stack-person">
          <span className="lp-av">EV</span>
          <div>
            <strong>Elena Vance</strong>
            <em>Annual · 5 days</em>
          </div>
        </div>
        <div className="lp-stack-actions">
          <span>Reject</span>
          <span className="is-primary">Approve</span>
        </div>
      </div>

      <div className="lp-stack-card lp-stack-front">
        <div className="lp-stack-front-top">
          <span className="lp-stack-brand">A</span>
          <span>Acme Ops</span>
        </div>
        <div className="lp-stack-kpis">
          <div>
            <em>Workforce</em>
            <strong>248</strong>
          </div>
          <div>
            <em>On site</em>
            <strong>241</strong>
          </div>
        </div>
        <div className="lp-stack-bars">
          <i style={{ height: "70%" }} />
          <i style={{ height: "88%" }} />
          <i style={{ height: "76%" }} />
          <i style={{ height: "92%" }} />
        </div>
        <div className="lp-stack-front-foot">Live overview · illustrative</div>
      </div>
    </div>
  );
}

export function FeatureListCard({ title, rows }) {
  return (
    <article className="lp-feature-card" aria-hidden="true">
      <header>
        <h3>{title}</h3>
        <span>Today</span>
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.name}>
            <span className={`lp-av tiny tone-${row.tone}`}>
              {row.initials ||
                row.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
            </span>
            <div>
              <strong>{row.name}</strong>
              <em>{row.meta}</em>
            </div>
            <b className={`tone-${row.tone}`}>{row.amount}</b>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function FeatureProgressCard({ title, toggleLabel, bars }) {
  return (
    <article className="lp-feature-card lp-feature-progress" aria-hidden="true">
      <header>
        <h3>{title}</h3>
      </header>
      <div className="lp-ring-block">
        <div className="lp-ring" />
        <div className="lp-toggle-row">
          <span className="lp-check" />
          {toggleLabel}
        </div>
      </div>
      {bars.map((bar) => (
        <div key={bar.label} className="lp-bar-row">
          <div className="lp-bar-labels">
            <span>{bar.label}</span>
            <em>{bar.value}%</em>
          </div>
          <div className="lp-bar-track">
            <i style={{ width: `${bar.value}%` }} />
          </div>
        </div>
      ))}
    </article>
  );
}

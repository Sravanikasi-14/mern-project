/** Conceptual marketing visuals — not real HRMS application screenshots. */

export function StoryVisual({ type }) {
  switch (type) {
    case "hiring":
      return <HiringVisual />;
    case "truth":
      return <TruthVisual />;
    case "payroll":
      return <PayrollVisual />;
    case "attendance":
      return <AttendanceVisual />;
    case "work":
      return <WorkVisual />;
    case "experience":
      return <ExperienceVisual />;
    default:
      return null;
  }
}

function HiringVisual() {
  return (
    <div className="lp-sv lp-sv-hiring" aria-hidden="true">
      <div className="lp-sv-card lp-sv-journey">
        <header>Candidate journey</header>
        <ol>
          <li className="is-done">
            <span>1</span>
            Apply
          </li>
          <li className="is-done">
            <span>2</span>
            Interview
          </li>
          <li className="is-active">
            <span>3</span>
            Offer
          </li>
          <li>
            <span>4</span>
            Day one
          </li>
        </ol>
      </div>
      <div className="lp-sv-card lp-sv-offer">
        <em>Offer ready</em>
        <strong>Accept &amp; onboard</strong>
        <div className="lp-sv-pills">
          <i>Signed</i>
          <i className="is-accent">Credentials</i>
        </div>
      </div>
    </div>
  );
}

function TruthVisual() {
  return (
    <div className="lp-sv lp-sv-truth" aria-hidden="true">
      <div className="lp-sv-hub">
        <strong>Employee profile</strong>
        <span>One connected record</span>
      </div>
      <div className="lp-sv-orbit lp-sv-orbit-a">Department</div>
      <div className="lp-sv-orbit lp-sv-orbit-b">Designation</div>
      <div className="lp-sv-orbit lp-sv-orbit-c">Manager</div>
      <div className="lp-sv-orbit lp-sv-orbit-d">Team</div>
    </div>
  );
}

function PayrollVisual() {
  return (
    <div className="lp-sv lp-sv-payroll" aria-hidden="true">
      <div className="lp-sv-card lp-sv-pay-main">
        <header>
          <span>Payroll cycle</span>
          <b>Ready</b>
        </header>
        <ul>
          <li>
            <i /> Attendance synced <em>Done</em>
          </li>
          <li>
            <i /> Leave applied <em>Done</em>
          </li>
          <li>
            <i /> Components checked <em>Passed</em>
          </li>
          <li className="is-pending">
            <i /> Payslips <em>Publish</em>
          </li>
        </ul>
      </div>
      <div className="lp-sv-card lp-sv-pay-progress">
        <span>Run progress</span>
        <div className="lp-sv-bar">
          <i style={{ width: "86%" }} />
        </div>
        <em>6 of 7 steps complete</em>
      </div>
    </div>
  );
}

function AttendanceVisual() {
  return (
    <div className="lp-sv lp-sv-attendance" aria-hidden="true">
      <div className="lp-sv-card lp-sv-punch">
        <span className="lp-sv-dot" />
        <div>
          <strong>Check-in · 09:02</strong>
          <em>Status updates as people arrive</em>
        </div>
      </div>
      <div className="lp-sv-flow" aria-hidden="true">
        <span>Hours</span>
        <i />
        <span>Leave</span>
        <i />
        <span>Availability</span>
      </div>
      <div className="lp-sv-card lp-sv-status-grid">
        <div>
          <strong>Present</strong>
          <em>On the floor</em>
        </div>
        <div>
          <strong>On leave</strong>
          <em>Planned away</em>
        </div>
        <div>
          <strong>Review</strong>
          <em>Exceptions</em>
        </div>
      </div>
    </div>
  );
}

function WorkVisual() {
  return (
    <div className="lp-sv lp-sv-work" aria-hidden="true">
      <div className="lp-sv-lane is-todo">
        <span>Assigned</span>
        <p>Owner clear</p>
        <b />
        <b className="short" />
      </div>
      <div className="lp-sv-lane is-progress">
        <span>In progress</span>
        <p>Moving</p>
        <b />
        <b />
      </div>
      <div className="lp-sv-lane is-done">
        <span>Completed</span>
        <p>Done</p>
        <b />
        <div className="lp-sv-check" />
      </div>
    </div>
  );
}

function ExperienceVisual() {
  return (
    <div className="lp-sv lp-sv-experience" aria-hidden="true">
      <div className="lp-sv-card lp-sv-portal">
        <header>Employee essentials</header>
        <div className="lp-sv-actions">
          <span>Punch</span>
          <span>Leave</span>
          <span>Payslip</span>
          <span>Messages</span>
        </div>
      </div>
      <div className="lp-sv-card lp-sv-note">
        <em>Request sent</em>
        <strong>Leave · awaiting review</strong>
      </div>
    </div>
  );
}

import { formatDisplayDate, toDateOnlyString } from "../../utils/dateUtils";

/**
 * Deterministic personal leave insights from employee dashboard leave payload.
 * Never calls HR intelligence APIs.
 */
export default function PersonalLeaveInsights({ leave, holidays = [] }) {
  const detailed = Array.isArray(leave?.detailed) ? leave.detailed : [];
  const requests = leave?.recentRequests || leave?.requests || leave?.history || [];
  const scheduled = Array.isArray(leave?.scheduledRanges) ? leave.scheduledRanges : [];
  const config = leave?.config || {};
  const today = toDateOnlyString(new Date()) || "";

  const pending = requests.filter((r) => String(r.status).toUpperCase() === "PENDING");
  const upcoming = scheduled
    .filter((r) => {
      const status = String(r.status || "").toUpperCase();
      if (status !== "APPROVED" && status !== "PENDING") return false;
      const end = r.endDate || r.toDate || "";
      return end >= today;
    })
    .sort((a, b) =>
      String(a.startDate || a.fromDate || "").localeCompare(String(b.startDate || b.fromDate || ""))
    )
    .slice(0, 5);

  const history = [...requests]
    .filter((r) => String(r.status).toUpperCase() !== "PENDING")
    .slice(0, 5);

  const lowBalances = detailed.filter((t) => Number(t.available) <= 2 && Number(t.available) >= 0);
  const totalAvailable = detailed.reduce((sum, t) => sum + (Number(t.available) || 0), 0);

  const nextHoliday = (Array.isArray(holidays) ? holidays : [])
    .map((h) => ({
      name: h.name || h.title || "Holiday",
      date: toDateOnlyString(h.date || h.startDate) || "",
    }))
    .filter((h) => h.date && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const guidance = [];
  if (config.cutoffTime) {
    guidance.push(
      `Same-day leave should be submitted before ${config.cutoffTime}${
        config.timezone ? ` (${config.timezone})` : ""
      }.`
    );
  }
  if (config.earliestEligibleDate) {
    guidance.push(`Earliest eligible leave start date: ${config.earliestEligibleDate}.`);
  }
  if (config.noticePeriodDays != null) {
    guidance.push(`Company notice guidance: ${config.noticePeriodDays} day(s) where applicable.`);
  }
  if (config.error) {
    guidance.push(`Attendance configuration note: ${config.error}`);
  }
  if (!guidance.length) {
    guidance.push("Apply leave with clear dates and a reason. Overlapping pending or approved leave is blocked.");
  }

  const planning = [];
  if (pending.length) {
    planning.push(
      `You have ${pending.length} pending application${pending.length === 1 ? "" : "s"} awaiting HR review.`
    );
  }
  if (upcoming.length) {
    planning.push(
      `Next leave window starts ${formatDisplayDate(upcoming[0].startDate || upcoming[0].fromDate)} (${String(
        upcoming[0].status || ""
      ).toLowerCase()}).`
    );
  } else {
    planning.push("No upcoming leave windows on your schedule.");
  }
  if (lowBalances.length) {
    planning.push(
      `Low balance alert: ${lowBalances
        .map((t) => `${t.name || t.code} (${t.available} left)`)
        .join(", ")}.`
    );
  } else if (detailed.length) {
    planning.push(`Combined available balance across types: ${totalAvailable} day(s).`);
  }
  if (nextHoliday) {
    planning.push(`Next holiday on calendar: ${nextHoliday.name} (${formatDisplayDate(nextHoliday.date)}).`);
  }

  return (
    <section className="li-personal" aria-label="Personal leave insights">
      <header className="li-personal-head">
        <h2>Personal Leave Insights</h2>
        <p>Based on your balances, schedule, and company leave settings.</p>
      </header>

      <div className="li-personal-grid">
        <article className="li-insight-card">
          <h3>Balances</h3>
          {detailed.length ? (
            <ul>
              {detailed.map((t) => (
                <li key={t.code || t.name}>
                  <strong>{t.name || t.code}</strong>
                  <span>
                    {Number.isFinite(Number(t.available)) ? t.available : "—"} available
                    {Number.isFinite(Number(t.used)) ? ` · ${t.used} used` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="li-muted">Balance details are not available yet.</p>
          )}
        </article>

        <article className="li-insight-card">
          <h3>Upcoming</h3>
          {upcoming.length ? (
            <ul>
              {upcoming.map((r, idx) => (
                <li key={`${r.startDate}-${r.endDate}-${idx}`}>
                  <strong>{r.leaveType || r.leaveTypeCode || "Leave"}</strong>
                  <span>
                    {formatDisplayDate(r.startDate || r.fromDate)} –{" "}
                    {formatDisplayDate(r.endDate || r.toDate)} · {String(r.status || "").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="li-muted">No upcoming leave scheduled.</p>
          )}
        </article>

        <article className="li-insight-card">
          <h3>Pending applications</h3>
          {pending.length ? (
            <ul>
              {pending.slice(0, 5).map((r) => (
                <li key={r._id}>
                  <strong>{r.leaveTypeCode || r.leaveType || "Leave"}</strong>
                  <span>
                    {formatDisplayDate(r.startDate || r.fromDate)} –{" "}
                    {formatDisplayDate(r.endDate || r.toDate)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="li-muted">No pending applications.</p>
          )}
        </article>

        <article className="li-insight-card">
          <h3>Recent history</h3>
          {history.length ? (
            <ul>
              {history.map((r) => (
                <li key={r._id}>
                  <strong>{r.leaveTypeCode || r.leaveType || "Leave"}</strong>
                  <span>
                    {String(r.status || "").toLowerCase()} ·{" "}
                    {formatDisplayDate(r.startDate || r.fromDate)} –{" "}
                    {formatDisplayDate(r.endDate || r.toDate)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="li-muted">No decided leave history yet.</p>
          )}
        </article>
      </div>

      <article className="li-insight-card li-insight-card--wide">
        <h3>Policy &amp; eligibility guidance</h3>
        <ul className="li-steps">
          {guidance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>

      <article className="li-insight-card li-insight-card--wide">
        <h3>Planning insights</h3>
        <ul className="li-steps">
          {planning.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}

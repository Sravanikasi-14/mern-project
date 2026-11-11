/**
 * Subsection anchors for each HR policy workspace card.
 * Labels drive the sticky horizontal subnav; ids must match element ids in AdminPolicies.
 */
export const POLICY_SUBSECTIONS = {
  attendance_leave: [
    { id: "pol-shift-timings", label: "Shift Timings" },
    { id: "pol-work-hours", label: "Work Hours" },
    { id: "pol-leave-types", label: "Leave Types" },
    { id: "pol-leave-accrual", label: "Leave Accrual" },
    { id: "pol-holidays", label: "Holidays" },
    { id: "pol-weekends", label: "Weekends" },
    { id: "pol-geofence", label: "Location / Geofence" },
    { id: "pol-wfh-hybrid", label: "WFH & Hybrid" },
  ],
  payroll_compensation: [
    { id: "pol-payroll-general", label: "Pay Cycle" },
    { id: "pol-salary-components", label: "Salary Components" },
    { id: "pol-tax-statutory", label: "Tax & Statutory" },
  ],
  employment_recruitment: [
    { id: "pol-lifecycle", label: "Lifecycle & Notice" },
    { id: "pol-recruitment", label: "Recruitment & Offers" },
  ],
  workplace_compliance: [
    { id: "pol-documents", label: "Documents & Compliance" },
  ],
  company_conduct: [
    { id: "pol-company-ops", label: "Company Operations" },
    { id: "pol-impact-points", label: "Impact Points" },
  ],
  revision_history: [
    { id: "pol-revisions", label: "Revision History" },
  ],
};

/**
 * Sticky offset for scroll-spy / programmatic scroll (sticky subnav height in .app-main-content).
 * Prefer measuring `.policies-subnav` at runtime; this is the fallback.
 */
export const POLICY_SUBNAV_STICKY_OFFSET_PX = 64;

/**
 * Deduplicate and drop empty ids/labels for safe subsection navigation.
 * Unknown policy ids return an empty list (no subnav).
 */
export function getPolicySubsections(policyId) {
  const raw = POLICY_SUBSECTIONS[policyId] || [];
  const seen = new Set();
  const out = [];
  for (const section of raw) {
    const id = typeof section?.id === "string" ? section.id.trim() : "";
    const label = typeof section?.label === "string" ? section.label.trim() : "";
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

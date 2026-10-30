/**
 * Standardized Semantic Status Badge Component for HRMS
 *
 * Implements subtle semantic color-coding:
 * - Active / Approved / Accepted / Present / Verified: soft green (#f0fdf4 / #15803d)
 * - Inactive / Rejected / Declined / Suspended / Delivery Failed: soft red (#fef2f2 / #b91c1c)
 * - Invite Pending / Pending Approval / Awaiting Action: soft amber (#fef3c7 / #b45309)
 * - Sent / Issued: soft blue (#eff6ff / #1d4ed8)
 * - Neutral / Draft / Closed / Other: subtle gray (#f4f4f5 / #52525b)
 */

export function getStatusCategory(statusRaw) {
  if (!statusRaw) return "neutral";
  const s = String(statusRaw).toUpperCase().replace(/[\s-]+/g, "_");

  // Success / Positive
  if (
    s === "ACTIVE" ||
    s === "APPROVED" ||
    s === "ACCEPTED" ||
    s === "PRESENT" ||
    s === "VERIFIED" ||
    s === "PAID" ||
    s === "COMPLETED" ||
    s === "ON_FILE" ||
    s === "CONFIRMED" ||
    s === "AVAILABLE" ||
    s === "ACKNOWLEDGED"
  ) {
    return "success";
  }

  // Danger / Negative
  if (
    s === "INACTIVE" ||
    s === "REJECTED" ||
    s === "DECLINED" ||
    s === "SUSPENDED" ||
    s === "DELIVERY_FAILED" ||
    s === "FAILED" ||
    s === "CANCELLED" ||
    s === "ABSENT" ||
    s === "TERMINATED" ||
    s === "LOST"
  ) {
    return "danger";
  }

  // Warning / Pending
  if (
    s === "INVITE_PENDING" ||
    s === "PENDING" ||
    s === "PENDING_APPROVAL" ||
    s === "AWAITING" ||
    s === "AWAITING_ACTION" ||
    s === "HALF_DAY" ||
    s === "LATE" ||
    s === "ON_LEAVE" ||
    s === "UNDER_MAINTENANCE" ||
    s === "UNPAID" ||
    s === "PARTIAL" ||
    s === "CHANGES_REQUESTED"
  ) {
    return "warning";
  }

  // Info
  if (s === "SENT" || s === "ISSUED" || s === "PROCESSING" || s === "ASSIGNED" || s === "IN_PROGRESS" || s === "FINALIZED" || s === "SUBMITTED") {
    return "info";
  }

  // Neutral
  return "neutral";
}

export function formatStatusLabel(statusRaw, customLabel) {
  if (customLabel) return customLabel;
  if (!statusRaw) return "—";

  const s = String(statusRaw).trim();
  const upper = s.toUpperCase().replace(/[\s-]+/g, "_");

  const map = {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    PENDING: "Pending",
    PENDING_APPROVAL: "Pending Approval",
    INVITE_PENDING: "Invite Pending",
    DELIVERY_FAILED: "Delivery Failed",
    NOT_CHECKED_IN: "Not Checked In",
    CHECKED_IN: "Checked In",
    CHECKED_OUT: "Checked Out",
    ON_LEAVE: "On Leave",
    HALF_DAY: "Half Day",
    PRESENT: "Present",
    ABSENT: "Absent",
    LATE: "Late",
    AVAILABLE: "Available",
    ASSIGNED: "Assigned",
    IN_PROGRESS: "In Progress",
    UNDER_MAINTENANCE: "Maintenance",
    RETIRED: "Retired",
    LOST: "Lost",
    ACKNOWLEDGED: "Confirmed",
    DRAFT: "Draft",
    FINALIZED: "Prepared",
    PAID: "Paid",
    UNPAID: "Payment Pending",
    PARTIAL: "Partially Paid",
    SENT: "Sent",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    CHANGES_REQUESTED: "Updates Requested",
    SUBMITTED: "Under Review",
    VERIFIED: "Verified",
    COMPLETED: "Completed",
  };

  if (map[upper]) return map[upper];
  return s;
}

export default function StatusBadge({
  status,
  label,
  withDot = true,
  className = "",
  style = {},
}) {
  const category = getStatusCategory(status);
  const displayLabel = formatStatusLabel(status, label);

  const badgeClass = `badge badge-${category} ${className}`.trim();

  return (
    <span className={badgeClass} style={style}>
      {withDot && <span className="status-dot" aria-hidden="true" />}
      <span>{displayLabel}</span>
    </span>
  );
}

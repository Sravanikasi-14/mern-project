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
    s === "CONFIRMED"
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
    s === "TERMINATED"
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
    s === "ON_LEAVE"
  ) {
    return "warning";
  }

  // Info
  if (s === "SENT" || s === "ISSUED" || s === "PROCESSING") {
    return "info";
  }

  // Neutral
  return "neutral";
}

export function formatStatusLabel(statusRaw, customLabel) {
  if (customLabel) return customLabel;
  if (!statusRaw) return "—";

  const s = String(statusRaw).trim();
  if (s.toUpperCase() === "INVITE_PENDING") return "Invite Pending";
  if (s.toUpperCase() === "DELIVERY_FAILED") return "Delivery Failed";
  if (s.toUpperCase() === "PENDING_APPROVAL") return "Pending Approval";
  if (s.toUpperCase() === "NOT_CHECKED_IN") return "Not Checked In";
  if (s.toUpperCase() === "CHECKED_IN") return "Checked In";
  if (s.toUpperCase() === "CHECKED_OUT") return "Checked Out";

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

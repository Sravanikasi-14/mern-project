import "./review.css";

const TONE_MAP = {
  PENDING: "pending",
  PENDING_REVIEW: "pending",
  SUBMITTED: "pending",
  UNDER_REVIEW: "pending",
  IN_PROGRESS: "progress",
  RESUBMITTED: "progress",
  CHANGES_REQUESTED: "changes",
  CORRECTION_REQUESTED: "changes",
  APPROVED: "approved",
  ACCEPTED: "approved",
  COMPLETED: "approved",
  REJECTED: "rejected",
  DECLINED: "rejected",
  NOT_SUBMITTED: "neutral",
  DRAFT: "neutral",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
};

/**
 * Shared status chip for review workspaces.
 * tone can be passed explicitly, or derived from status.
 */
export default function ReviewStatusBadge({ status = "", label, tone, className = "" }) {
  const key = String(status || "").toUpperCase();
  const resolvedTone = tone || TONE_MAP[key] || "neutral";
  const text = label || key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`review-status review-status--${resolvedTone} ${className}`.trim()}>
      {text}
    </span>
  );
}

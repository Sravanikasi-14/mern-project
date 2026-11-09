import ReviewStatusBadge from "./review/ReviewStatusBadge";
import ReviewDecisionBar from "./review/ReviewDecisionBar";

export const SECTION_LABELS = {
  personalDetails: "Personal Details",
  residentialAddress: "Residential Address",
  emergencyContact: "Emergency Contact",
  bankAndTax: "Bank & Tax Information",
  documents: "Documents",
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS);

export const SECTION_STATUS_BADGES = {
  NOT_SUBMITTED: { label: "Not submitted", tone: "neutral", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  PENDING_REVIEW: { label: "Pending review", tone: "pending", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  RESUBMITTED: { label: "Resubmitted", tone: "progress", bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
  APPROVED: { label: "Approved", tone: "approved", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  CORRECTION_REQUESTED: { label: "Correction requested", tone: "changes", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  REJECTED: { label: "Rejected", tone: "rejected", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
};

/** Overall onboarding statuses that mean HR has given final approval (account setup stage). */
export const FINAL_APPROVED_STATUSES = [
  "APPROVED",
  "ACCOUNT_SETUP_SENT",
  "ACCOUNT_SETUP_PENDING",
  "ACTIVATED",
];

export function allSectionsApproved(sectionReviews) {
  if (!sectionReviews) return false;
  return SECTION_KEYS.every((key) => sectionReviews[key]?.status === "APPROVED");
}

/**
 * Per-section review header: status badge and Approve / Request correction / Reject.
 * Actions only while the section is under HR review (and onboarding is not frozen).
 */
export default function OnboardingSectionReviewBar({ section, review, canReview, busy, onDecision }) {
  const status = review?.status || "NOT_SUBMITTED";
  const badge = SECTION_STATUS_BADGES[status] || SECTION_STATUS_BADGES.NOT_SUBMITTED;
  const reviewable = canReview && ["PENDING_REVIEW", "RESUBMITTED", "APPROVED"].includes(status);
  const showNote = review?.note && ["CORRECTION_REQUESTED", "REJECTED", "RESUBMITTED"].includes(status);

  const actions = [];
  if (reviewable) {
    if (status !== "APPROVED") {
      actions.push({
        key: "approve",
        label: "Approve",
        variant: "approve",
        disabled: busy,
        onClick: () => onDecision(section, "APPROVE"),
      });
    }
    actions.push({
      key: "changes",
      label: "Request correction",
      variant: "changes",
      disabled: busy,
      onClick: () => onDecision(section, "REQUEST_CORRECTION"),
    });
    actions.push({
      key: "reject",
      label: "Reject",
      variant: "reject",
      disabled: busy,
      onClick: () => onDecision(section, "REJECT"),
    });
  }

  return (
    <div className="review-section" style={{ marginBottom: 10, padding: "10px 12px" }} data-section-review={section}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <ReviewStatusBadge status={status} label={badge.label} tone={badge.tone} />
        {actions.length ? (
          <div style={{ marginLeft: "auto" }}>
            <ReviewDecisionBar actions={actions} />
          </div>
        ) : null}
      </div>
      {showNote ? <p className="review-note">{review.note}</p> : null}
    </div>
  );
}

export const SECTION_LABELS = {
  personalDetails: "Personal Details",
  residentialAddress: "Residential Address",
  emergencyContact: "Emergency Contact",
  bankAndTax: "Bank & Tax Information",
  documents: "Documents",
};

export const SECTION_KEYS = Object.keys(SECTION_LABELS);

export const SECTION_STATUS_BADGES = {
  NOT_SUBMITTED: { label: "Not submitted", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  PENDING_REVIEW: { label: "Pending review", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  RESUBMITTED: { label: "Resubmitted", bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
  APPROVED: { label: "Approved", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  CORRECTION_REQUESTED: { label: "Correction requested", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  REJECTED: { label: "Rejected", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
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

const baseBtn = {
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  background: "#ffffff",
};

/**
 * Per-section review header: status badge, HR/candidate note and Approve / Request correction / Reject actions.
 * Actions are only offered while the section is under HR review (and onboarding is not frozen).
 */
export default function OnboardingSectionReviewBar({ section, review, canReview, busy, onDecision }) {
  const status = review?.status || "NOT_SUBMITTED";
  const badge = SECTION_STATUS_BADGES[status] || SECTION_STATUS_BADGES.NOT_SUBMITTED;
  const reviewable = canReview && ["PENDING_REVIEW", "RESUBMITTED", "APPROVED"].includes(status);
  const showNote = review?.note && ["CORRECTION_REQUESTED", "REJECTED", "RESUBMITTED"].includes(status);

  return (
    <div style={{ marginBottom: 10 }} data-section-review={section}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 700,
            background: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.border}`,
          }}
        >
          {badge.label}
        </span>
        {reviewable && (
          <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
            {status !== "APPROVED" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecision(section, "APPROVE")}
                style={{ ...baseBtn, color: "#047857", border: "1px solid #a7f3d0" }}
              >
                Approve
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision(section, "REQUEST_CORRECTION")}
              style={{ ...baseBtn, color: "#b45309", border: "1px solid #fde68a" }}
            >
              Request correction
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision(section, "REJECT")}
              style={{ ...baseBtn, color: "#b91c1c", border: "1px solid #fecaca" }}
            >
              Reject
            </button>
          </span>
        )}
      </div>
      {showNote && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            background: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.border}`,
          }}
        >
          <strong>HR note:</strong> {review.note}
        </div>
      )}
    </div>
  );
}

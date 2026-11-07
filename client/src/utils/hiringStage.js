/** Shared constants + helpers for the unified Hiring & Onboarding workspace. */

export const HIRING_STAGE_CHIPS = [
  { key: "ALL", label: "All", summaryKey: "all" },
  { key: "OFFERS", label: "Offers", summaryKey: "offers" },
  { key: "ONBOARDING", label: "Onboarding", summaryKey: "onboarding" },
  { key: "HR_REVIEW", label: "HR Review", summaryKey: "hrReview" },
  { key: "CORRECTIONS", label: "Corrections", summaryKey: "corrections" },
  { key: "ACCOUNT_SETUP", label: "Account Setup", summaryKey: "accountSetup" },
  { key: "COMPLETED", label: "Completed", summaryKey: "completed" },
];

export const HIRING_STAGE_LABELS = {
  ALL: "All",
  OFFERS: "Offer",
  ONBOARDING: "Onboarding",
  HR_REVIEW: "HR Review",
  CORRECTIONS: "Corrections",
  ACCOUNT_SETUP: "Account Setup",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

const VALID_STAGES = new Set(Object.keys(HIRING_STAGE_LABELS));

/** Legacy `?status=` (offer or onboarding status) -> unified stage filter. */
const LEGACY_STATUS_TO_STAGE = {
  DRAFT: "OFFERS",
  SENT: "OFFERS",
  REJECTED: "OFFERS",
  WITHDRAWN: "WITHDRAWN",
  ACCEPTED: "ONBOARDING",
  PENDING: "ONBOARDING",
  IN_PROGRESS: "ONBOARDING",
  SUBMITTED: "HR_REVIEW",
  PROCESSING_APPROVAL: "HR_REVIEW",
  CHANGES_REQUESTED: "CORRECTIONS",
  APPROVED: "ACCOUNT_SETUP",
  ACCOUNT_SETUP_SENT: "ACCOUNT_SETUP",
  ACCOUNT_SETUP_PENDING: "ACCOUNT_SETUP",
  ACTIVATED: "COMPLETED",
};

export function normalizeStageParam(value) {
  const key = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return VALID_STAGES.has(key) ? key : "";
}

export function stageFromLegacyStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return LEGACY_STATUS_TO_STAGE[key] || "";
}

/**
 * Build the `/admin/hiring` URL for a legacy `/admin/offers` or `/admin/onboarding` URL,
 * preserving `offerId`, `search` and mapping `status` to the unified `stage` filter.
 * `context` is "offers" | "onboarding": REJECTED means a declined offer vs. rejected onboarding.
 */
export function buildHiringRedirect(search, context) {
  const source = new URLSearchParams(search || "");
  const next = new URLSearchParams();

  const stage =
    normalizeStageParam(source.get("stage")) ||
    (context === "onboarding" && String(source.get("status") || "").toUpperCase() === "REJECTED"
      ? "ALL"
      : stageFromLegacyStatus(source.get("status")));
  if (stage && stage !== "ALL") next.set("stage", stage);

  const offerId = (source.get("offerId") || "").trim();
  if (offerId) next.set("offerId", offerId);

  const q = (source.get("search") || "").trim();
  if (q) next.set("search", q);

  // Deep links open the modal on the matching tab (old Onboard button -> Onboarding tab).
  const tab = (source.get("tab") || "").trim() || (offerId ? (context === "onboarding" ? "onboarding" : "offer") : "");
  if (tab) next.set("tab", tab);

  const qs = next.toString();
  return `/admin/hiring${qs ? `?${qs}` : ""}`;
}

export const OFFER_STATUS_BADGES = {
  DRAFT: { label: "Draft", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  SENT: { label: "Sent", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  ACCEPTED: { label: "Signed", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  REJECTED: { label: "Declined", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  WITHDRAWN: { label: "Withdrawn", bg: "#f4f4f5", color: "#71717a", border: "#e4e4e7" },
};

export const ONBOARDING_STATUS_BADGES = {
  PENDING: { label: "Not started", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  IN_PROGRESS: { label: "In progress", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  DRAFT: { label: "Draft in progress", bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" },
  SUBMITTED: { label: "Under review", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  CHANGES_REQUESTED: { label: "Updates requested", bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  PROCESSING_APPROVAL: { label: "Processing approval", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  APPROVED: { label: "Approved", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  ACCOUNT_SETUP_SENT: { label: "Invite sent", bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  ACCOUNT_SETUP_PENDING: { label: "Invite not delivered", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  ACTIVATED: { label: "Activated", bg: "#ecfeff", color: "#0e7490", border: "#a5f3fc" },
  REJECTED: { label: "Rejected", bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
};

export const STAGE_BADGES = {
  OFFERS: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  ONBOARDING: { bg: "#f4f4f5", color: "#3f3f46", border: "#e4e4e7" },
  HR_REVIEW: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  CORRECTIONS: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  ACCOUNT_SETUP: { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  COMPLETED: { bg: "#ecfeff", color: "#0e7490", border: "#a5f3fc" },
  REJECTED: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  WITHDRAWN: { bg: "#f4f4f5", color: "#71717a", border: "#e4e4e7" },
};

/** The modal tab that best fits a row's stage (used by the primary row action). */
export function defaultTabForStage(stage) {
  switch (stage) {
    case "OFFERS":
    case "WITHDRAWN":
      return "offer";
    case "ONBOARDING":
    case "HR_REVIEW":
    case "CORRECTIONS":
    case "REJECTED":
      return "onboarding";
    case "ACCOUNT_SETUP":
      return "account";
    case "COMPLETED":
      return "overview";
    default:
      return "overview";
  }
}

/** Primary row action label + target tab, based on the light row (no heavy data needed). */
export function primaryActionForRow(row) {
  switch (row.stage) {
    case "OFFERS":
      if (row.offerStatus === "DRAFT") return { label: "Send offer", tab: "offer" };
      if (row.offerStatus === "SENT") return { label: "Resend / preview", tab: "offer" };
      return { label: "View offer", tab: "offer" };
    case "WITHDRAWN":
      return { label: "View offer", tab: "offer" };
    case "ONBOARDING":
      return { label: "View progress", tab: "onboarding" };
    case "HR_REVIEW":
      return { label: "Review onboarding", tab: "onboarding" };
    case "CORRECTIONS":
      return { label: "View corrections", tab: "onboarding" };
    case "ACCOUNT_SETUP":
      return { label: "Account setup", tab: "account" };
    case "COMPLETED":
      return { label: "View", tab: "overview" };
    default:
      return { label: "Open", tab: "overview" };
  }
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN");
}

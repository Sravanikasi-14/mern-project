/** Shared constants + helpers for the unified Hiring & Onboarding workspace (mobile). */

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
  return LEGACY_STATUS_TO_STAGE[String(status || "").trim().toUpperCase()] || "";
}

/** `/admin/offers` or `/admin/onboarding` URL -> `/admin/hiring` URL (offerId preserved, status -> stage). */
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

  const tab = (source.get("tab") || "").trim() || (offerId ? (context === "onboarding" ? "onboarding" : "offer") : "");
  if (tab) next.set("tab", tab);

  const qs = next.toString();
  return `/admin/hiring${qs ? `?${qs}` : ""}`;
}

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
    default:
      return "overview";
  }
}

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
    default:
      return { label: "View", tab: "overview" };
  }
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN");
}

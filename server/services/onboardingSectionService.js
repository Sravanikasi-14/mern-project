import { HttpError } from "../utils/httpError.js";
import {
  ONBOARDING_FROZEN_STATUSES,
  ONBOARDING_SECTION_KEYS,
  ONBOARDING_STATUSES,
  SECTION_REVIEW_STATUSES,
} from "../models/User.js";

export const SECTION_KEY_LIST = Object.freeze(Object.values(ONBOARDING_SECTION_KEYS));

export const SECTION_LABELS = Object.freeze({
  personalDetails: "Personal details",
  residentialAddress: "Residential address",
  emergencyContact: "Emergency contact",
  bankAndTax: "Bank & tax details",
  documents: "Documents",
});

export const SECTION_DECISIONS = Object.freeze({
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  REQUEST_CORRECTION: "REQUEST_CORRECTION",
});

/** Maps request-body / data keys to the review section that owns them. */
const PAYLOAD_KEY_TO_SECTION = Object.freeze({
  personalDetails: ONBOARDING_SECTION_KEYS.PERSONAL_DETAILS,
  residentialAddress: ONBOARDING_SECTION_KEYS.RESIDENTIAL_ADDRESS,
  emergencyContact: ONBOARDING_SECTION_KEYS.EMERGENCY_CONTACT,
  bankDetails: ONBOARDING_SECTION_KEYS.BANK_AND_TAX,
  taxDetails: ONBOARDING_SECTION_KEYS.BANK_AND_TAX,
  identityDetails: ONBOARDING_SECTION_KEYS.BANK_AND_TAX,
  documents: ONBOARDING_SECTION_KEYS.DOCUMENTS,
});

const NEEDS_CANDIDATE_ACTION = new Set([
  SECTION_REVIEW_STATUSES.REJECTED,
  SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED,
]);

const REVIEWABLE_STATUSES = new Set([
  SECTION_REVIEW_STATUSES.PENDING_REVIEW,
  SECTION_REVIEW_STATUSES.RESUBMITTED,
  SECTION_REVIEW_STATUSES.APPROVED,
  SECTION_REVIEW_STATUSES.REJECTED,
  SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED,
]);

export function defaultSectionReviews() {
  const reviews = {};
  for (const key of SECTION_KEY_LIST) {
    reviews[key] = {
      status: SECTION_REVIEW_STATUSES.NOT_SUBMITTED,
      note: "",
      reviewedAt: null,
      reviewedBy: null,
      revision: 0,
    };
  }
  return reviews;
}

function plain(value) {
  if (value && typeof value.toObject === "function") {
    return value.toObject();
  }
  return value;
}

function hasSubmittedStatus(onboarding) {
  return onboarding?.status === ONBOARDING_STATUSES.SUBMITTED;
}

/**
 * Legacy records submitted before section-wise review existed have every section NOT_SUBMITTED
 * while overall status is SUBMITTED. Treat them as PENDING_REVIEW.
 */
function isLegacySubmitted(onboarding) {
  if (!hasSubmittedStatus(onboarding)) return false;
  const reviews = onboarding.sectionReviews || {};
  return SECTION_KEY_LIST.every(
    (key) => !reviews[key] || reviews[key].status === SECTION_REVIEW_STATUSES.NOT_SUBMITTED
  );
}

/** Persistable backfill for legacy submitted records (mutates a mongoose doc). */
export function backfillLegacySectionReviews(onboarding) {
  if (!onboarding) return false;
  if (!onboarding.sectionReviews) {
    onboarding.sectionReviews = defaultSectionReviews();
  }
  if (!isLegacySubmitted(onboarding)) return false;
  for (const key of SECTION_KEY_LIST) {
    onboarding.sectionReviews[key].status = SECTION_REVIEW_STATUSES.PENDING_REVIEW;
    onboarding.sectionReviews[key].revision = onboarding.sectionReviews[key].revision || 1;
  }
  return true;
}

/**
 * Read-only serialization of section reviews (safe for lean objects and mongoose docs).
 * Always returns all five sections with effective statuses.
 */
export function serializeSectionReviews(onboarding) {
  const base = defaultSectionReviews();
  if (!onboarding) return base;
  const stored = plain(onboarding.sectionReviews) || {};
  const legacy = isLegacySubmitted({ status: onboarding.status, sectionReviews: stored });
  for (const key of SECTION_KEY_LIST) {
    const item = stored[key] || {};
    base[key] = {
      status: legacy
        ? SECTION_REVIEW_STATUSES.PENDING_REVIEW
        : item.status || SECTION_REVIEW_STATUSES.NOT_SUBMITTED,
      note: item.note || "",
      reviewedAt: item.reviewedAt || null,
      reviewedBy: item.reviewedBy || null,
      revision: item.revision || 0,
    };
  }
  return base;
}

export function getSectionStatus(onboarding, sectionKey) {
  return serializeSectionReviews(onboarding)[sectionKey]?.status || SECTION_REVIEW_STATUSES.NOT_SUBMITTED;
}

export function isValidSectionKey(key) {
  return SECTION_KEY_LIST.includes(key);
}

/** Returns the unique review sections affected by a candidate payload (draft/submit body). */
export function mapPayloadSections(payload) {
  const sections = new Set();
  if (!payload || typeof payload !== "object") return [];
  for (const [key, value] of Object.entries(payload)) {
    const section = PAYLOAD_KEY_TO_SECTION[key];
    if (section && value && typeof value === "object") {
      sections.add(section);
    }
  }
  return [...sections];
}

/** Persisted fields per payload key, with accepted legacy aliases mapped to the stored field. */
const PAYLOAD_FIELDS = Object.freeze({
  personalDetails: {
    fields: ["fullName", "preferredName", "phoneNumber", "personalPhone", "dateOfBirth", "gender", "city"],
    aliases: { phone: "phoneNumber" },
  },
  residentialAddress: {
    fields: ["street", "city", "state", "postalCode", "country"],
    aliases: { addressLine1: "street", address: "street" },
  },
  emergencyContact: { fields: ["name", "relationship", "phone"], aliases: {} },
  bankDetails: {
    fields: ["accountHolderName", "bankName", "accountNumber", "ifscCode", "accountType"],
    aliases: {},
  },
  taxDetails: { fields: ["panNumber", "taxRegime"], aliases: {} },
  identityDetails: { fields: ["idType", "idNumber"], aliases: {} },
});

function normalizeFieldValue(field, value) {
  if (value === undefined || value === null) return "";
  if (field === "dateOfBirth") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).trim() : date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return field === "ifscCode" || field === "panNumber" ? text.toUpperCase() : text;
}

/**
 * Like mapPayloadSections but only returns sections whose submitted values actually differ from
 * what is stored. Re-sending unchanged values for a locked section is therefore not treated as an
 * edit (keeps older clients that always post the full form working).
 */
export function mapChangedSections(onboarding, payload) {
  const sections = new Set();
  if (!payload || typeof payload !== "object") return [];

  for (const [key, section] of Object.entries(PAYLOAD_KEY_TO_SECTION)) {
    const value = payload[key];
    if (!value || typeof value !== "object") continue;
    if (key === "documents") {
      sections.add(section);
      continue;
    }
    const config = PAYLOAD_FIELDS[key];
    const stored = plain(onboarding?.[key]) || {};
    const changed = Object.entries(value).some(([rawField, rawValue]) => {
      const field = config.aliases[rawField] || rawField;
      if (!config.fields.includes(field)) return false;
      return normalizeFieldValue(field, rawValue) !== normalizeFieldValue(field, stored[field]);
    });
    if (changed) sections.add(section);
  }
  return [...sections];
}

export function allRequiredSectionsApproved(onboarding) {
  const reviews = serializeSectionReviews(onboarding);
  return SECTION_KEY_LIST.every((key) => reviews[key].status === SECTION_REVIEW_STATUSES.APPROVED);
}

/** Sections that are not yet approved (for HR-facing error messages). */
export function unapprovedSections(onboarding) {
  const reviews = serializeSectionReviews(onboarding);
  return SECTION_KEY_LIST.filter((key) => reviews[key].status !== SECTION_REVIEW_STATUSES.APPROVED).map(
    (key) => ({ section: key, status: reviews[key].status })
  );
}

export function sectionsNeedingCandidateAction(onboarding) {
  const reviews = serializeSectionReviews(onboarding);
  return SECTION_KEY_LIST.filter((key) => NEEDS_CANDIDATE_ACTION.has(reviews[key].status));
}

export function isOnboardingFrozen(onboarding) {
  return Boolean(onboarding && ONBOARDING_FROZEN_STATUSES.includes(onboarding.status));
}

/**
 * Derive the overall onboarding status from section reviews.
 * Terminal / frozen statuses are never altered by section state.
 */
export function deriveOverallStatus(onboarding) {
  const status = onboarding?.status;
  if (!status || ONBOARDING_FROZEN_STATUSES.includes(status)) {
    return status;
  }
  if (sectionsNeedingCandidateAction(onboarding).length > 0) {
    return ONBOARDING_STATUSES.CHANGES_REQUESTED;
  }
  if (status === ONBOARDING_STATUSES.CHANGES_REQUESTED) {
    const reviews = serializeSectionReviews(onboarding);
    const allUnderReview = SECTION_KEY_LIST.every((key) =>
      [
        SECTION_REVIEW_STATUSES.PENDING_REVIEW,
        SECTION_REVIEW_STATUSES.RESUBMITTED,
        SECTION_REVIEW_STATUSES.APPROVED,
      ].includes(reviews[key].status)
    );
    if (allUnderReview) {
      return ONBOARDING_STATUSES.SUBMITTED;
    }
  }
  return status;
}

/**
 * Whether the candidate may modify the given section in the current overall status.
 * - Frozen (approved/account setup/activated/rejected/processing): never.
 * - SUBMITTED (under HR review): never.
 * - CHANGES_REQUESTED: only sections flagged for correction (or legacy not-yet-reviewed sections).
 * - Otherwise (draft states): editable.
 */
export function isSectionEditableByCandidate(onboarding, sectionKey) {
  if (!onboarding || isOnboardingFrozen(onboarding)) return false;
  if (hasSubmittedStatus(onboarding)) return false;
  if (onboarding.status === ONBOARDING_STATUSES.CHANGES_REQUESTED) {
    const status = getSectionStatus(onboarding, sectionKey);
    return (
      status === SECTION_REVIEW_STATUSES.NOT_SUBMITTED ||
      status === SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED ||
      status === SECTION_REVIEW_STATUSES.REJECTED
    );
  }
  return true;
}

/** Throws a 409 if any of the given sections is locked for the candidate. */
export function assertSectionsEditable(onboarding, sectionKeys) {
  const locked = (sectionKeys || []).filter((key) => !isSectionEditableByCandidate(onboarding, key));
  if (locked.length > 0) {
    const labels = locked.map((key) => SECTION_LABELS[key] || key).join(", ");
    throw new HttpError(
      409,
      `These sections are locked and cannot be edited right now: ${labels}.`,
      { lockedSections: locked }
    );
  }
}

/**
 * If the candidate edits an already-approved section, approval is invalidated and the section
 * returns to PENDING_REVIEW. Returns true when a change was made.
 */
export function resetSectionOnCandidateEdit(onboarding, sectionKey) {
  if (!onboarding || !isValidSectionKey(sectionKey)) return false;
  if (!onboarding.sectionReviews) {
    onboarding.sectionReviews = defaultSectionReviews();
  }
  const review = onboarding.sectionReviews[sectionKey];
  if (review && review.status === SECTION_REVIEW_STATUSES.APPROVED) {
    review.status = SECTION_REVIEW_STATUSES.PENDING_REVIEW;
    review.note = "";
    review.reviewedAt = null;
    review.reviewedBy = null;
    review.revision = (review.revision || 0) + 1;
    return true;
  }
  return false;
}

function setDocumentReviewState(onboarding, status, note) {
  for (const doc of onboarding.documents || []) {
    doc.reviewStatus = status || undefined;
    doc.reviewNote = note || undefined;
  }
}

/**
 * Apply a candidate submit / resubmit across all sections.
 * Returns { resubmittedSections, anyResubmitted }.
 */
export function markSectionsOnSubmit(onboarding) {
  if (!onboarding.sectionReviews) {
    onboarding.sectionReviews = defaultSectionReviews();
  }
  const resubmittedSections = [];
  for (const key of SECTION_KEY_LIST) {
    const review = onboarding.sectionReviews[key];
    const status = review.status;
    if (status === SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED || status === SECTION_REVIEW_STATUSES.REJECTED) {
      review.status = SECTION_REVIEW_STATUSES.RESUBMITTED;
      review.revision = (review.revision || 0) + 1;
      resubmittedSections.push(key);
      if (key === ONBOARDING_SECTION_KEYS.DOCUMENTS) {
        setDocumentReviewState(onboarding, undefined, undefined);
      }
    } else if (status === SECTION_REVIEW_STATUSES.NOT_SUBMITTED) {
      review.status = SECTION_REVIEW_STATUSES.PENDING_REVIEW;
      review.revision = (review.revision || 0) + 1;
    }
    // PENDING_REVIEW / RESUBMITTED / APPROVED are left untouched.
  }
  return { resubmittedSections, anyResubmitted: resubmittedSections.length > 0 };
}

/**
 * Apply an HR decision to a single section. Mutates the mongoose subdocument.
 * Does NOT auto-approve any other section.
 */
export function applySectionDecision({ onboarding, section, decision, note, reviewerId }) {
  if (!isValidSectionKey(section)) {
    throw new HttpError(400, `Unknown onboarding section '${section}'.`);
  }
  const normalizedDecision = typeof decision === "string" ? decision.trim().toUpperCase() : "";
  if (!Object.values(SECTION_DECISIONS).includes(normalizedDecision)) {
    throw new HttpError(400, "Decision must be one of APPROVE, REJECT or REQUEST_CORRECTION.");
  }

  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (
    (normalizedDecision === SECTION_DECISIONS.REJECT ||
      normalizedDecision === SECTION_DECISIONS.REQUEST_CORRECTION) &&
    !cleanNote
  ) {
    throw new HttpError(400, "A note is required when rejecting a section or requesting a correction.");
  }

  if (!onboarding.sectionReviews) {
    onboarding.sectionReviews = defaultSectionReviews();
  }

  const current = getSectionStatus(onboarding, section);
  if (!REVIEWABLE_STATUSES.has(current)) {
    throw new HttpError(
      409,
      `The ${SECTION_LABELS[section]} section has not been submitted by the candidate yet.`
    );
  }
  if (
    normalizedDecision === SECTION_DECISIONS.APPROVE &&
    (current === SECTION_REVIEW_STATUSES.REJECTED || current === SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED)
  ) {
    throw new HttpError(
      409,
      `The ${SECTION_LABELS[section]} section is awaiting candidate corrections and cannot be approved yet.`
    );
  }

  const review = onboarding.sectionReviews[section];
  const nextStatus =
    normalizedDecision === SECTION_DECISIONS.APPROVE
      ? SECTION_REVIEW_STATUSES.APPROVED
      : normalizedDecision === SECTION_DECISIONS.REJECT
      ? SECTION_REVIEW_STATUSES.REJECTED
      : SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED;

  review.status = nextStatus;
  review.note = cleanNote;
  review.reviewedAt = new Date();
  review.reviewedBy = reviewerId || null;
  review.revision = (review.revision || 0) + 1;

  if (section === ONBOARDING_SECTION_KEYS.DOCUMENTS) {
    setDocumentReviewState(onboarding, nextStatus, cleanNote);
  }

  return { previousStatus: current, status: nextStatus, note: cleanNote, decision: normalizedDecision };
}

/**
 * Whole-submission correction request: every submitted-but-not-approved section is flagged for
 * correction using the supplied note. Approved sections stay locked.
 */
export function flagUnapprovedSectionsForCorrection(onboarding, note, reviewerId) {
  if (!onboarding.sectionReviews) {
    onboarding.sectionReviews = defaultSectionReviews();
  }
  const flagged = [];
  const cleanNote = typeof note === "string" ? note.trim() : "";
  for (const key of SECTION_KEY_LIST) {
    const status = getSectionStatus(onboarding, key);
    if (
      status === SECTION_REVIEW_STATUSES.PENDING_REVIEW ||
      status === SECTION_REVIEW_STATUSES.RESUBMITTED
    ) {
      const review = onboarding.sectionReviews[key];
      review.status = SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED;
      review.note = cleanNote;
      review.reviewedAt = new Date();
      review.reviewedBy = reviewerId || null;
      review.revision = (review.revision || 0) + 1;
      flagged.push(key);
    }
  }
  return flagged;
}

/** Human-readable correction summary built from section notes (for emails / candidate banner). */
export function buildCorrectionSummary(onboarding) {
  const reviews = serializeSectionReviews(onboarding);
  const lines = [];
  for (const key of SECTION_KEY_LIST) {
    const review = reviews[key];
    if (NEEDS_CANDIDATE_ACTION.has(review.status) && review.note) {
      const prefix = review.status === SECTION_REVIEW_STATUSES.REJECTED ? "Rejected" : "Correction needed";
      lines.push(`${SECTION_LABELS[key]} (${prefix}): ${review.note}`);
    }
  }
  return lines.join("\n");
}

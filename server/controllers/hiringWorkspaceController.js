import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import {
  ONBOARDING_ACCOUNT_SETUP_STATUSES,
  ONBOARDING_FROZEN_STATUSES,
  ONBOARDING_STATUSES,
  SECTION_REVIEW_STATUSES,
} from "../models/User.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import {
  SECTION_KEY_LIST,
  allRequiredSectionsApproved,
  serializeSectionReviews,
} from "../services/onboardingSectionService.js";

/**
 * Unified Hiring & Onboarding workspace API.
 *
 * One pipeline: OfferLetters (list projection only, NEVER content/issuedContent/clauses/signature
 * blobs) left-joined to the candidate User.onboarding (statuses + counts only). Heavy data stays on:
 *   - GET /api/offer-letters/:id                    (offer document / HTML)
 *   - GET /api/onboarding/submissions/:id           (section field data, light offer populate)
 */

export const HIRING_STAGES = Object.freeze({
  ALL: "ALL",
  OFFERS: "OFFERS",
  ONBOARDING: "ONBOARDING",
  HR_REVIEW: "HR_REVIEW",
  CORRECTIONS: "CORRECTIONS",
  ACCOUNT_SETUP: "ACCOUNT_SETUP",
  COMPLETED: "COMPLETED",
  /** Not a primary chip: onboarding rejected by HR. Shown under ALL only. */
  REJECTED: "REJECTED",
  /** Not a primary chip: withdrawn offers (hidden from ALL). */
  WITHDRAWN: "WITHDRAWN",
});

const FILTERABLE_STAGES = new Set(Object.values(HIRING_STAGES));

export const HIRING_DEFAULT_LIMIT = 20;
export const HIRING_MAX_LIMIT = 100;

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Single source of truth for stage derivation (JS side). The Mongo `$switch` below must mirror it.
 */
export function deriveHiringStage({ offerStatus, onboardingStatus, hasOnboardingEmployee, offerHasEmployee }) {
  if (offerStatus === OFFER_LETTER_STATUSES.WITHDRAWN) return HIRING_STAGES.WITHDRAWN;
  if (
    onboardingStatus === ONBOARDING_STATUSES.ACTIVATED ||
    hasOnboardingEmployee ||
    (offerStatus === OFFER_LETTER_STATUSES.ACCEPTED && offerHasEmployee)
  ) {
    return HIRING_STAGES.COMPLETED;
  }
  if (offerStatus !== OFFER_LETTER_STATUSES.ACCEPTED) return HIRING_STAGES.OFFERS;
  if (onboardingStatus === ONBOARDING_STATUSES.REJECTED) return HIRING_STAGES.REJECTED;
  if (
    onboardingStatus === ONBOARDING_STATUSES.SUBMITTED ||
    onboardingStatus === ONBOARDING_STATUSES.PROCESSING_APPROVAL
  ) {
    return HIRING_STAGES.HR_REVIEW;
  }
  if (onboardingStatus === ONBOARDING_STATUSES.CHANGES_REQUESTED) return HIRING_STAGES.CORRECTIONS;
  if (ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(onboardingStatus)) return HIRING_STAGES.ACCOUNT_SETUP;
  return HIRING_STAGES.ONBOARDING;
}

function hasValue(path) {
  return { $ne: [{ $ifNull: [path, null] }, null] };
}

function stageExpression() {
  const ob = "$user.ob.status";
  return {
    $switch: {
      branches: [
        { case: { $eq: ["$status", OFFER_LETTER_STATUSES.WITHDRAWN] }, then: HIRING_STAGES.WITHDRAWN },
        {
          case: {
            $or: [
              { $eq: [ob, ONBOARDING_STATUSES.ACTIVATED] },
              hasValue("$user.ob.employeeId"),
              {
                $and: [
                  { $eq: ["$status", OFFER_LETTER_STATUSES.ACCEPTED] },
                  hasValue("$employeeId"),
                ],
              },
            ],
          },
          then: HIRING_STAGES.COMPLETED,
        },
        { case: { $ne: ["$status", OFFER_LETTER_STATUSES.ACCEPTED] }, then: HIRING_STAGES.OFFERS },
        { case: { $eq: [ob, ONBOARDING_STATUSES.REJECTED] }, then: HIRING_STAGES.REJECTED },
        {
          case: {
            $in: [ob, [ONBOARDING_STATUSES.SUBMITTED, ONBOARDING_STATUSES.PROCESSING_APPROVAL]],
          },
          then: HIRING_STAGES.HR_REVIEW,
        },
        { case: { $eq: [ob, ONBOARDING_STATUSES.CHANGES_REQUESTED] }, then: HIRING_STAGES.CORRECTIONS },
        {
          case: { $in: [ob, [...ONBOARDING_ACCOUNT_SETUP_STATUSES]] },
          then: HIRING_STAGES.ACCOUNT_SETUP,
        },
      ],
      default: HIRING_STAGES.ONBOARDING,
    },
  };
}

/** Light OfferLetter projection (extends the OFFER_LETTER_LIST_SELECT idea; no HTML / blobs). */
const OFFER_PROJECTION = Object.freeze({
  candidate: 1,
  position: 1,
  department: 1,
  workLocation: 1,
  employmentType: 1,
  reportingManager: 1,
  monthlySalary: 1,
  annualSalary: 1,
  joiningDate: 1,
  status: 1,
  emailedAt: 1,
  "emailDelivery.status": 1,
  "emailDelivery.sentAt": 1,
  "emailDelivery.sentTo": 1,
  "emailDelivery.attempts": 1,
  "emailDelivery.error": 1,
  issuedAt: 1,
  decisionAt: 1,
  "withdrawal.reason": 1,
  "withdrawal.withdrawnAt": 1,
  employeeId: 1,
  candidateUserId: 1,
  onboardingId: 1,
  "signature.signerName": 1,
  "signature.signedAt": 1,
  "signature.method": 1,
  hasSignedPdf: { $ne: [{ $ifNull: ["$signedPdf.fileId", null] }, null] },
  createdAt: 1,
  updatedAt: 1,
});

function sectionStatusProjection() {
  const sections = {};
  for (const key of SECTION_KEY_LIST) {
    sections[key] = `$onboarding.sectionReviews.${key}.status`;
  }
  return sections;
}

/**
 * Base pipeline: light offer fields + light candidate onboarding (`user.ob`) + derived stage.
 * Only statuses, dates and a document COUNT are read from the candidate User.
 */
function buildBaseStages(usersCollection, firstMatch = null) {
  const stages = [];
  if (firstMatch) stages.push({ $match: firstMatch });
  stages.push({ $project: OFFER_PROJECTION });
  stages.push({
    $lookup: {
      from: usersCollection,
      let: {
        uid: { $ifNull: ["$candidateUserId", "$onboardingId"] },
        oid: "$_id",
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$_id", "$$uid"] },
                { $eq: [{ $type: "$onboarding" }, "object"] },
                {
                  $or: [
                    { $eq: ["$onboarding.offerLetterId", "$$oid"] },
                    { $eq: [{ $ifNull: ["$onboarding.offerLetterId", null] }, null] },
                  ],
                },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            email: 1,
            updatedAt: 1,
            employeeId: 1,
            ob: {
              status: "$onboarding.status",
              candidateName: "$onboarding.candidate.fullName",
              personalName: "$onboarding.personalDetails.fullName",
              submittedAt: "$onboarding.submittedAt",
              reviewedAt: "$onboarding.reviewedAt",
              approvedAt: "$onboarding.approvedAt",
              invitationSentAt: "$onboarding.invitationSentAt",
              accountActivatedAt: "$onboarding.accountActivatedAt",
              employeeId: "$onboarding.employeeId",
              correctionReason: "$onboarding.correctionReason",
              docsCount: { $size: { $ifNull: ["$onboarding.documents", []] } },
              sections: sectionStatusProjection(),
            },
          },
        },
        { $limit: 1 },
      ],
      as: "userDocs",
    },
  });
  stages.push({
    $addFields: { user: { $arrayElemAt: ["$userDocs", 0] } },
  });
  stages.push({ $project: { userDocs: 0 } });
  stages.push({
    $addFields: {
      stage: stageExpression(),
      lastActivityAt: { $max: ["$updatedAt", "$user.updatedAt"] },
    },
  });
  return stages;
}

function sectionReviewsFrom(ob) {
  const reviews = {};
  for (const key of SECTION_KEY_LIST) {
    reviews[key] = { status: ob?.sections?.[key] || SECTION_REVIEW_STATUSES.NOT_SUBMITTED };
  }
  return serializeSectionReviews({ status: ob?.status, sectionReviews: reviews });
}

function summarizeSections(ob) {
  const reviews = sectionReviewsFrom(ob);
  const statuses = {};
  let pending = 0;
  let needsCandidate = 0;
  let approved = 0;
  for (const key of SECTION_KEY_LIST) {
    const status = reviews[key].status;
    statuses[key] = status;
    if (
      status === SECTION_REVIEW_STATUSES.PENDING_REVIEW ||
      status === SECTION_REVIEW_STATUSES.RESUBMITTED
    ) {
      pending += 1;
    } else if (
      status === SECTION_REVIEW_STATUSES.REJECTED ||
      status === SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED
    ) {
      needsCandidate += 1;
    } else if (status === SECTION_REVIEW_STATUSES.APPROVED) {
      approved += 1;
    }
  }
  return { statuses, pending, needsCandidate, approved, total: SECTION_KEY_LIST.length };
}

function mapListRow(doc) {
  const ob = doc.user?.ob || null;
  const sections = summarizeSections(ob);
  const name =
    doc.candidate?.fullName || ob?.personalName || ob?.candidateName || "";
  return {
    offerId: doc._id,
    candidateUserId: doc.candidateUserId || doc.onboardingId || doc.user?._id || null,
    name,
    email: doc.candidate?.email || doc.user?.email || "",
    position: doc.position || "",
    department: doc.department || "",
    monthlySalary: doc.monthlySalary ?? null,
    joiningDate: doc.joiningDate || null,
    offerStatus: doc.status,
    onboardingStatus: ob?.status || null,
    stage: doc.stage,
    sectionsPendingCount: ob ? sections.pending : 0,
    sectionsNeedingCandidateCount: ob ? sections.needsCandidate : 0,
    sectionStatuses: ob ? sections.statuses : null,
    docsCount: ob?.docsCount || 0,
    hasSignedPdf: Boolean(doc.hasSignedPdf),
    emailDeliveryStatus: doc.emailDelivery?.status || "NOT_SENT",
    emailedAt: doc.emailedAt || null,
    employeeId: doc.employeeId || ob?.employeeId || doc.user?.employeeId || null,
    updatedAt: doc.lastActivityAt || doc.updatedAt || null,
  };
}

function buildNextActions(doc, ob, sections) {
  const offerStatus = doc.status;
  const onboardingStatus = ob?.status || null;
  const frozen = onboardingStatus ? ONBOARDING_FROZEN_STATUSES.includes(onboardingStatus) : false;
  const hasEmployee = Boolean(doc.employeeId || ob?.employeeId || doc.user?.employeeId);
  const allApproved = ob
    ? allRequiredSectionsApproved({
        status: ob.status,
        sectionReviews: Object.fromEntries(
          SECTION_KEY_LIST.map((k) => [k, { status: sections.statuses[k] }])
        ),
      })
    : false;

  return {
    canPreviewOffer: true,
    canEditOffer: offerStatus === OFFER_LETTER_STATUSES.DRAFT,
    canSendOffer: offerStatus === OFFER_LETTER_STATUSES.DRAFT,
    canResendOffer: offerStatus === OFFER_LETTER_STATUSES.SENT,
    canWithdrawOffer: offerStatus === OFFER_LETTER_STATUSES.SENT,
    canDownloadSignedPdf: Boolean(doc.hasSignedPdf),
    canReviewOnboarding:
      onboardingStatus === ONBOARDING_STATUSES.SUBMITTED ||
      onboardingStatus === ONBOARDING_STATUSES.CHANGES_REQUESTED,
    canRequestCorrections: onboardingStatus === ONBOARDING_STATUSES.SUBMITTED,
    canApprove: onboardingStatus === ONBOARDING_STATUSES.SUBMITTED && allApproved,
    canReject: Boolean(ob) && !frozen && !hasEmployee,
    canResendActivation:
      Boolean(onboardingStatus) && ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(onboardingStatus),
  };
}

function mapSummary(doc) {
  const ob = doc.user?.ob || null;
  const sections = summarizeSections(ob);
  const row = mapListRow(doc);
  return {
    ...row,
    offer: {
      _id: doc._id,
      position: doc.position || "",
      department: doc.department || "",
      workLocation: doc.workLocation || "",
      employmentType: doc.employmentType || "",
      reportingManager: doc.reportingManager || "",
      monthlySalary: doc.monthlySalary ?? null,
      annualSalary: doc.annualSalary ?? (doc.monthlySalary ? doc.monthlySalary * 12 : null),
      joiningDate: doc.joiningDate || null,
      status: doc.status,
      emailedAt: doc.emailedAt || null,
      emailDelivery: doc.emailDelivery
        ? {
            status: doc.emailDelivery.status || "NOT_SENT",
            sentAt: doc.emailDelivery.sentAt || null,
            sentTo: doc.emailDelivery.sentTo || "",
            attempts: doc.emailDelivery.attempts || 0,
            error: doc.emailDelivery.error || "",
          }
        : null,
      issuedAt: doc.issuedAt || null,
      decisionAt: doc.decisionAt || null,
      signature: doc.signature?.signedAt
        ? {
            signerName: doc.signature.signerName || "",
            signedAt: doc.signature.signedAt,
            method: doc.signature.method || "",
          }
        : null,
      withdrawal: doc.withdrawal?.withdrawnAt
        ? { reason: doc.withdrawal.reason || "", withdrawnAt: doc.withdrawal.withdrawnAt }
        : null,
      hasSignedPdf: Boolean(doc.hasSignedPdf),
    },
    onboarding: ob
      ? {
          status: ob.status,
          submittedAt: ob.submittedAt || null,
          reviewedAt: ob.reviewedAt || null,
          approvedAt: ob.approvedAt || null,
          invitationSentAt: ob.invitationSentAt || null,
          accountActivatedAt: ob.accountActivatedAt || null,
          correctionReason: ob.correctionReason || "",
          sectionStatuses: sections.statuses,
          sectionsApprovedCount: sections.approved,
          sectionsTotal: sections.total,
          docsCount: ob.docsCount || 0,
        }
      : null,
    nextActions: buildNextActions(doc, ob, sections),
  };
}

function normalizeStage(raw) {
  if (typeof raw !== "string" || !raw.trim()) return HIRING_STAGES.ALL;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!FILTERABLE_STAGES.has(key)) {
    throw new HttpError(400, `Unknown stage '${raw}'.`);
  }
  return key;
}

function emptySummary() {
  return {
    all: 0,
    offers: 0,
    onboarding: 0,
    hrReview: 0,
    corrections: 0,
    accountSetup: 0,
    completed: 0,
    rejected: 0,
    withdrawn: 0,
  };
}

function buildSummary(counts) {
  const summary = emptySummary();
  for (const item of counts || []) {
    const n = item.n || 0;
    switch (item._id) {
      case HIRING_STAGES.OFFERS:
        summary.offers = n;
        break;
      case HIRING_STAGES.ONBOARDING:
        summary.onboarding = n;
        break;
      case HIRING_STAGES.HR_REVIEW:
        summary.hrReview = n;
        break;
      case HIRING_STAGES.CORRECTIONS:
        summary.corrections = n;
        break;
      case HIRING_STAGES.ACCOUNT_SETUP:
        summary.accountSetup = n;
        break;
      case HIRING_STAGES.COMPLETED:
        summary.completed = n;
        break;
      case HIRING_STAGES.REJECTED:
        summary.rejected = n;
        break;
      case HIRING_STAGES.WITHDRAWN:
        summary.withdrawn = n;
        break;
      default:
        break;
    }
  }
  // ALL excludes withdrawn offers (matches the legacy active offer list).
  summary.all =
    summary.offers +
    summary.onboarding +
    summary.hrReview +
    summary.corrections +
    summary.accountSetup +
    summary.completed +
    summary.rejected;
  return summary;
}

/**
 * GET /api/hiring/candidates?page&limit&search&stage
 */
export async function listHiringCandidates(req, res, next) {
  try {
    const { OfferLetter, User } = req.auth.models;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      HIRING_MAX_LIMIT,
      Math.max(1, parseInt(req.query.limit, 10) || HIRING_DEFAULT_LIMIT)
    );
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const stage = normalizeStage(req.query.stage);

    const rowMatch = {};
    if (stage === HIRING_STAGES.ALL) {
      rowMatch.stage = { $ne: HIRING_STAGES.WITHDRAWN };
    } else {
      rowMatch.stage = stage;
    }
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      rowMatch.$or = [
        { "candidate.fullName": regex },
        { "candidate.email": regex },
        { position: regex },
        { department: regex },
      ];
    }

    const pipeline = [
      ...buildBaseStages(User.collection.name),
      {
        $facet: {
          counts: [{ $group: { _id: "$stage", n: { $sum: 1 } } }],
          rows: [
            { $match: rowMatch },
            { $sort: { lastActivityAt: -1, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          total: [{ $match: rowMatch }, { $count: "n" }],
        },
      },
    ];

    const [result] = await OfferLetter.aggregate(pipeline).allowDiskUse(true);
    const total = result?.total?.[0]?.n || 0;

    res.json({
      success: true,
      candidates: (result?.rows || []).map(mapListRow),
      summary: buildSummary(result?.counts),
      stage,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/hiring/candidates/:offerId
 * Light header used when the unified detail modal opens. No HTML, no section field data.
 */
export async function getHiringCandidateSummary(req, res, next) {
  try {
    const { OfferLetter, User } = req.auth.models;
    const { offerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(offerId)) {
      throw new HttpError(400, "Invalid offer ID.");
    }

    const [doc] = await OfferLetter.aggregate(
      buildBaseStages(User.collection.name, { _id: new mongoose.Types.ObjectId(offerId) })
    );
    if (!doc) {
      throw new HttpError(404, "Offer letter not found.");
    }

    res.json({ success: true, candidate: mapSummary(doc) });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/hiring/candidates/:offerId/onboarding
 * Resolves the onboarding submission id for an offer so clients can fetch section detail with
 * the existing GET /api/onboarding/submissions/:id endpoint.
 */
export async function getHiringCandidateOnboardingRef(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;
    const { offerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(offerId)) {
      throw new HttpError(400, "Invalid offer ID.");
    }

    const offer = await OfferLetter.findById(offerId).select("candidateUserId onboardingId status").lean();
    if (!offer) {
      throw new HttpError(404, "Offer letter not found.");
    }

    const submissionId = offer.candidateUserId || offer.onboardingId || null;
    res.json({
      success: true,
      offerId: offer._id,
      submissionId,
      hasOnboarding: Boolean(submissionId),
    });
  } catch (error) {
    next(error);
  }
}

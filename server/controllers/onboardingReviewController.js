import crypto from "node:crypto";
import fs from "node:fs";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import {
  ONBOARDING_ACCOUNT_SETUP_STATUSES,
  ONBOARDING_FROZEN_STATUSES,
  ONBOARDING_STATUSES,
  SECTION_REVIEW_STATUSES,
} from "../models/User.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { TOKEN_TYPES } from "../models/AuthToken.js";
import { emailService } from "../services/emailService.js";
import { getDocumentAbsolutePath } from "../services/documentStorage.js";
import {
  signCandidateOnboardingToken,
  signEmployeeActivationToken,
} from "../utils/onboardingToken.js";
import {
  SECTION_LABELS,
  allRequiredSectionsApproved,
  applySectionDecision,
  backfillLegacySectionReviews,
  buildCorrectionSummary,
  deriveOverallStatus,
  flagUnapprovedSectionsForCorrection,
  isSectionEditableByCandidate,
  isValidSectionKey,
  serializeSectionReviews,
  SECTION_KEY_LIST,
  unapprovedSections,
} from "../services/onboardingSectionService.js";
import {
  assertOfferReadyForConversion,
  assertOnboardingDataComplete,
} from "../services/onboardingEmployeeService.js";
import { emitOnboardingEvent, ONBOARDING_EVENT_TYPES } from "../services/onboardingEventsService.js";

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/** HR-facing onboarding snapshot: never exposes the candidate token hash; includes section reviews. */
function serializeOnboardingForHr(candidateUser) {
  const raw = candidateUser.onboarding.toObject
    ? candidateUser.onboarding.toObject()
    : { ...candidateUser.onboarding };
  delete raw.onboardingTokenHash;
  delete raw.activationLockedAt;
  return {
    _id: candidateUser._id,
    ...raw,
    sectionReviews: serializeSectionReviews(candidateUser.onboarding),
  };
}

/**
 * Light offer projection used when an offer is populated on an onboarding submission.
 * NEVER include content / issuedContent / offerDataSnapshot / clauses / signature image data:
 * those are large HTML or base64 blobs that made the Review modal slow to open.
 */
export const ONBOARDING_OFFER_LIGHT_SELECT = [
  "position",
  "department",
  "monthlySalary",
  "annualSalary",
  "joiningDate",
  "status",
  "workLocation",
  "employmentType",
  "reportingManager",
  "signature.signerName",
  "signature.signedAt",
  "signature.method",
  "emailedAt",
  "emailDelivery.status",
].join(" ");

/** Max history entries returned in the onboarding detail response. */
export const ONBOARDING_DETAIL_HISTORY_LIMIT = 30;

/**
 * Fields read from the candidate User for the onboarding LIST (summary).
 * Excludes address / bank / tax / identity / full history. Documents are projected to `_id` only
 * so we can return a count without shipping document metadata for every row.
 */
export const ONBOARDING_LIST_SELECT = [
  "email",
  "createdAt",
  "updatedAt",
  "onboarding.status",
  "onboarding.offerLetterId",
  "onboarding.candidate.fullName",
  "onboarding.candidate.email",
  "onboarding.personalDetails.fullName",
  "onboarding.sectionReviews.personalDetails.status",
  "onboarding.sectionReviews.residentialAddress.status",
  "onboarding.sectionReviews.emergencyContact.status",
  "onboarding.sectionReviews.bankAndTax.status",
  "onboarding.sectionReviews.documents.status",
  "onboarding.documents._id",
  "onboarding.correctionReason",
  "onboarding.rejectionReason",
  "onboarding.invitationSentAt",
  "onboarding.accountActivatedAt",
  "onboarding.submittedAt",
  "onboarding.reviewedAt",
  "onboarding.approvedAt",
  "onboarding.rejectedAt",
  "onboarding.employeeId",
].join(" ");

/**
 * List all candidate onboarding submissions with status filter, search, and pagination.
 *
 * Default `include=summary` returns light rows only (names, status, section statuses, document
 * count, light offer). `include=full` restores the legacy heavy payload for older clients.
 */
export async function getOnboardingSubmissions(req, res, next) {
  try {
    const { User } = req.auth.models;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const include =
      typeof req.query.include === "string" && req.query.include.trim().toLowerCase() === "full"
        ? "full"
        : "summary";

    const query = {
      "onboarding.status": { $exists: true, $ne: null },
    };

    const offerId =
      typeof req.query.offerId === "string" ? req.query.offerId.trim() : "";
    if (offerId) {
      if (!mongoose.Types.ObjectId.isValid(offerId)) {
        throw new HttpError(400, "Invalid offerId filter.");
      }
      query["onboarding.offerLetterId"] = new mongoose.Types.ObjectId(offerId);
    }

    if (status && Object.values(ONBOARDING_STATUSES).includes(status)) {
      query["onboarding.status"] = status;
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { "onboarding.candidate.fullName": regex },
        { "onboarding.candidate.email": regex },
        { "onboarding.personalDetails.fullName": regex },
        { email: regex },
      ];
    }

    const isFull = include === "full";
    let listQuery = User.find(query);
    if (!isFull) {
      listQuery = listQuery.select(ONBOARDING_LIST_SELECT);
    }
    listQuery = listQuery
      .populate("onboarding.offerLetterId", ONBOARDING_OFFER_LIGHT_SELECT)
      .populate("onboarding.employeeId", "fullName employeeCode email status");
    if (isFull) {
      listQuery = listQuery
        .populate("onboarding.approvedBy", "email role")
        .populate("onboarding.rejectedBy", "email role");
    }

    const [total, candidateUsers] = await Promise.all([
      User.countDocuments(query),
      listQuery
        .sort({ "onboarding.submittedAt": -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const submissions = candidateUsers.map((u) => {
      const ob = u.onboarding || {};
      const base = {
        _id: u._id,
        candidateUserId: u._id,
        candidate: {
          fullName: ob.candidate?.fullName || "",
          email: ob.candidate?.email || u.email,
        },
        candidateName: ob.candidate?.fullName || ob.personalDetails?.fullName || "",
        candidateEmail: ob.candidate?.email || u.email,
        status: ob.status || ONBOARDING_STATUSES.DRAFT,
        offerLetterId: ob.offerLetterId,
        correctionReason: ob.correctionReason || "",
        rejectionReason: ob.rejectionReason || "",
        sectionReviews: serializeSectionReviews(ob),
        documentsCount: Array.isArray(ob.documents) ? ob.documents.length : 0,
        invitationSentAt: ob.invitationSentAt || null,
        accountActivatedAt: ob.accountActivatedAt || null,
        submittedAt: ob.submittedAt || null,
        reviewedAt: ob.reviewedAt || null,
        approvedAt: ob.approvedAt || null,
        rejectedAt: ob.rejectedAt || null,
        employeeId: ob.employeeId || null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
      if (!isFull) return base;

      return {
        ...base,
        candidate: ob.candidate || { email: u.email },
        personalDetails: ob.personalDetails,
        residentialAddress: ob.residentialAddress,
        emergencyContact: ob.emergencyContact,
        bankDetails: ob.bankDetails,
        taxDetails: ob.taxDetails,
        identityDetails: ob.identityDetails,
        documents: (ob.documents || []).map((d) => {
          const docObj = typeof d?.toObject === "function" ? d.toObject() : { ...d };
          const docId = docObj._id ? String(docObj._id) : (docObj.id ? String(docObj.id) : String(docObj.storageKey || ""));
          return {
            ...docObj,
            _id: docId,
            id: docId,
          };
        }),
        reviewNotes: ob.reviewNotes || "",
        approvedBy: ob.approvedBy || null,
        rejectedBy: ob.rejectedBy || null,
        history: ob.history || [],
      };
    });

    res.json({
      success: true,
      include,
      submissions,
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
 * Get single onboarding submission by candidate user ID with full details
 */
export async function getOnboardingSubmissionById(req, res, next) {
  try {
    const { User } = req.auth.models;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }

    const candidateUser = await User.findById(id)
      .select("-passwordHash -onboarding.onboardingTokenHash")
      // Light offer only: full OfferLetter carries HTML + base64 signature blobs (slow modal open).
      .populate("onboarding.offerLetterId", ONBOARDING_OFFER_LIGHT_SELECT)
      .populate("onboarding.employeeId", "fullName employeeCode email status")
      .populate("onboarding.reviewedBy", "email role")
      .populate("onboarding.approvedBy", "email role")
      .populate("onboarding.rejectedBy", "email role")
      .lean();

    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    const ob = candidateUser.onboarding;
    const allHistory = Array.isArray(ob.history) ? ob.history : [];
    const submission = {
      _id: candidateUser._id,
      candidateUserId: candidateUser._id,
      candidate: ob.candidate || { email: candidateUser.email },
      candidateName: ob.candidate?.fullName || ob.personalDetails?.fullName || "",
      candidateEmail: ob.candidate?.email || candidateUser.email,
      status: ob.status,
      offerLetterId: ob.offerLetterId,
      personalDetails: ob.personalDetails,
      residentialAddress: ob.residentialAddress,
      emergencyContact: ob.emergencyContact,
      bankDetails: ob.bankDetails,
      taxDetails: ob.taxDetails,
      identityDetails: ob.identityDetails,
      documents: (ob.documents || []).map((d) => {
        const docObj = typeof d?.toObject === "function" ? d.toObject() : { ...d };
        const docId = docObj._id ? String(docObj._id) : (docObj.id ? String(docObj.id) : String(docObj.storageKey || ""));
        return {
          ...docObj,
          _id: docId,
          id: docId,
        };
      }),
      correctionReason: ob.correctionReason || "",
      rejectionReason: ob.rejectionReason || "",
      reviewNotes: ob.reviewNotes || "",
      sectionReviews: serializeSectionReviews(ob),
      invitationSentAt: ob.invitationSentAt || null,
      accountActivatedAt: ob.accountActivatedAt || null,
      submittedAt: ob.submittedAt,
      reviewedAt: ob.reviewedAt,
      reviewedBy: ob.reviewedBy,
      approvedAt: ob.approvedAt,
      approvedBy: ob.approvedBy,
      rejectedAt: ob.rejectedAt || null,
      rejectedBy: ob.rejectedBy || null,
      employeeId: ob.employeeId,
      history: allHistory.slice(-ONBOARDING_DETAIL_HISTORY_LIMIT),
      historyTotal: allHistory.length,
      createdAt: candidateUser.createdAt,
      updatedAt: candidateUser.updatedAt,
    };

    res.json({
      success: true,
      submission,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download an uploaded onboarding document for HR review
 */
export async function downloadSubmissionDocument(req, res, next) {
  try {
    const { User } = req.auth.models;
    const { id, docId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }

    const candidateUser = await User.findById(id).lean();
    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    const doc = candidateUser.onboarding.documents?.find(
      (d) =>
        (d._id && String(d._id) === docId) ||
        (d.id && String(d.id) === docId) ||
        (d.storageKey && String(d.storageKey) === docId)
    );
    if (!doc) {
      throw new HttpError(404, "Document not found.");
    }

    const filePath = getDocumentAbsolutePath({
      databaseName: req.auth.company.databaseName,
      employeeId: `onboarding_${candidateUser._id}`,
      storageKey: doc.storageKey,
    });

    if (!filePath || !fs.existsSync(filePath)) {
      throw new HttpError(404, "Document file not found on server.");
    }

    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
}

/**
 * Request corrections from candidate with specific reason
 */
export async function requestOnboardingCorrections(req, res, next) {
  try {
    const { User, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw new HttpError(400, "Please provide the reason or specific corrections required.");
    }

    const candidateUser = await User.findById(id);
    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    if (
      ONBOARDING_FROZEN_STATUSES.includes(candidateUser.onboarding.status) &&
      candidateUser.onboarding.status !== ONBOARDING_STATUSES.REJECTED
    ) {
      throw new HttpError(400, "This onboarding has already been approved and cannot be updated.");
    }

    const cleanReason = reason.trim();
    // Whole-submission request: every submitted-but-not-approved section is flagged for correction.
    // Already-approved sections stay locked.
    backfillLegacySectionReviews(candidateUser.onboarding);
    flagUnapprovedSectionsForCorrection(candidateUser.onboarding, cleanReason, req.auth.user._id);
    candidateUser.onboarding.status = ONBOARDING_STATUSES.CHANGES_REQUESTED;
    if (!SECTION_KEY_LIST.some((key) => isSectionEditableByCandidate(candidateUser.onboarding, key))) {
      throw new HttpError(
        400,
        "Every section is already approved. Use a section-level correction request or give final approval."
      );
    }
    candidateUser.onboarding.correctionReason = cleanReason;
    candidateUser.onboarding.reviewedAt = new Date();
    candidateUser.onboarding.reviewedBy = req.auth.user._id;

    candidateUser.onboarding.history.push({
      action: "CHANGES_REQUESTED",
      timestamp: new Date(),
      actorRole: "HR_ADMIN",
      notes: cleanReason,
    });

    // Generate valid candidate onboarding token
    const candidateEmail = candidateUser.onboarding.candidate?.email || candidateUser.email;
    const token = signCandidateOnboardingToken({
      companyId: req.auth.company._id,
      onboardingId: candidateUser._id,
      userId: candidateUser._id,
      email: candidateEmail,
    });
    candidateUser.onboarding.onboardingTokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    candidateUser.onboarding.tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await candidateUser.save();

    const clientUrl =
      process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const updateLink = `${clientUrl}/candidate/onboarding/${token}`;

    let emailResult = { success: false };
    try {
      emailResult = await emailService.sendOnboardingCorrectionRequest({
        companyName: req.auth.company?.companyName || "Our Organization",
        candidateName: candidateUser.onboarding.candidate?.fullName || "Candidate",
        candidateEmail,
        correctionReason: cleanReason,
        updateLink,
        company: req.auth.company,
      });
    } catch (eErr) {
      console.error("[onboardingReviewController] Email dispatch warning:", eErr.message);
    }

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.ONBOARDING_CHANGES_REQUESTED,
          targetType: "User",
          targetId: candidateUser._id,
          changes: { reason: cleanReason, emailDelivered: emailResult.success },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    emitOnboardingEvent({
      type: ONBOARDING_EVENT_TYPES.CORRECTION_REQUESTED,
      companyId: req.auth.company._id,
      submissionId: candidateUser._id,
      status: candidateUser.onboarding.status,
    });

    res.json({
      success: true,
      message: "Correction request sent to candidate successfully.",
      onboarding: serializeOnboardingForHr(candidateUser),
      onboardingToken: token,
      emailDelivered: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Reject candidate onboarding with required rejection reason
 */
export async function rejectOnboardingSubmission(req, res, next) {
  try {
    const { User, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw new HttpError(400, "Please provide a reason for rejecting this candidate onboarding.");
    }

    const candidateUser = await User.findById(id);
    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    if (
      (ONBOARDING_FROZEN_STATUSES.includes(candidateUser.onboarding.status) &&
        candidateUser.onboarding.status !== ONBOARDING_STATUSES.REJECTED) ||
      candidateUser.employeeId ||
      candidateUser.onboarding.employeeId
    ) {
      throw new HttpError(400, "Cannot reject onboarding for a candidate who has already been approved as an employee.");
    }

    if (candidateUser.onboarding.status === ONBOARDING_STATUSES.REJECTED) {
      throw new HttpError(400, "This candidate onboarding has already been rejected.");
    }

    const cleanReason = reason.trim();
    candidateUser.onboarding.status = ONBOARDING_STATUSES.REJECTED;
    candidateUser.onboarding.rejectionReason = cleanReason;
    candidateUser.onboarding.rejectedAt = new Date();
    candidateUser.onboarding.rejectedBy = req.auth.user._id;

    // Invalidate active onboarding token so rejected candidate cannot continue drafting or submitting
    candidateUser.onboarding.onboardingTokenHash = null;
    candidateUser.onboarding.tokenExpiresAt = null;

    candidateUser.onboarding.history.push({
      action: "REJECTED",
      timestamp: new Date(),
      actorRole: "HR_ADMIN",
      notes: cleanReason,
    });

    await candidateUser.save();

    let emailResult = { success: false };
    const candidateEmail = candidateUser.onboarding.candidate?.email || candidateUser.email;
    try {
      if (typeof emailService.sendOnboardingRejectionEmail === "function") {
        emailResult = await emailService.sendOnboardingRejectionEmail({
          companyName: req.auth.company?.companyName || "Our Organization",
          candidateName: candidateUser.onboarding.candidate?.fullName || "Candidate",
          candidateEmail,
          rejectionReason: cleanReason,
          company: req.auth.company,
        });
      }
    } catch (eErr) {
      console.error("[onboardingReviewController] Rejection email dispatch warning:", eErr.message);
    }

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.ONBOARDING_REJECTED,
          targetType: "User",
          targetId: candidateUser._id,
          changes: { reason: cleanReason, emailDelivered: emailResult.success },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    emitOnboardingEvent({
      type: ONBOARDING_EVENT_TYPES.REJECTED,
      companyId: req.auth.company._id,
      submissionId: candidateUser._id,
      status: candidateUser.onboarding.status,
    });

    res.json({
      success: true,
      message: "Candidate onboarding has been rejected.",
      onboarding: serializeOnboardingForHr(candidateUser),
      emailDelivered: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Section-wise review: approve / reject / request correction for a single onboarding section.
 * POST /api/onboarding/submissions/:id/sections/:section/review  body: { decision, note }
 */
export async function reviewOnboardingSection(req, res, next) {
  try {
    const { User, AuditLog } = req.auth.models;
    const id = req.params.id;
    const section = req.params.section || req.body?.section;
    const { decision, note } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }
    if (!isValidSectionKey(section)) {
      throw new HttpError(400, `Unknown onboarding section '${section}'.`);
    }

    const candidateUser = await User.findById(id);
    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    const onboarding = candidateUser.onboarding;
    if (
      ![ONBOARDING_STATUSES.SUBMITTED, ONBOARDING_STATUSES.CHANGES_REQUESTED].includes(onboarding.status)
    ) {
      if (ONBOARDING_FROZEN_STATUSES.includes(onboarding.status)) {
        throw new HttpError(
          409,
          `Onboarding is ${onboarding.status} and can no longer be reviewed section by section.`
        );
      }
      throw new HttpError(409, "The candidate has not submitted onboarding for review yet.");
    }

    backfillLegacySectionReviews(onboarding);
    const previousOverall = onboarding.status;
    const result = applySectionDecision({
      onboarding,
      section,
      decision,
      note,
      reviewerId: req.auth.user._id,
    });

    const flagged =
      result.status === SECTION_REVIEW_STATUSES.REJECTED ||
      result.status === SECTION_REVIEW_STATUSES.CORRECTION_REQUESTED;

    onboarding.status = deriveOverallStatus(onboarding);
    onboarding.reviewedAt = new Date();
    onboarding.reviewedBy = req.auth.user._id;
    onboarding.history.push({
      action: `SECTION_${result.status}`,
      timestamp: new Date(),
      actorRole: "HR_ADMIN",
      notes: result.note || `${SECTION_LABELS[section]} approved`,
      section,
    });

    let token = null;
    let candidateEmail = onboarding.candidate?.email || candidateUser.email;
    if (flagged) {
      onboarding.correctionReason = buildCorrectionSummary(onboarding);
      // Re-issue candidate token so the candidate can open the correction link.
      token = signCandidateOnboardingToken({
        companyId: req.auth.company._id,
        onboardingId: candidateUser._id,
        userId: candidateUser._id,
        email: candidateEmail,
      });
      onboarding.onboardingTokenHash = crypto.createHash("sha256").update(token).digest("hex");
      onboarding.tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }

    await candidateUser.save();

    let emailResult = { success: false };
    if (flagged && token) {
      const clientUrl =
        process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      try {
        emailResult = await emailService.sendOnboardingCorrectionRequest({
          companyName: req.auth.company?.companyName || "Our Organization",
          candidateName: onboarding.candidate?.fullName || "Candidate",
          candidateEmail,
          correctionReason: onboarding.correctionReason,
          updateLink: `${clientUrl}/candidate/onboarding/${token}`,
          company: req.auth.company,
        });
      } catch (eErr) {
        console.error("[onboardingReviewController] Section correction email warning:", eErr.message);
      }
    }

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.ONBOARDING_SECTION_REVIEWED,
          targetType: "User",
          targetId: candidateUser._id,
          changes: {
            section,
            decision: result.decision,
            from: result.previousStatus,
            to: result.status,
            note: result.note,
            emailDelivered: emailResult.success,
          },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    const eventBase = {
      companyId: req.auth.company._id,
      submissionId: candidateUser._id,
      status: onboarding.status,
    };
    emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.SECTION_REVIEW, section });
    if (flagged && previousOverall !== ONBOARDING_STATUSES.CHANGES_REQUESTED) {
      emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.CORRECTION_REQUESTED, section });
    }

    const messages = {
      APPROVED: `${SECTION_LABELS[section]} approved.`,
      REJECTED: `${SECTION_LABELS[section]} rejected. The candidate has been asked to resubmit this section.`,
      CORRECTION_REQUESTED: `Correction requested for ${SECTION_LABELS[section]}. The candidate has been notified.`,
    };

    res.json({
      success: true,
      message: messages[result.status],
      section,
      sectionStatus: result.status,
      status: onboarding.status,
      sectionReviews: serializeSectionReviews(onboarding),
      allSectionsApproved: allRequiredSectionsApproved(onboarding),
      onboarding: serializeOnboardingForHr(candidateUser),
      ...(token ? { onboardingToken: token } : {}),
      emailDelivered: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Final HR approval.
 *
 * Does NOT create an Employee. It verifies every section is approved, freezes the approval,
 * issues an account-setup invitation (activation token + email). The Employee and compensation
 * records are created ONLY after the candidate completes activation (see completeActivation).
 *
 * Function name is kept for route/test compatibility.
 */
export async function approveOnboardingAndCreateEmployee(req, res, next) {
  try {
    const { User, OfferLetter, Employee, AuthToken, AuditLog } = req.auth.models;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }

    // 1. Atomically acquire approval lock to prevent concurrent duplicate approval / invitations
    let candidateUser = await User.findOneAndUpdate(
      {
        _id: id,
        "onboarding.status": ONBOARDING_STATUSES.SUBMITTED,
        employeeId: null,
        "onboarding.employeeId": null,
      },
      {
        $set: {
          "onboarding.status": ONBOARDING_STATUSES.PROCESSING_APPROVAL,
        },
      },
      { returnDocument: "after" }
    );

    if (!candidateUser) {
      const existing = await User.findById(id);
      if (!existing || !existing.onboarding) {
        throw new HttpError(404, "Onboarding submission not found.");
      }
      if (
        ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(existing.onboarding.status) ||
        existing.onboarding.status === ONBOARDING_STATUSES.ACTIVATED ||
        existing.employeeId ||
        existing.onboarding.employeeId
      ) {
        throw new HttpError(409, "This candidate onboarding has already been approved.");
      }
      if (existing.onboarding.status === ONBOARDING_STATUSES.PROCESSING_APPROVAL) {
        throw new HttpError(409, "This candidate onboarding approval is currently in progress.");
      }
      throw new HttpError(
        400,
        `Cannot approve onboarding with status '${existing.onboarding.status}'. Only SUBMITTED onboarding can be approved.`
      );
    }

    // Helper to revert atomic lock if validation fails
    const revertApprovalLock = async () => {
      try {
        await User.updateOne(
          { _id: candidateUser._id, "onboarding.status": ONBOARDING_STATUSES.PROCESSING_APPROVAL },
          { $set: { "onboarding.status": ONBOARDING_STATUSES.SUBMITTED } }
        );
      } catch {}
    };

    let candidateEmail;
    let offerLetter;
    try {
      // 2. Every required section must be individually approved by HR
      if (!allRequiredSectionsApproved(candidateUser.onboarding)) {
        const pending = unapprovedSections(candidateUser.onboarding)
          .map((s) => `${SECTION_LABELS[s.section]} (${s.status})`)
          .join(", ");
        throw new HttpError(
          400,
          `All onboarding sections must be approved before final approval. Outstanding: ${pending}.`
        );
      }

      // 3. Verify offer is signed and valid
      offerLetter = await OfferLetter.findById(candidateUser.onboarding.offerLetterId);
      candidateEmail = await assertOfferReadyForConversion({
        Employee,
        offerLetter,
        candidateUser,
        acceptedStatus: OFFER_LETTER_STATUSES.ACCEPTED,
      });

      // 4. Verify required onboarding information is complete
      assertOnboardingDataComplete(candidateUser.onboarding);

      // 5. Fail early (before inviting) if an employee already exists for this identity
      const existingEmployee = await Employee.findOne({
        $or: [{ email: candidateEmail }, { userId: candidateUser._id }],
      });
      if (existingEmployee) {
        throw new HttpError(
          409,
          `An employee record with email '${candidateEmail}' already exists in this workspace.`
        );
      }
    } catch (validationErr) {
      await revertApprovalLock();
      throw validationErr;
    }

    // 6. Freeze approval — no Employee / Compensation created here.
    const candidateName =
      candidateUser.onboarding.personalDetails?.fullName?.trim() ||
      candidateUser.onboarding.candidate?.fullName ||
      "Candidate";
    const activationToken = signEmployeeActivationToken({
      companyId: req.auth.company._id,
      userId: candidateUser._id,
      email: candidateEmail,
    });

    try {
      candidateUser.onboarding.status = ONBOARDING_STATUSES.APPROVED;
      candidateUser.onboarding.approvedAt = new Date();
      candidateUser.onboarding.approvedBy = req.auth.user._id;
      candidateUser.onboarding.reviewedAt = new Date();
      candidateUser.onboarding.reviewedBy = req.auth.user._id;
      candidateUser.onboarding.correctionReason = "";
      candidateUser.onboarding.onboardingTokenHash = null; // Freeze: candidate edit link no longer valid
      candidateUser.onboarding.tokenExpiresAt = null;
      candidateUser.onboarding.history.push({
        action: "APPROVED",
        timestamp: new Date(),
        actorRole: "HR_ADMIN",
        notes: "Final HR approval. Account setup invitation issued; employee profile is created on activation.",
      });
      await candidateUser.save();

      if (AuthToken) {
        const { hashAuthToken } = await import("../utils/authTokenHash.js");
        await AuthToken.updateMany(
          { email: candidateEmail, isActive: true },
          { isActive: false, usedAt: new Date() }
        );
        await AuthToken.create({
          userId: candidateUser._id,
          email: candidateEmail,
          token: hashAuthToken(activationToken),
          type: TOKEN_TYPES.INVITATION,
          role: "EMPLOYEE",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdBy: req.auth.user._id,
          isActive: true,
        });
      }
    } catch (freezeErr) {
      await revertApprovalLock();
      throw freezeErr;
    }

    const clientUrl =
      process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const activationLink = `${clientUrl}/activate?token=${activationToken}`;

    // 7. Dispatch account-setup invitation email
    let activationEmailSent = false;
    let emailError = "";
    try {
      const emailResult = await emailService.sendEmployeeActivationEmail({
        companyName: req.auth.company?.companyName || "Our Organization",
        employeeName: candidateName,
        email: candidateEmail,
        activationLink,
        company: req.auth.company,
      });
      activationEmailSent = Boolean(emailResult.success);
      if (!emailResult.success) {
        emailError = emailResult.error || "Email delivery failed";
      }
    } catch (sendErr) {
      console.error("[onboardingReviewController] Account setup email warning:", sendErr.message);
      emailError = sendErr.message;
    }

    candidateUser.onboarding.status = activationEmailSent
      ? ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT
      : ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING;
    if (activationEmailSent) {
      candidateUser.onboarding.invitationSentAt = new Date();
    }
    await candidateUser.save();

    // 8. Audit
    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.ONBOARDING_APPROVED,
          targetType: "User",
          targetId: candidateUser._id,
          changes: {
            employeeCreated: false,
            activationEmailSent,
          },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch (auditErr) {
        console.error("[onboardingReviewController] Audit log error:", auditErr.message);
      }
    }

    // 9. Realtime
    const eventBase = {
      companyId: req.auth.company._id,
      submissionId: candidateUser._id,
      status: candidateUser.onboarding.status,
    };
    emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.HR_APPROVED });
    if (activationEmailSent) {
      emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.INVITE_SENT });
    }

    res.status(200).json({
      success: true,
      message: activationEmailSent
        ? "Onboarding approved. Account setup invitation sent to the candidate. The employee profile will be created once they activate their account."
        : "Onboarding approved, but the account setup invitation email could not be delivered. Use 'Resend invitation' to retry.",
      employee: null,
      onboarding: serializeOnboardingForHr(candidateUser),
      activationEmailSent,
      emailError: activationEmailSent ? undefined : emailError,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Resend the account-setup invitation for an HR-approved onboarding (no Employee required yet).
 * Also accepts a legacy Employee id for backward compatibility.
 */
export async function resendEmployeeActivationEmail(req, res, next) {
  try {
    const { Employee, User, AuthToken, AuditLog } = req.auth.models;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid submission or employee ID.");
    }

    // Route is /submissions/:id/resend-activation — :id is the candidate User (submission) id.
    // Also accept Employee id for backward compatibility.
    let user = await User.findById(id);
    let employee = null;

    if (user) {
      const linkedEmployeeId = user.onboarding?.employeeId || user.employeeId || null;
      if (linkedEmployeeId) {
        employee = await Employee.findById(linkedEmployeeId);
      }
      const onboardingStatus = user.onboarding?.status;
      if (!employee && !ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(onboardingStatus)) {
        throw new HttpError(
          400,
          "Account setup invitation is only available after final HR approval. Approve onboarding before resending."
        );
      }
    } else {
      employee = await Employee.findById(id);
      if (!employee) {
        throw new HttpError(404, "Onboarding submission or employee record not found.");
      }
      user = await User.findOne({
        $or: [{ email: employee.email }, { employeeId: employee._id }, { "onboarding.employeeId": employee._id }],
      });
      if (!user) {
        throw new HttpError(404, "User account not found for this employee.");
      }
    }

    if (user.onboarding?.status === ONBOARDING_STATUSES.ACTIVATED || (user.isActive && user.lastLoginAt)) {
      throw new HttpError(400, "Employee account is already activated and in use.");
    }

    const recipientEmail = (
      employee?.email ||
      user.onboarding?.candidate?.email ||
      user.email
    )
      .trim()
      .toLowerCase();
    const recipientName =
      employee?.fullName ||
      user.onboarding?.personalDetails?.fullName?.trim() ||
      user.onboarding?.candidate?.fullName ||
      "Candidate";

    // Invalidate old tokens
    if (AuthToken) {
      await AuthToken.updateMany(
        { email: recipientEmail, isActive: true },
        { isActive: false, usedAt: new Date() }
      );
    }

    const activationToken = signEmployeeActivationToken({
      companyId: req.auth.company._id,
      employeeId: employee?._id,
      userId: user._id,
      email: recipientEmail,
    });

    if (AuthToken) {
      const { hashAuthToken } = await import("../utils/authTokenHash.js");
      await AuthToken.create({
        userId: user._id,
        email: recipientEmail,
        token: hashAuthToken(activationToken),
        type: TOKEN_TYPES.INVITATION,
        role: "EMPLOYEE",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: req.auth.user._id,
        isActive: true,
      });
    }

    const clientUrl =
      process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const activationLink = `${clientUrl}/activate?token=${activationToken}`;

    let emailResult = { success: false };
    try {
      emailResult = await emailService.sendEmployeeActivationEmail({
        companyName: req.auth.company?.companyName || "Our Organization",
        employeeName: recipientName,
        email: recipientEmail,
        activationLink,
        employeeCode: employee?.employeeCode,
        company: req.auth.company,
      });
    } catch (sendErr) {
      console.error("[onboardingReviewController] Resend email warning:", sendErr.message);
      emailResult = { success: false, error: sendErr.message };
    }

    if (ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(user.onboarding?.status)) {
      const nextStatus = emailResult.success
        ? ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT
        : ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING;
      const $set = { "onboarding.status": nextStatus };
      if (emailResult.success) {
        $set["onboarding.invitationSentAt"] = new Date();
      }
      await User.updateOne(
        { _id: user._id, "onboarding.status": { $in: ONBOARDING_ACCOUNT_SETUP_STATUSES } },
        { $set }
      );
    }

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.INVITATION_RESENT,
          targetType: employee ? "Employee" : "User",
          targetId: employee ? employee._id : user._id,
          changes: { emailResult },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    if (user.onboarding) {
      emitOnboardingEvent({
        type: ONBOARDING_EVENT_TYPES.INVITE_SENT,
        companyId: req.auth.company._id,
        submissionId: user._id,
        status: emailResult.success
          ? ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT
          : ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING,
      });
    }

    res.json({
      success: true,
      message: emailResult.success
        ? `Account setup invitation resent to ${recipientEmail}.`
        : `Invitation regenerated for ${recipientEmail}, but email delivery failed. Please retry.`,
      deliverySuccess: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

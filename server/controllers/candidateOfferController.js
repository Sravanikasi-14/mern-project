import crypto from "node:crypto";
import { findCompanyById, getCompanyModels } from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { USER_ROLES, ONBOARDING_STATUSES, ONBOARDING_FROZEN_STATUSES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { emailService } from "../services/emailService.js";
import {
  appendSignatureBlockToHtml,
  pdfBufferFromHtml,
} from "../services/offerStandardRenderService.js";
import { getIssuedPdfDownload } from "../services/offerDocumentService.js";
import { getOrCreateSignedPdf } from "../services/offerSignedPdfService.js";
import { normalizeSignatureInput } from "../utils/signatureImage.js";
import { getStorageFileId } from "../services/offerGridFsStorageService.js";
import {
  verifyOfferSigningToken,
  signCandidateOnboardingToken,
} from "../utils/onboardingToken.js";

/**
 * Retrieve an offer letter for candidate secure review and signing
 */
export async function getOfferForReview(req, res, next) {
  try {
    const { token } = req.params;
    let payload;
    try {
      payload = verifyOfferSigningToken(token);
    } catch (err) {
      throw new HttpError(400, "This offer review link is invalid or has expired.");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);
    const offerLetter = await models.OfferLetter.findById(payload.offerId);

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (offerLetter.candidate.email.toLowerCase() !== payload.sub.toLowerCase()) {
      throw new HttpError(403, "You are not authorized to view this offer letter.");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const isCurrentToken = offerLetter.signingTokenHash === tokenHash;
    const isExpired =
      offerLetter.signingTokenExpiresAt && new Date() > new Date(offerLetter.signingTokenExpiresAt);

    const isWithdrawn = offerLetter.status === OFFER_LETTER_STATUSES.WITHDRAWN;
    const alreadySigned = offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED;

    // Continuity: when offer is already signed, re-issue a candidate_onboarding token so
    // refresh of the offer-review page can continue onboarding without relying on email alone.
    // Never reuse offer_signing purpose for onboarding APIs.
    let onboardingToken = null;
    let onboardingLink = null;
    let onboardingStatus = null;
    let onboardingId = null;

    if (alreadySigned) {
      const candidateEmail = offerLetter.candidate?.email?.trim()?.toLowerCase();
      let candidateUser = null;
      if (offerLetter.candidateUserId) {
        candidateUser = await models.User.findById(offerLetter.candidateUserId);
      }
      if (!candidateUser && offerLetter.onboardingId) {
        candidateUser = await models.User.findById(offerLetter.onboardingId);
      }
      if (!candidateUser && candidateEmail) {
        candidateUser = await models.User.findOne({
          email: candidateEmail,
          role: USER_ROLES.CANDIDATE,
        });
      }

      const obStatus = candidateUser?.onboarding?.status || null;
      onboardingStatus = obStatus;
      onboardingId = candidateUser?._id || null;

      const canContinueOnboarding =
        candidateUser &&
        candidateUser.role === USER_ROLES.CANDIDATE &&
        obStatus &&
        !ONBOARDING_FROZEN_STATUSES.includes(obStatus);

      if (canContinueOnboarding) {
        onboardingToken = signCandidateOnboardingToken({
          companyId: company._id,
          onboardingId: candidateUser._id,
          userId: candidateUser._id,
          email: candidateUser.email || candidateEmail,
        });
        const onboardingTokenHash = crypto.createHash("sha256").update(onboardingToken).digest("hex");
        if (!candidateUser.onboarding) {
          candidateUser.onboarding = {
            offerLetterId: offerLetter._id,
            status: ONBOARDING_STATUSES.DRAFT,
          };
        }
        candidateUser.onboarding.onboardingTokenHash = onboardingTokenHash;
        candidateUser.onboarding.tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        await candidateUser.save();

        const clientUrl =
          process.env.CLIENT_URL ||
          process.env.APP_BASE_URL ||
          `${req.protocol}://${req.get("host")}`;
        onboardingLink = `${clientUrl}/candidate/onboarding/${onboardingToken}`;
      }
    }

    res.json({
      success: true,
      offer: {
        _id: offerLetter._id,
        candidate: offerLetter.candidate,
        position: offerLetter.position,
        department: offerLetter.department || "",
        workLocation: offerLetter.workLocation || "",
        employmentType: offerLetter.employmentType || "Full-time Permanent",
        monthlySalary: offerLetter.monthlySalary,
        annualSalary: offerLetter.annualSalary || offerLetter.monthlySalary * 12,
        joiningDate: offerLetter.joiningDate,
        clauses: offerLetter.clauses || [],
        // Frozen legal text for SENT/ACCEPTED; falls back to content for legacy/unfrozen offers.
        content: offerLetter.issuedContent || offerLetter.content,
        status: offerLetter.status,
        // Summary only: never expose captured image bytes through the review API.
        signature: offerLetter.signature?.signedAt
          ? {
              signerName: offerLetter.signature.signerName || "",
              signerEmail: offerLetter.signature.signerEmail || "",
              signedAt: offerLetter.signature.signedAt,
              documentHash: offerLetter.signature.documentHash || "",
              legalStatement: offerLetter.signature.legalStatement || "",
              method: offerLetter.signature.method || "",
              hasImage: Boolean(offerLetter.signature.hasImage),
            }
          : null,
        hasSignedPdf: Boolean(getStorageFileId(offerLetter.signedPdf)),
        // Candidate-facing notes only (never expose HR withdrawal reason)
        decisionAt: offerLetter.decisionAt || null,
        decisionNotes: isWithdrawn ? "" : offerLetter.decisionNotes || "",
        issuedAt: offerLetter.issuedAt || offerLetter.createdAt,
        company: {
          name: company.companyName,
          slug: company.slug,
        },
      },
      company: {
        name: company.companyName,
        slug: company.slug,
      },
      candidateName: offerLetter.candidate?.fullName || "",
      candidateEmail: offerLetter.candidate?.email || "",
      jobTitle: offerLetter.position || "",
      department: offerLetter.department || "",
      status: offerLetter.status,
      legalStatement: "I hereby accept the offer of employment and agree to the terms, compensation, and conditions outlined in this document.",
      isCurrentToken,
      isExpired,
      alreadySigned,
      alreadyDeclined: offerLetter.status === OFFER_LETTER_STATUSES.REJECTED,
      alreadyWithdrawn: isWithdrawn,
      onboardingToken,
      onboardingLink,
      onboardingStatus,
      onboardingId,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Candidate accepts and signs the offer letter
 */
export async function acceptAndSignOffer(req, res, next) {
  try {
    const { token } = req.params;
    const { fullName, signerName, legalConsent, consentAgreed } = req.body || {};
    const nameToSign = (fullName !== undefined ? fullName : signerName) || "";
    const hasConsent = Boolean(legalConsent !== undefined ? legalConsent : consentAgreed);

    let payload;
    try {
      payload = verifyOfferSigningToken(token);
    } catch {
      throw new HttpError(400, "This offer review link is invalid or has expired.");
    }

    if (!nameToSign || typeof nameToSign !== "string" || !nameToSign.trim()) {
      throw new HttpError(400, "Please type your full legal name to sign this offer.");
    }

    if (!hasConsent) {
      throw new HttpError(400, "You must acknowledge and accept the employment terms to sign.");
    }

    // Electronic signature (draw / upload / type) is required in addition to the typed legal name.
    // Validates MIME (png/jpeg/webp), data URL shape and size (~500 KB) or derives an SVG from typed text.
    const sigInput = normalizeSignatureInput(req.body || {});

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);
    const offerLetter = await models.OfferLetter.findById(payload.offerId);

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    // Verify status transition
    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED) {
      throw new HttpError(409, "This offer letter has already been signed.");
    }

    if (offerLetter.status === OFFER_LETTER_STATUSES.REJECTED) {
      throw new HttpError(400, "This offer letter was previously declined and cannot be signed.");
    }

    if (offerLetter.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
      throw new HttpError(400, "This offer letter has been withdrawn by the employer and can no longer be signed.");
    }

    if (offerLetter.status !== OFFER_LETTER_STATUSES.SENT) {
      throw new HttpError(400, `Offer letter cannot be signed in '${offerLetter.status}' status.`);
    }

    // Check token expiration
    if (
      offerLetter.signingTokenExpiresAt &&
      new Date() > new Date(offerLetter.signingTokenExpiresAt)
    ) {
      throw new HttpError(400, "This signing link has expired. Please contact HR for a new link.");
    }

    // Validate single-use token hash matches current token
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (offerLetter.signingTokenHash && offerLetter.signingTokenHash !== tokenHash) {
      throw new HttpError(400, "This signing link has been replaced or invalidated. Please contact HR for a new link.");
    }

    // SHA-256 hash of the exact offer content to guarantee document integrity
    const issuedContent = offerLetter.issuedContent || offerLetter.content || "";
    const documentHash = crypto.createHash("sha256").update(issuedContent).digest("hex");

    const signatureRecord = {
      signerName: nameToSign.trim(),
      signerEmail: offerLetter.candidate.email,
      signedAt: new Date(),
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      documentHash,
      legalStatement: "I hereby accept the offer of employment and agree to the terms, compensation, and conditions outlined in this document.",
      method: sigInput.method,
      typedText: sigInput.typedText,
      imageMimeType: sigInput.mimeType,
      imageData: sigInput.buffer,
      hasImage: true,
    };
    // Audit/response copies never carry raw image bytes.
    const { imageData: _omitImage, ...signatureAudit } = signatureRecord;

    // Atomically claim SENT -> ACCEPTED so concurrent withdrawal cannot also succeed
    const claimed = await models.OfferLetter.findOneAndUpdate(
      {
        _id: offerLetter._id,
        status: OFFER_LETTER_STATUSES.SENT,
      },
      {
        $set: {
          status: OFFER_LETTER_STATUSES.ACCEPTED,
          decisionAt: signatureRecord.signedAt,
          signature: signatureRecord,
          signingTokenHash: null,
          signingTokenEncrypted: null,
          signingTokenExpiresAt: null,
          // Legal text is unchanged by signing; signature is stored separately.
          issuedContent,
          content: issuedContent,
        },
      },
      { returnDocument: "after" }
    );

    if (!claimed) {
      const current = await models.OfferLetter.findById(offerLetter._id).lean();
      if (current?.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
        throw new HttpError(
          409,
          "This offer letter was withdrawn by the employer and can no longer be signed."
        );
      }
      if (current?.status === OFFER_LETTER_STATUSES.ACCEPTED) {
        throw new HttpError(409, "This offer letter has already been signed.");
      }
      throw new HttpError(
        409,
        `Offer letter cannot be signed in '${current?.status || "unknown"}' status.`
      );
    }

    // Continue onboarding linkage against the claimed document
    const acceptedOffer = claimed;

    // Initialize or locate candidate account in company users collection
    const candidateEmail = acceptedOffer.candidate.email.trim().toLowerCase();

    // 1. Prevent email collision with existing employees in this company
    const existingEmployee = await models.Employee.findOne({ email: candidateEmail });
    if (existingEmployee) {
      throw new HttpError(409, "Candidate email conflicts with an existing employee in this company.");
    }

    // 2. Validate existing user lifecycle state before associating
    let candidateUser = await models.User.findOne({ email: candidateEmail });

    if (candidateUser) {
      if (candidateUser.role === USER_ROLES.HR_ADMIN) {
        throw new HttpError(409, "Candidate email conflicts with an existing HR administrator account.");
      }
      if (candidateUser.role === USER_ROLES.EMPLOYEE || candidateUser.employeeId) {
        throw new HttpError(409, "Candidate email conflicts with an existing employee account in this company.");
      }
      if (candidateUser.role !== USER_ROLES.CANDIDATE) {
        throw new HttpError(409, `Candidate email conflicts with an existing user account with role '${candidateUser.role}'.`);
      }
      // Never overwrite an existing onboarding with a different offer
      if (
        candidateUser.onboarding?.offerLetterId &&
        String(candidateUser.onboarding.offerLetterId) !== String(acceptedOffer._id)
      ) {
        throw new HttpError(
          409,
          "This candidate account is already linked to another offer letter in this company."
        );
      }
      // Never re-onboard an approved candidate
      if (
        [
          ONBOARDING_STATUSES.APPROVED,
          ONBOARDING_STATUSES.PROCESSING_APPROVAL,
          ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT,
          ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING,
          ONBOARDING_STATUSES.ACTIVATED,
        ].includes(candidateUser.onboarding?.status)
      ) {
        throw new HttpError(409, "Onboarding for this candidate has already been approved.");
      }
    }

    // 3. Prevent offer from being reassigned to a different user
    if (
      acceptedOffer.candidateUserId &&
      candidateUser &&
      String(acceptedOffer.candidateUserId) !== String(candidateUser._id)
    ) {
      throw new HttpError(
        409,
        "This offer letter is already linked to another candidate user record."
      );
    }

    if (!candidateUser) {
      candidateUser = await models.User.create({
        email: candidateEmail,
        role: USER_ROLES.CANDIDATE,
        isActive: false, // Activated only after HR approves and employee activates
        schemaVersion: 1,
        onboarding: {
          offerLetterId: acceptedOffer._id,
          status: ONBOARDING_STATUSES.DRAFT,
          candidate: {
            fullName: acceptedOffer.candidate.fullName,
            email: candidateEmail,
            phoneNumber: "",
          },
          personalDetails: {
            fullName: acceptedOffer.candidate.fullName,
            email: candidateEmail,
          },
          history: [
            {
              action: "OFFER_SIGNED",
              timestamp: new Date(),
              actorRole: "CANDIDATE",
              notes: `Signed by candidate ${signatureRecord.signerName}`,
            },
          ],
        },
      });
    } else {
      // Existing candidate user: ensure onboarding subdocument is populated
      if (!candidateUser.onboarding) {
        candidateUser.onboarding = {
          offerLetterId: acceptedOffer._id,
          status: ONBOARDING_STATUSES.DRAFT,
          candidate: {
            fullName: acceptedOffer.candidate.fullName,
            email: candidateEmail,
            phoneNumber: "",
          },
          personalDetails: {
            fullName: acceptedOffer.candidate.fullName,
            email: candidateEmail,
          },
          history: [
            {
              action: "OFFER_SIGNED",
              timestamp: new Date(),
              actorRole: "CANDIDATE",
              notes: `Signed by candidate ${signatureRecord.signerName}`,
            },
          ],
        };
      } else {
        candidateUser.onboarding.offerLetterId = acceptedOffer._id;
        if (!candidateUser.onboarding.candidate?.fullName) {
          candidateUser.onboarding.candidate.fullName = acceptedOffer.candidate.fullName;
        }
        candidateUser.onboarding.candidate.email = candidateEmail;
        candidateUser.onboarding.history.push({
          action: "OFFER_SIGNED",
          timestamp: new Date(),
          actorRole: "CANDIDATE",
          notes: `Signed by candidate ${signatureRecord.signerName}`,
        });
      }
    }

    acceptedOffer.candidateUserId = candidateUser._id;
    acceptedOffer.onboardingId = candidateUser._id;
    await acceptedOffer.save();

    // Generate Candidate Onboarding access token & dispatch invitation
    const onboardingToken = signCandidateOnboardingToken({
      companyId: company._id,
      onboardingId: candidateUser._id,
      userId: candidateUser._id,
      email: candidateEmail,
    });
    const onboardingTokenHash = crypto.createHash("sha256").update(onboardingToken).digest("hex");
    candidateUser.onboarding.onboardingTokenHash = onboardingTokenHash;
    candidateUser.onboarding.tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await candidateUser.save();

    const clientUrl =
      process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const onboardingLink = `${clientUrl}/candidate/onboarding/${onboardingToken}`;

    // Dispatch onboarding invitation email
    try {
      await emailService.sendCandidateOnboardingInvite({
        companyName: company.companyName,
        candidateName: acceptedOffer.candidate.fullName,
        candidateEmail: acceptedOffer.candidate.email,
        onboardingLink,
        joiningDate: acceptedOffer.joiningDate,
        position: acceptedOffer.position,
        company,
      });
    } catch (eErr) {
      console.error("[candidateOfferController] Warning sending onboarding invitation:", eErr.message);
    }

    // Record audit log
    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorEmail: acceptedOffer.candidate.email,
          actorRole: "CANDIDATE",
          action: AUDIT_ACTIONS.OFFER_LETTER_SIGNED,
          targetType: "OfferLetter",
          targetId: acceptedOffer._id,
          changes: {
            signature: signatureAudit,
            candidateUserId: candidateUser._id,
            onboardingId: candidateUser._id,
          },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch (auditErr) {
        console.error("[candidateOfferController] Audit log error:", auditErr.message);
      }
    }

    // Final signed PDF (HR signature from the frozen issued document + candidate signature).
    // Stored as SIGNED_PDF; generatedPdf (issued copy) is never overwritten. Best-effort: the
    // download endpoints regenerate it lazily if this fails.
    try {
      await getOrCreateSignedPdf({
        OfferLetter: models.OfferLetter,
        offerLetterId: acceptedOffer._id,
        connection: models.connection,
      });
    } catch (pdfErr) {
      console.error("[candidateOfferController] Signed PDF generation warning:", pdfErr.message);
    }

    res.json({
      success: true,
      message: "Offer letter signed successfully. Onboarding has been initiated.",
      offer: acceptedOffer,
      offerLetter: acceptedOffer,
      onboardingToken,
      onboardingLink,
      userId: candidateUser._id,
      onboardingId: candidateUser._id,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Candidate declines the offer letter
 */
export async function declineOffer(req, res, next) {
  try {
    const { token } = req.params;
    const { reason } = req.body || {};

    let payload;
    try {
      payload = verifyOfferSigningToken(token);
    } catch {
      throw new HttpError(400, "This offer review link is invalid or has expired.");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);
    const offerLetter = await models.OfferLetter.findById(payload.offerId);

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (offerLetter.candidate.email.toLowerCase() !== payload.sub.toLowerCase()) {
      throw new HttpError(403, "You are not authorized to decline this offer letter.");
    }

    if (
      offerLetter.signingTokenExpiresAt &&
      new Date() > new Date(offerLetter.signingTokenExpiresAt)
    ) {
      throw new HttpError(400, "This offer review link has expired.");
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (offerLetter.signingTokenHash && offerLetter.signingTokenHash !== tokenHash) {
      throw new HttpError(400, "This offer review link has been replaced or invalidated.");
    }

    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED) {
      throw new HttpError(400, "This offer has already been signed and cannot be declined.");
    }

    if (offerLetter.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
      throw new HttpError(400, "This offer has been withdrawn by the employer and can no longer be declined.");
    }

    if (offerLetter.status === OFFER_LETTER_STATUSES.REJECTED) {
      return res.json({
        success: true,
        message: "This offer has already been declined.",
        offer: offerLetter,
      });
    }

    const declined = await models.OfferLetter.findOneAndUpdate(
      { _id: offerLetter._id, status: OFFER_LETTER_STATUSES.SENT },
      {
        $set: {
          status: OFFER_LETTER_STATUSES.REJECTED,
          decisionAt: new Date(),
          decisionNotes: reason ? String(reason).trim() : "Declined by candidate",
          signingTokenHash: null,
          signingTokenEncrypted: null,
          signingTokenExpiresAt: null,
        },
      },
      { returnDocument: "after" }
    );

    if (!declined) {
      const current = await models.OfferLetter.findById(offerLetter._id);
      if (current?.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
        throw new HttpError(409, "This offer was withdrawn by the employer before it could be declined.");
      }
      if (current?.status === OFFER_LETTER_STATUSES.REJECTED) {
        return res.json({
          success: true,
          message: "This offer has already been declined.",
          offer: current,
        });
      }
      throw new HttpError(409, `Offer cannot be declined in '${current?.status || "unknown"}' status.`);
    }

    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorEmail: declined.candidate.email,
          actorRole: "CANDIDATE",
          action: AUDIT_ACTIONS.OFFER_LETTER_DECLINED,
          targetType: "OfferLetter",
          targetId: declined._id,
          changes: { reason: declined.decisionNotes },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    res.json({
      success: true,
      message: "Offer letter declined.",
      offer: declined,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download offer letter PDF during candidate review
 */
export async function downloadOfferReviewPdf(req, res, next) {
  try {
    const { token } = req.params;
    let payload;
    try {
      payload = verifyOfferSigningToken(token);
    } catch {
      throw new HttpError(400, "This offer review link is invalid or has expired.");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);
    const offerLetter = await models.OfferLetter.findById(payload.offerId);

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (offerLetter.candidate.email.toLowerCase() !== payload.sub.toLowerCase()) {
      throw new HttpError(403, "You are not authorized to download this offer letter.");
    }

    if (
      offerLetter.signingTokenExpiresAt &&
      new Date() > new Date(offerLetter.signingTokenExpiresAt)
    ) {
      throw new HttpError(400, "This offer review link has expired.");
    }

    let pdfBuffer = null;
    let downloadSuffix = "";
    // Signed offers: prefer the signed PDF (HR + candidate signatures). Issued PDF stays untouched.
    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED && offerLetter.signature?.signedAt) {
      try {
        const signed = await getOrCreateSignedPdf({
          OfferLetter: models.OfferLetter,
          offerLetterId: offerLetter._id,
          connection: models.connection,
        });
        if (signed?.buffer?.length) {
          pdfBuffer = signed.buffer;
          downloadSuffix = "_signed";
        }
      } catch (signedErr) {
        console.warn("[candidateOfferController] Signed PDF unavailable:", signedErr.message);
      }
    }
    // Prefer the immutable issued PDF from GridFS; regenerate from frozen content on miss.
    if (!pdfBuffer && getStorageFileId(offerLetter.generatedPdf)) {
      try {
        const stored = await getIssuedPdfDownload({
          offerLetter,
          connection: models.connection,
        });
        pdfBuffer = stored?.buffer || null;
      } catch (storedErr) {
        console.warn(
          "[candidateOfferController] Issued PDF unavailable; regenerating:",
          storedErr.message
        );
      }
    }
    if (!pdfBuffer) {
      let htmlToRender = offerLetter.issuedContent || offerLetter.content || "";
      if (
        offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED &&
        offerLetter.signature?.signerName
      ) {
        htmlToRender = appendSignatureBlockToHtml(htmlToRender, offerLetter.signature);
      }
      pdfBuffer = await pdfBufferFromHtml(htmlToRender);
    }
    const safeName = (offerLetter.candidate?.fullName || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Offer_Letter_${safeName}${downloadSuffix}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

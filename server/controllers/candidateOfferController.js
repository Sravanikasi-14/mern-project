import crypto from "node:crypto";
import { findCompanyById, getCompanyModels } from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { USER_ROLES, ONBOARDING_STATUSES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { emailService } from "../services/emailService.js";
import { generateOfferLetterPdf } from "../services/pdfService.js";
import { renderOfferLetterHtml } from "../services/offerTemplateService.js";
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

    // If already accepted, ensure authoritative electronic signature details are rendered in content
    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED) {
      const signedHtml = renderOfferLetterHtml(offerLetter, company);
      if (offerLetter.content !== signedHtml) {
        offerLetter.content = signedHtml;
        await offerLetter.save().catch(() => {});
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
        content: offerLetter.content,
        status: offerLetter.status,
        signature: offerLetter.signature || null,
        decisionAt: offerLetter.decisionAt || null,
        decisionNotes: offerLetter.decisionNotes || "",
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
      alreadySigned: offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED,
      alreadyDeclined: offerLetter.status === OFFER_LETTER_STATUSES.REJECTED,
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
    const documentHash = crypto.createHash("sha256").update(offerLetter.content).digest("hex");

    const signatureRecord = {
      signerName: nameToSign.trim(),
      signerEmail: offerLetter.candidate.email,
      signedAt: new Date(),
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      documentHash,
      legalStatement: "I hereby accept the offer of employment and agree to the terms, compensation, and conditions outlined in this document.",
    };

    // Transition offer to ACCEPTED
    offerLetter.status = OFFER_LETTER_STATUSES.ACCEPTED;
    offerLetter.decisionAt = new Date();
    offerLetter.signature = signatureRecord;
    offerLetter.signingTokenHash = null; // Invalidate single-use token

    // Preserve the originally issued terms before updating content with electronic signature block
    offerLetter.issuedContent = offerLetter.content;
    offerLetter.content = renderOfferLetterHtml(offerLetter, company);

    // Initialize or locate candidate account in company users collection
    const candidateEmail = offerLetter.candidate.email.trim().toLowerCase();

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
        String(candidateUser.onboarding.offerLetterId) !== String(offerLetter._id)
      ) {
        throw new HttpError(
          409,
          "This candidate account is already linked to another offer letter in this company."
        );
      }
      // Never re-onboard an approved candidate
      if (candidateUser.onboarding?.status === ONBOARDING_STATUSES.APPROVED) {
        throw new HttpError(409, "Onboarding for this candidate has already been approved.");
      }
    }

    // 3. Prevent offer from being reassigned to a different user
    if (
      offerLetter.candidateUserId &&
      candidateUser &&
      String(offerLetter.candidateUserId) !== String(candidateUser._id)
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
          offerLetterId: offerLetter._id,
          status: ONBOARDING_STATUSES.DRAFT,
          candidate: {
            fullName: offerLetter.candidate.fullName,
            email: candidateEmail,
            phoneNumber: "",
          },
          personalDetails: {
            fullName: offerLetter.candidate.fullName,
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
          offerLetterId: offerLetter._id,
          status: ONBOARDING_STATUSES.DRAFT,
          candidate: {
            fullName: offerLetter.candidate.fullName,
            email: candidateEmail,
            phoneNumber: "",
          },
          personalDetails: {
            fullName: offerLetter.candidate.fullName,
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
        candidateUser.onboarding.offerLetterId = offerLetter._id;
        if (!candidateUser.onboarding.candidate?.fullName) {
          candidateUser.onboarding.candidate.fullName = offerLetter.candidate.fullName;
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

    offerLetter.candidateUserId = candidateUser._id;
    offerLetter.onboardingId = candidateUser._id;
    await offerLetter.save();

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
        candidateName: offerLetter.candidate.fullName,
        candidateEmail: offerLetter.candidate.email,
        onboardingLink,
        joiningDate: offerLetter.joiningDate,
        position: offerLetter.position,
        company,
      });
    } catch (eErr) {
      console.error("[candidateOfferController] Warning sending onboarding invitation:", eErr.message);
    }

    // Record audit log
    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorEmail: offerLetter.candidate.email,
          actorRole: "CANDIDATE",
          action: AUDIT_ACTIONS.OFFER_LETTER_SIGNED,
          targetType: "OfferLetter",
          targetId: offerLetter._id,
          changes: {
            signature: signatureRecord,
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

    res.json({
      success: true,
      message: "Offer letter signed successfully. Onboarding has been initiated.",
      offer: offerLetter,
      offerLetter,
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

    if (offerLetter.status === OFFER_LETTER_STATUSES.REJECTED) {
      return res.json({
        success: true,
        message: "This offer has already been declined.",
        offer: offerLetter,
      });
    }

    offerLetter.status = OFFER_LETTER_STATUSES.REJECTED;
    offerLetter.decisionAt = new Date();
    offerLetter.decisionNotes = reason ? String(reason).trim() : "Declined by candidate";
    offerLetter.signingTokenHash = null;
    await offerLetter.save();

    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorEmail: offerLetter.candidate.email,
          actorRole: "CANDIDATE",
          action: AUDIT_ACTIONS.OFFER_LETTER_DECLINED,
          targetType: "OfferLetter",
          targetId: offerLetter._id,
          changes: { reason: offerLetter.decisionNotes },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    res.json({
      success: true,
      message: "Offer letter declined.",
      offer: offerLetter,
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

    let htmlToRender = offerLetter.content;
    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED) {
      htmlToRender = renderOfferLetterHtml(offerLetter, company);
      if (offerLetter.content !== htmlToRender) {
        offerLetter.content = htmlToRender;
        await offerLetter.save().catch(() => {});
      }
    }

    const pdfBuffer = await generateOfferLetterPdf(htmlToRender);
    const safeName = (offerLetter.candidate?.fullName || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Offer_Letter_${safeName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

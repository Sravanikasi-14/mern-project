import crypto from "node:crypto";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import {
  assertEmployeeInScope,
  hasHrPermission,
  mergeEmployeeScopeFilter,
  redactOutOfScopeManagerIdentity,
} from "../services/hrAccessEnforcementService.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import Company from "../models/Company.js";
import { DEFAULT_OFFER_CLAUSES } from "../services/offerTemplateService.js";
import {
  getIssuedPdfDownload,
  storeIssuedPdfIfNeeded,
  streamIssuedPdfToResponse,
} from "../services/offerDocumentService.js";
import {
  appendSignatureBlockToHtml,
  buildOfferDataFromSources,
  buildSignedOfferHtml,
  pdfBufferFromHtml,
  renderStandardOfferHtml,
} from "../services/offerStandardRenderService.js";
import { getStorageFileId } from "../services/offerGridFsStorageService.js";
import { loadCompanySignature } from "../services/offerTemplateRenderService.js";
import { getOrCreateSignedPdf } from "../services/offerSignedPdfService.js";
import { getConversionStatus } from "../services/docxConversionService.js";
import { emailService } from "../services/emailService.js";
import {
  signOfferSigningToken,
  verifyOfferSigningToken,
} from "../utils/onboardingToken.js";
import { encryptSecret, decryptSecret } from "../utils/secretCrypto.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";

/**
 * Resolve the candidate review JWT for send/resend.
 * Reuses an unexpired stored token when possible; otherwise mints a new one.
 * Callers must persist hash/encrypted/expiry only after SMTP accepts.
 */
function resolveOfferSigningTokenForSend({
  offerLetter,
  companyId,
  candidateEmail,
  validityDays,
}) {
  const now = Date.now();
  const existingExpiry = offerLetter.signingTokenExpiresAt
    ? new Date(offerLetter.signingTokenExpiresAt).getTime()
    : 0;
  const hasUnexpired =
    Boolean(offerLetter.signingTokenHash) &&
    Boolean(offerLetter.signingTokenEncrypted) &&
    existingExpiry > now;

  if (hasUnexpired) {
    try {
      const plaintext = decryptSecret(offerLetter.signingTokenEncrypted);
      const payload = verifyOfferSigningToken(plaintext);
      const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
      const sameOffer = String(payload.offerId) === String(offerLetter._id);
      const sameEmail =
        String(payload.sub || "").toLowerCase() ===
        String(candidateEmail || "").trim().toLowerCase();
      const sameCompany = String(payload.companyId) === String(companyId);
      if (
        sameOffer &&
        sameEmail &&
        sameCompany &&
        hash === offerLetter.signingTokenHash
      ) {
        return {
          signingToken: plaintext,
          tokenHash: offerLetter.signingTokenHash,
          tokenExpiresAt: offerLetter.signingTokenExpiresAt,
          reused: true,
        };
      }
    } catch {
      // Fall through and mint a replacement token.
    }
  }

  const signingToken = signOfferSigningToken({
    companyId,
    offerId: offerLetter._id,
    email: candidateEmail,
  });
  const tokenHash = crypto.createHash("sha256").update(signingToken).digest("hex");
  const tokenExpiresAt = new Date(now + validityDays * 24 * 60 * 60 * 1000);
  return {
    signingToken,
    tokenHash,
    tokenExpiresAt,
    reused: false,
  };
}

async function recordAuditLog(AuditLog, req, action, targetId, changes) {
  try {
    if (!AuditLog || !req.auth?.user) return;
    await AuditLog.create({
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      action,
      targetType: "OfferLetter",
      targetId,
      changes: changes || {},
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[offerLetterController] Audit log error:", err.message);
  }
}

/**
 * Company document used for rendering standard offers. Re-fetches letterhead/contact fields
 * so the render always sees current settings (logo bytes are loaded by the renderer itself).
 */
async function loadOfferRenderCompany(req) {
  const base = req.auth?.company;
  if (!base?._id) return base;
  try {
    const fresh = await Company.findById(base._id)
      .select(
        "companyName slug primaryContact letterhead.address letterhead.website letterhead.signatoryName letterhead.signatoryTitle letterhead.signatureMethod letterhead.signatureMimeType letterhead.signatureTypedText letterhead.signatureUpdatedAt +letterhead.signatureData branding.logoMimeType"
      )
      .lean();
    if (!fresh) return base;
    return { ...fresh, name: fresh.companyName };
  } catch {
    return base;
  }
}

export const HR_SIGNATURE_REQUIRED_MESSAGE =
  "Save your electronic signature in Settings before sending offer letters.";

/**
 * True when the company has a usable HR e-signature for PDF embedding:
 * stored image bytes that can be loaded, or TYPE with typed text (server can render SVG).
 */
export async function companyHasHrSignature(companyId) {
  if (!companyId) return false;
  const loaded = await loadCompanySignature({ _id: companyId });
  if (loaded?.dataUrl) return true;
  return (
    String(loaded?.method || "").toUpperCase() === "TYPE" &&
    Boolean(String(loaded?.typedText || "").trim())
  );
}

/** Never expose the frozen HR signature data URL (or candidate image bytes) in API payloads. */
function sanitizeOfferForResponse(offer) {
  if (!offer || typeof offer !== "object") return offer;
  const out = { ...offer };
  if (out.offerDataSnapshot && typeof out.offerDataSnapshot === "object") {
    out.offerDataSnapshot = { ...out.offerDataSnapshot };
    delete out.offerDataSnapshot.hrSignatureDataUrl;
  }
  if (out.signature && typeof out.signature === "object") {
    out.signature = { ...out.signature };
    delete out.signature.imageData;
    delete out.signature.imageDataUrl;
  }
  return out;
}

function signatoryExtras(body = {}) {
  const extras = {};
  if (typeof body.signatoryName === "string") extras.signatoryName = body.signatoryName;
  if (typeof body.signatoryTitle === "string") extras.signatoryTitle = body.signatoryTitle;
  return extras;
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Get library of predefined default clause templates
 */
export async function getDefaultClauses(req, res, next) {
  try {
    const formatted = DEFAULT_OFFER_CLAUSES.map((c) => ({
      ...c,
      id: c.id || c.clauseId,
      clauseId: c.clauseId || c.id,
      isIncluded: c.isIncluded !== false,
      enabled: c.isIncluded !== false,
    }));
    res.json({
      success: true,
      clauses: formatted,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get active employees as potential offer recipients with relevant populated fields
 */
export async function getOfferRecipients(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;

    const includeSalary = hasHrPermission(req.hrAccess, "payroll.view");
    const employees = await Employee.find(
      mergeEmployeeScopeFilter(req.hrAccess, { status: EMPLOYEE_STATUSES.ACTIVE })
    )
      .select("fullName email employeeCode job status")
      .populate("job.reportingManagerId", "fullName employeeCode")
      .sort({ fullName: 1 })
      .lean();

    const employeeIds = employees.map((emp) => emp._id);
    let compensations = [];
    if (includeSalary && EmployeeCompensation && employeeIds.length > 0) {
      compensations = await EmployeeCompensation.find({
        employeeId: { $in: employeeIds },
      })
        .select("employeeId revisions")
        .lean();
    }

    const compensationMap = new Map();
    const now = new Date();
    for (const comp of compensations) {
      const validRevisions = (comp.revisions || [])
        .filter((rev) => new Date(rev.effectiveFromDate) <= now)
        .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

      if (validRevisions.length > 0 && validRevisions[0].monthlyCostToCompany != null) {
        compensationMap.set(
          String(comp.employeeId),
          parseFloat(validRevisions[0].monthlyCostToCompany.toString())
        );
      }
    }

    const recipients = employees.map((emp) => {
      const row = {
        _id: emp._id,
        fullName: emp.fullName,
        email: emp.email,
        employeeCode: emp.employeeCode,
        position: emp.job?.jobTitle || "",
        department: emp.job?.department || "",
        workLocation: emp.job?.workLocation || "",
        employmentType: emp.job?.employmentType || "Full-time Permanent",
        joiningDate: emp.job?.joiningDate || null,
        reportingManager:
          redactOutOfScopeManagerIdentity(req.hrAccess, emp.job?.reportingManagerId)?.fullName || "",
        status: emp.status,
      };
      if (includeSalary) {
        row.monthlySalary = compensationMap.get(String(emp._id)) ?? null;
      }
      return row;
    });

    res.json({
      success: true,
      recipients,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get summary counters for Offer Letters management page
 */
export async function getOfferSummary(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;

    const counts = await OfferLetter.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {
      total: 0,
      draft: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      withdrawn: 0,
    };

    for (const item of counts) {
      summary.total += item.count;
      if (item._id === OFFER_LETTER_STATUSES.DRAFT) summary.draft = item.count;
      else if (item._id === OFFER_LETTER_STATUSES.SENT) summary.sent = item.count;
      else if (item._id === OFFER_LETTER_STATUSES.ACCEPTED) summary.accepted = item.count;
      else if (item._id === OFFER_LETTER_STATUSES.REJECTED) summary.rejected = item.count;
      else if (item._id === OFFER_LETTER_STATUSES.WITHDRAWN) summary.withdrawn = item.count;
    }

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Fields required by the Offer Letters list UI.
 * Excludes large HTML (content/issuedContent), clauses, snapshots, signatures and PDF bodies.
 * Full document remains available via GET /offer-letters/:id and preview/PDF endpoints.
 */
export const OFFER_LETTER_LIST_SELECT = [
  "candidate",
  "position",
  "department",
  "workLocation",
  "employmentType",
  "monthlySalary",
  "annualSalary",
  "joiningDate",
  "status",
  "emailedAt",
  "emailDelivery",
  "issuedAt",
  "decisionAt",
  "withdrawal",
  "employeeId",
  "signedPdf.fileId",
  "createdAt",
  "updatedAt",
].join(" ");

/**
 * List offer letters with status filters, search, and pagination
 */
export async function getOfferLetters(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";

    const query = {};

    if (status && Object.values(OFFER_LETTER_STATUSES).includes(status)) {
      query.status = status;
    } else {
      // Active list default: hide withdrawn offers unless HR filters for WITHDRAWN explicitly.
      query.status = { $ne: OFFER_LETTER_STATUSES.WITHDRAWN };
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { "candidate.fullName": regex },
        { "candidate.email": regex },
        { position: regex },
        { department: regex },
      ];
    }

    const [total, offers] = await Promise.all([
      OfferLetter.countDocuments(query),
      OfferLetter.find(query)
        .select(OFFER_LETTER_LIST_SELECT)
        .populate("employeeId", "fullName employeeCode email status")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const formattedOffers = offers.map((offer) => ({
      _id: offer._id,
      candidate: offer.candidate,
      position: offer.position,
      department: offer.department || "",
      workLocation: offer.workLocation || "",
      employmentType: offer.employmentType || "Full-time Permanent",
      monthlySalary: offer.monthlySalary,
      annualSalary: offer.annualSalary || offer.monthlySalary * 12,
      joiningDate: offer.joiningDate,
      status: offer.status,
      emailedAt: offer.emailedAt || null,
      emailDelivery: offer.emailDelivery || null,
      issuedAt: offer.issuedAt || null,
      decisionAt: offer.decisionAt || null,
      candidateSigned: offer.status === OFFER_LETTER_STATUSES.ACCEPTED,
      hasSignedPdf: Boolean(offer.signedPdf?.fileId),
      withdrawal: offer.withdrawal
        ? {
            reason: offer.withdrawal.reason || "",
            withdrawnAt: offer.withdrawal.withdrawnAt || null,
            withdrawnByEmail: offer.withdrawal.withdrawnByEmail || "",
          }
        : null,
      employeeId: offer.employeeId?._id || offer.employeeId || null,
      employee: offer.employeeId && typeof offer.employeeId === "object"
        ? {
            _id: offer.employeeId._id,
            fullName: offer.employeeId.fullName,
            employeeCode: offer.employeeId.employeeCode,
            email: offer.employeeId.email,
          }
        : null,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
    }));

    res.json({
      success: true,
      offerLetters: formattedOffers,
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
 * Get single offer letter with full clauses, content, and linked employee
 */
export async function getOfferLetterById(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;
    const { id } = req.params;

    const offerLetter = await OfferLetter.findById(id)
      .select("+signature.imageData")
      .populate("employeeId", "fullName employeeCode email job status")
      .populate("createdBy", "email role")
      .lean();

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    // Preview shows what the candidate actually received (frozen issuedContent), plus the
    // candidate signature once ACCEPTED. The live draft `content` is only used before first send.
    try {
      if (offerLetter.status === "ACCEPTED" && offerLetter.signature?.signedAt && offerLetter.issuedContent) {
        offerLetter.content = buildSignedOfferHtml({
          issuedContent: offerLetter.issuedContent,
          signature: offerLetter.signature,
        }).html;
      } else if (offerLetter.issuedContent) {
        offerLetter.content = offerLetter.issuedContent;
      }
    } catch (renderErr) {
      console.warn("[offerLetter] Could not build signed preview HTML:", renderErr.message);
    }

    res.json({
      success: true,
      offerLetter: sanitizeOfferForResponse(offerLetter),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Preview offer letter without persisting
 */
export async function previewOfferLetter(req, res, next) {
  try {
    const {
      candidate,
      position,
      department,
      workLocation,
      employmentType,
      reportingManager,
      monthlySalary,
      joiningDate,
      clauses,
    } = req.body || {};

    const numSalary = parseFloat(monthlySalary) || 0;
    const annualSalary = numSalary * 12;

    const validatedClauses = Array.isArray(clauses) && clauses.length > 0
      ? clauses.map((c, i) => ({
          id: c.id || c.clauseId || `clause_${i + 1}`,
          clauseId: c.clauseId || c.id || `clause_${i + 1}`,
          title: String(c.title || "").trim(),
          body: String(c.body || "").trim(),
          isIncluded: c.isIncluded !== false && c.enabled !== false,
          enabled: c.isIncluded !== false && c.enabled !== false,
          isCustom: Boolean(c.isCustom),
          isRequired: Boolean(c.isRequired),
          order: typeof c.order === "number" ? c.order : i + 1,
        }))
      : DEFAULT_OFFER_CLAUSES;

    const offerData = {
      candidate: {
        fullName: candidate?.fullName?.trim() || "Candidate Name",
        email: candidate?.email?.trim() || "candidate@example.com",
      },
      position: position?.trim() || "Designation",
      department: department?.trim() || "",
      workLocation: workLocation?.trim() || "Headquarters",
      employmentType: employmentType?.trim() || "Full-time Permanent",
      reportingManager: reportingManager?.trim() || "",
      monthlySalary: numSalary,
      annualSalary,
      joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
      clauses: validatedClauses,
      createdAt: new Date(),
      ...signatoryExtras(req.body),
    };

    const company = await loadOfferRenderCompany(req);
    const renderedHtml = await renderStandardOfferHtml({ offerData, company });

    res.json({
      success: true,
      html: renderedHtml,
      hasHrSignature: await companyHasHrSignature(company?._id),
      conversion: getConversionStatus(),
      templateId: null,
      templateType: null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new offer letter draft
 */
export async function createOfferLetter(req, res, next) {
  try {
    const { OfferLetter, Employee, AuditLog } = req.auth.models;
    const {
      employeeId,
      candidate,
      position,
      department,
      workLocation,
      employmentType,
      reportingManager,
      monthlySalary,
      joiningDate,
      clauses,
    } = req.body || {};

    let validEmployeeId = null;
    if (employeeId) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        throw new HttpError(400, "Invalid recipient employee ID.");
      }
      const existingEmployee = await Employee.findById(employeeId);
      if (!existingEmployee) {
        throw new HttpError(404, "Selected recipient employee record was not found in company database.");
      }
      if (existingEmployee.status !== EMPLOYEE_STATUSES.ACTIVE) {
        throw new HttpError(400, "Cannot create an offer letter for an inactive employee record.");
      }
      validEmployeeId = existingEmployee._id;
    }

    // Validate inputs
    const errors = {};
    if (!candidate?.fullName || typeof candidate.fullName !== "string" || !candidate.fullName.trim()) {
      errors.fullName = "Candidate full name is required.";
    }
    if (!candidate?.email || !isValidEmail(candidate.email)) {
      errors.email = "A valid candidate email address is required.";
    }
    if (!position || typeof position !== "string" || !position.trim()) {
      errors.position = "Position / job title is required.";
    }
    if (!joiningDate || isNaN(new Date(joiningDate).getTime())) {
      errors.joiningDate = "A valid joining date is required.";
    }
    const salaryNum = parseFloat(monthlySalary);
    if (isNaN(salaryNum) || salaryNum <= 0) {
      errors.monthlySalary = "Please enter a valid positive monthly salary amount.";
    }

    if (Object.keys(errors).length > 0) {
      throw new HttpError(400, "Validation failed for offer letter creation.", { errors });
    }

    const annualSalary = Math.round(salaryNum * 12);
    const candidateClean = {
      fullName: candidate.fullName.trim(),
      email: normalizeEmail(candidate.email),
    };

    const validatedClauses = Array.isArray(clauses) && clauses.length > 0
      ? clauses.map((c, i) => ({
          id: c.id || c.clauseId || `clause_${i + 1}`,
          clauseId: c.clauseId || c.id || `clause_${i + 1}`,
          title: String(c.title || "").trim(),
          body: String(c.body || "").trim(),
          isIncluded: c.isIncluded !== false && c.enabled !== false,
          enabled: c.isIncluded !== false && c.enabled !== false,
          isCustom: Boolean(c.isCustom),
          isRequired: Boolean(c.isRequired),
          order: typeof c.order === "number" ? c.order : i + 1,
        }))
      : DEFAULT_OFFER_CLAUSES;

    const offerData = {
      candidate: candidateClean,
      position: position.trim(),
      department: department ? String(department).trim() : "",
      workLocation: workLocation ? String(workLocation).trim() : "",
      reportingManager: reportingManager ? String(reportingManager).trim() : "",
      employmentType: employmentType ? String(employmentType).trim() : "Full-time Permanent",
      monthlySalary: salaryNum,
      annualSalary,
      joiningDate: new Date(joiningDate),
      clauses: validatedClauses,
      createdAt: new Date(),
      ...signatoryExtras(req.body),
    };

    // Single standard HRMS template: templateId from clients (if any) is ignored.
    const company = await loadOfferRenderCompany(req);
    const renderedHtml = await renderStandardOfferHtml({ offerData, company });

    const newOffer = await OfferLetter.create({
      ...offerData,
      employeeId: validEmployeeId,
      content: renderedHtml,
      status: OFFER_LETTER_STATUSES.DRAFT,
      createdBy: req.auth.user._id,
      templateId: null,
      templateVersion: null,
      templateType: null,
      offerDataSnapshot: offerData,
    });

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_CREATED, newOffer._id, {
        candidate: candidateClean,
        employeeId: validEmployeeId,
        position: newOffer.position,
        monthlySalary: salaryNum,
        joiningDate: newOffer.joiningDate,
        status: newOffer.status,
        templateId: null,
      });
    }

    res.status(201).json({
      success: true,
      message: "Offer letter draft created successfully.",
      offerLetter: newOffer,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an existing offer letter draft
 */
export async function updateOfferLetter(req, res, next) {
  try {
    const { OfferLetter, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;
    const {
      employeeId,
      candidate,
      position,
      department,
      workLocation,
      employmentType,
      reportingManager,
      monthlySalary,
      joiningDate,
      clauses,
    } = req.body || {};

    const offerLetter = await OfferLetter.findById(id);
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    // Edits are strictly forbidden if offer is not DRAFT
    if (offerLetter.status !== OFFER_LETTER_STATUSES.DRAFT) {
      throw new HttpError(
        400,
        `Cannot edit an offer letter with status '${offerLetter.status}'. Once an offer is issued or closed, content is locked for audit integrity.`
      );
    }

    if (employeeId !== undefined) {
      if (!employeeId) {
        offerLetter.employeeId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
          throw new HttpError(400, "Invalid recipient employee ID.");
        }
        const existingEmployee = await Employee.findById(employeeId);
        if (!existingEmployee) {
          throw new HttpError(404, "Selected recipient employee record was not found in company database.");
        }
        if (existingEmployee.status !== EMPLOYEE_STATUSES.ACTIVE) {
          throw new HttpError(400, "Cannot link an offer letter to an inactive employee record.");
        }
        offerLetter.employeeId = existingEmployee._id;
      }
    }

    // Validate candidate
    if (candidate?.fullName && typeof candidate.fullName === "string") {
      offerLetter.candidate.fullName = candidate.fullName.trim();
    }
    if (candidate?.email) {
      if (!isValidEmail(candidate.email)) {
        throw new HttpError(400, "A valid candidate email address is required.");
      }
      offerLetter.candidate.email = normalizeEmail(candidate.email);
    }

    // Validate position
    if (position && typeof position === "string" && position.trim()) {
      offerLetter.position = position.trim();
    }

    if (department !== undefined) {
      offerLetter.department = department ? String(department).trim() : "";
    }
    if (workLocation !== undefined) {
      offerLetter.workLocation = workLocation ? String(workLocation).trim() : "";
    }
    if (employmentType !== undefined) {
      offerLetter.employmentType = employmentType ? String(employmentType).trim() : "Full-time Permanent";
    }
    if (reportingManager !== undefined) {
      offerLetter.reportingManager = reportingManager ? String(reportingManager).trim() : "";
    }

    if (joiningDate) {
      const d = new Date(joiningDate);
      if (isNaN(d.getTime())) {
        throw new HttpError(400, "Please enter a valid joining date.");
      }
      offerLetter.joiningDate = d;
    }

    if (monthlySalary !== undefined && monthlySalary !== null) {
      const salaryNum = parseFloat(monthlySalary);
      if (isNaN(salaryNum) || salaryNum <= 0) {
        throw new HttpError(400, "Please enter a valid positive monthly salary amount.");
      }
      offerLetter.monthlySalary = salaryNum;
      offerLetter.annualSalary = Math.round(salaryNum * 12);
    }

    if (Array.isArray(clauses)) {
      offerLetter.clauses = clauses.map((c, i) => ({
        id: c.id || c.clauseId || `clause_${i + 1}`,
        clauseId: c.clauseId || c.id || `clause_${i + 1}`,
        title: String(c.title || "").trim(),
        body: String(c.body || "").trim(),
        isIncluded: c.isIncluded !== false && c.enabled !== false,
        enabled: c.isIncluded !== false && c.enabled !== false,
        isCustom: Boolean(c.isCustom),
        isRequired: Boolean(c.isRequired),
        order: typeof c.order === "number" ? c.order : i + 1,
      }));
    }

    // Re-render with the single standard template from current fields + optional signatory overrides
    const refreshedData = buildOfferDataFromSources(offerLetter, signatoryExtras(req.body));
    const company = await loadOfferRenderCompany(req);
    offerLetter.content = await renderStandardOfferHtml({ offerData: refreshedData, company });
    offerLetter.offerDataSnapshot = refreshedData;
    offerLetter.markModified("offerDataSnapshot");
    offerLetter.templateId = null;
    offerLetter.templateVersion = null;
    offerLetter.templateType = null;
    // A DRAFT may carry a frozen document from a failed first send; editing invalidates it
    // (the old GridFS blob is left untouched, only the pointer is cleared).
    if (offerLetter.issuedContent) offerLetter.issuedContent = "";
    if (offerLetter.generatedPdf?.fileId) {
      offerLetter.generatedPdf = {
        provider: "",
        bucket: "",
        fileId: null,
        key: "",
        filename: "",
        contentType: "",
        byteSize: 0,
        checksumSha256: "",
        generatedAt: null,
      };
    }
    offerLetter.updatedAt = new Date();

    await offerLetter.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_UPDATED, offerLetter._id, {
        candidate: offerLetter.candidate,
        position: offerLetter.position,
        monthlySalary: offerLetter.monthlySalary,
        joiningDate: offerLetter.joiningDate,
      });
    }

    res.json({
      success: true,
      message: "Offer letter draft updated successfully.",
      offerLetter,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Manually update status of an offer letter (DRAFT -> SENT, ACCEPTED, REJECTED).
 * Withdrawal must use POST /:id/withdraw — not this endpoint.
 */
export async function updateOfferStatus(req, res, next) {
  try {
    const { OfferLetter, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { status, decisionNotes } = req.body || {};

    const cleanStatus = String(status || "").toUpperCase().trim();
    // SENT is not settable here — offers become SENT only via POST /:id/send, which
    // requires an HR signature, freezes issuedContent, generates the PDF, and emails it.
    const allowedManual = [
      OFFER_LETTER_STATUSES.DRAFT,
      OFFER_LETTER_STATUSES.ACCEPTED,
      OFFER_LETTER_STATUSES.REJECTED,
    ];
    if (cleanStatus === OFFER_LETTER_STATUSES.SENT) {
      throw new HttpError(
        400,
        "Use Send email to issue an offer. Manual Mark as Sent is disabled so unsigned offers cannot bypass the HR signature requirement.",
        { code: "HR_SIGNATURE_REQUIRED" }
      );
    }
    if (!allowedManual.includes(cleanStatus)) {
      throw new HttpError(
        400,
        `Invalid status '${status}'. Must be DRAFT, ACCEPTED, or REJECTED. Use Send email to issue, or the withdraw endpoint to withdraw.`
      );
    }

    const offerLetter = await OfferLetter.findById(id);
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    const oldStatus = offerLetter.status;

    if (oldStatus === OFFER_LETTER_STATUSES.WITHDRAWN) {
      throw new HttpError(400, "Cannot change status of a withdrawn offer letter.");
    }

    // Disallow moving backward from issued or decided states to DRAFT
    if (cleanStatus === OFFER_LETTER_STATUSES.DRAFT && oldStatus !== OFFER_LETTER_STATUSES.DRAFT) {
      throw new HttpError(
        400,
        `Cannot revert an offer letter in '${oldStatus}' status back to DRAFT.`
      );
    }

    offerLetter.status = cleanStatus;

    if (
      cleanStatus === OFFER_LETTER_STATUSES.ACCEPTED ||
      cleanStatus === OFFER_LETTER_STATUSES.REJECTED
    ) {
      offerLetter.decisionAt = new Date();
      if (decisionNotes !== undefined) {
        offerLetter.decisionNotes = String(decisionNotes).trim();
      }
    }

    offerLetter.updatedAt = new Date();
    await offerLetter.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_STATUS_CHANGED, offerLetter._id, {
        oldStatus,
        newStatus: cleanStatus,
        decisionNotes: offerLetter.decisionNotes,
      });
    }

    res.json({
      success: true,
      message: `Offer letter status updated from ${oldStatus} to ${cleanStatus}.`,
      offerLetter,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Withdraw a sent, unsigned offer. Preserves document, PDF, email history.
 * Atomically transitions SENT -> WITHDRAWN so concurrent accept cannot also succeed.
 */
export async function withdrawOfferLetter(req, res, next) {
  try {
    const { OfferLetter, AuditLog } = req.auth.models;
    const { id } = req.params;
    const reason = String(req.body?.reason || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid offer letter ID.");
    }

    if (!reason || reason.length < 3) {
      throw new HttpError(400, "A withdrawal reason is required (at least 3 characters).");
    }
    if (reason.length > 2000) {
      throw new HttpError(400, "Withdrawal reason must be 2000 characters or fewer.");
    }

    const existing = await OfferLetter.findById(id).lean();
    if (!existing) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (existing.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
      return res.json({
        success: true,
        message: "This offer letter has already been withdrawn.",
        offerLetter: existing,
        alreadyWithdrawn: true,
      });
    }

    if (existing.status === OFFER_LETTER_STATUSES.DRAFT) {
      throw new HttpError(
        400,
        "Draft offers cannot be withdrawn. Delete the draft instead if it is no longer needed."
      );
    }

    if (existing.status === OFFER_LETTER_STATUSES.ACCEPTED) {
      throw new HttpError(
        400,
        "Accepted/signed offers cannot be withdrawn through this action."
      );
    }

    if (existing.status === OFFER_LETTER_STATUSES.REJECTED) {
      throw new HttpError(
        400,
        "Rejected offers cannot be withdrawn. History is preserved as rejected."
      );
    }

    if (existing.status !== OFFER_LETTER_STATUSES.SENT) {
      throw new HttpError(
        400,
        `Cannot withdraw an offer letter with status '${existing.status}'. Only sent, unsigned offers can be withdrawn.`
      );
    }

    if (existing.employeeId) {
      throw new HttpError(
        400,
        "This offer is linked to an employee record and cannot be withdrawn."
      );
    }

    if (existing.signature?.signedAt) {
      throw new HttpError(
        400,
        "This offer has a recorded signature and cannot be withdrawn."
      );
    }

    const withdrawnAt = new Date();
    const actorId = req.auth?.user?._id || req.auth?.userId || null;
    const actorEmail = String(req.auth?.user?.email || req.auth?.email || "").trim().toLowerCase();

    const offerLetter = await OfferLetter.findOneAndUpdate(
      {
        _id: id,
        status: OFFER_LETTER_STATUSES.SENT,
        employeeId: null,
      },
      {
        $set: {
          status: OFFER_LETTER_STATUSES.WITHDRAWN,
          decisionAt: withdrawnAt,
          withdrawal: {
            reason,
            withdrawnAt,
            withdrawnBy: actorId,
            withdrawnByEmail: actorEmail,
          },
          signingTokenHash: null,
          signingTokenEncrypted: null,
          signingTokenExpiresAt: null,
          updatedAt: withdrawnAt,
        },
      },
      { returnDocument: "after" }
    );

    if (!offerLetter) {
      const current = await OfferLetter.findById(id).lean();
      if (!current) {
        throw new HttpError(404, "Offer letter not found.");
      }
      if (current.status === OFFER_LETTER_STATUSES.WITHDRAWN) {
        return res.json({
          success: true,
          message: "This offer letter has already been withdrawn.",
          offerLetter: current,
          alreadyWithdrawn: true,
        });
      }
      if (current.status === OFFER_LETTER_STATUSES.ACCEPTED) {
        throw new HttpError(
          409,
          "The candidate signed this offer before withdrawal could complete. Withdrawal was not applied."
        );
      }
      throw new HttpError(
        409,
        `Unable to withdraw offer in status '${current.status}'. Refresh and try again if still eligible.`
      );
    }

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_WITHDRAWN, offerLetter._id, {
        reason,
        withdrawnAt,
        previousStatus: OFFER_LETTER_STATUSES.SENT,
        candidateEmail: offerLetter.candidate?.email,
        position: offerLetter.position,
      });
    }

    res.json({
      success: true,
      message: "Offer letter withdrawn. The candidate can no longer sign this offer.",
      offerLetter,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download offer letter as PDF
 */
export async function downloadOfferLetterPdf(req, res, next) {
  try {
    const { OfferLetter, connection } = req.auth.models;
    const { id } = req.params;
    const asDocx = String(req.query.format || "").toLowerCase() === "docx";

    if (asDocx) {
      throw new HttpError(400, "DOCX download is no longer available. Use the PDF download.");
    }

    const offerLetter = await OfferLetter.findById(id).lean();
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    const safeName = (offerLetter.candidate?.fullName || "Candidate")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    // Accepted offers: serve the signed PDF (HR + candidate signatures). The issued PDF stays untouched.
    if (offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED && offerLetter.signature?.signedAt) {
      const signed = await getOrCreateSignedPdf({
        OfferLetter,
        offerLetterId: offerLetter._id,
        connection,
      });
      if (signed?.buffer?.length) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Offer_Letter_${safeName}_signed.pdf"`
        );
        res.setHeader("Content-Length", signed.buffer.length);
        return res.end(signed.buffer);
      }
    }

    // Prefer immutable issued PDF from GridFS; if the blob is missing, fall through and regenerate.
    if (getStorageFileId(offerLetter.generatedPdf)) {
      try {
        const streamed = await streamIssuedPdfToResponse({
          offerLetter,
          connection,
          res,
          downloadName: `Offer_Letter_${safeName}.pdf`,
        });
        if (streamed) return;
      } catch (storedErr) {
        if (!(storedErr instanceof HttpError && storedErr.status === 404)) {
          throw storedErr;
        }
        console.warn(
          "[offerLetterController] Issued PDF missing on download; regenerating:",
          storedErr.message
        );
      }
    }

    // Never re-render from live master/company after issue: use frozen issuedContent
    // (DRAFT offers fall back to the current draft content).
    let htmlContent = offerLetter.issuedContent || offerLetter.content || "";
    let signatureAppended = false;
    if (
      offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED &&
      offerLetter.signature?.signerName
    ) {
      htmlContent = appendSignatureBlockToHtml(htmlContent, offerLetter.signature);
      signatureAppended = true;
    }
    if (!htmlContent) {
      throw new HttpError(400, "Offer letter has no rendered content to export.");
    }
    const pdfBuffer = await pdfBufferFromHtml(htmlContent);

    // Persist issued PDF for sent (unsigned) offers; never store a signed variant as the issued PDF.
    if (offerLetter.status !== OFFER_LETTER_STATUSES.DRAFT && !signatureAppended) {
      await storeIssuedPdfIfNeeded({
        OfferLetter,
        offerLetter,
        pdfBuffer,
        connection,
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Offer_Letter_${safeName}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete draft offer letter
 */
export async function deleteOfferLetter(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;
    const { id } = req.params;

    const offerLetter = await OfferLetter.findById(id);
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (offerLetter.status !== OFFER_LETTER_STATUSES.DRAFT) {
      throw new HttpError(
        400,
        `Cannot delete an offer letter with status '${offerLetter.status}'. Only DRAFT offers can be deleted.`
      );
    }

    await OfferLetter.deleteOne({ _id: offerLetter._id });

    res.json({
      success: true,
      message: "Draft offer letter deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Link an accepted offer letter to an existing employee record
 */
export async function linkEmployeeToOffer(req, res, next) {
  try {
    const { OfferLetter, Employee, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { employeeId } = req.body || {};

    if (!employeeId) {
      throw new HttpError(400, "Employee ID is required to link.");
    }

    const offerLetter = await OfferLetter.findById(id);
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    if (offerLetter.status !== OFFER_LETTER_STATUSES.ACCEPTED) {
      throw new HttpError(
        400,
        `Only ACCEPTED offer letters can be linked to an employee. Current status is '${offerLetter.status}'.`
      );
    }

    if (offerLetter.employeeId) {
      throw new HttpError(
        400,
        "This offer letter is already linked to an employee record."
      );
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    assertEmployeeInScope(
      req.hrAccess,
      employee._id,
      "You do not have access to link this employee."
    );

    offerLetter.employeeId = employee._id;
    offerLetter.updatedAt = new Date();
    await offerLetter.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_LINKED, offerLetter._id, {
        employeeId: employee._id,
        employeeCode: employee.employeeCode,
      });
    }

    res.json({
      success: true,
      message: `Offer letter successfully linked to employee ${employee.fullName} (${employee.employeeCode}).`,
      offerLetter,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Send offer letter via Gmail SMTP to candidate's email address with attached PDF
 */
export async function sendOfferLetterEmail(req, res, next) {
  try {
    const { OfferLetter, AuditLog } = req.auth.models;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid offer letter ID.");
    }

    const offerLetter = await OfferLetter.findById(id).select("+signingTokenEncrypted");
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    // Terminal state protection — never alter signature / decision state via send
    if (
      offerLetter.status === OFFER_LETTER_STATUSES.ACCEPTED ||
      offerLetter.status === OFFER_LETTER_STATUSES.REJECTED ||
      offerLetter.status === OFFER_LETTER_STATUSES.WITHDRAWN
    ) {
      throw new HttpError(
        400,
        `Cannot send an offer letter with status '${offerLetter.status}'. This offer is no longer open for delivery.`
      );
    }

    // An HR electronic signature must be saved in Settings before any offer goes out so the
    // frozen issuedContent / issued PDF carries it. Re-check immediately before send/resend.
    const companyIdForSig = req.auth.company?._id;
    if (!(await companyHasHrSignature(companyIdForSig))) {
      throw new HttpError(400, HR_SIGNATURE_REQUIRED_MESSAGE, { code: "HR_SIGNATURE_REQUIRED" });
    }
    const hrSigProbe = await loadCompanySignature({ _id: companyIdForSig });
    if (!hrSigProbe?.dataUrl && !(hrSigProbe?.method === "TYPE" && hrSigProbe?.typedText)) {
      throw new HttpError(400, HR_SIGNATURE_REQUIRED_MESSAGE, { code: "HR_SIGNATURE_REQUIRED" });
    }

    const priorStatus = offerLetter.status;
    const priorSignature = offerLetter.signature
      ? JSON.parse(JSON.stringify(offerLetter.signature))
      : undefined;
    const priorTokenHash = offerLetter.signingTokenHash || null;
    const priorTokenExpiry = offerLetter.signingTokenExpiresAt || null;
    const priorTokenEncrypted = offerLetter.signingTokenEncrypted || null;

    const candidateEmail = offerLetter.candidate?.email?.trim();
    if (!candidateEmail || !isValidEmail(candidateEmail)) {
      throw new HttpError(400, "Candidate email address is missing or invalid.");
    }

    if (!offerLetter.candidate?.fullName || !offerLetter.position || !offerLetter.monthlySalary) {
      throw new HttpError(400, "Offer letter details are incomplete and cannot be sent.");
    }

    const { connection } = req.auth.models;

    // Freeze the legal document on first send. Resends reuse issuedContent verbatim and
    // never re-render from the live master or current company letterhead.
    if (!offerLetter.issuedContent) {
      if (
        offerLetter.status === OFFER_LETTER_STATUSES.SENT &&
        String(offerLetter.content || "").trim()
      ) {
        // Legacy already-sent offer (pre-freeze): preserve the exact document the candidate received.
        offerLetter.issuedContent = offerLetter.content;
      } else {
        const company = await loadOfferRenderCompany(req);
        // Freeze the HR signature into the snapshot + issuedContent. It is never re-read from
        // the live company afterwards (later settings changes cannot alter an issued offer).
        const hrSig = await loadCompanySignature(company);
        if (!hrSig?.dataUrl && !(hrSig?.method === "TYPE" && hrSig?.typedText)) {
          throw new HttpError(400, HR_SIGNATURE_REQUIRED_MESSAGE, { code: "HR_SIGNATURE_REQUIRED" });
        }
        const signatoryName =
          String(company?.letterhead?.signatoryName || "").trim() ||
          String(offerLetter?.offerDataSnapshot?.signatoryName || "").trim() ||
          String(company?.primaryContact?.fullName || "").trim();
        const frozenData = {
          ...buildOfferDataFromSources(offerLetter),
          ...(signatoryName ? { signatoryName } : {}),
          hrSignatureDataUrl: hrSig.dataUrl || "",
          hrTypedSignature: hrSig.dataUrl ? "" : hrSig.typedText || "",
        };
        const html = await renderStandardOfferHtml({ offerData: frozenData, company });
        // Prove the signature is actually in the HTML that will be frozen/PDF'd — not just a DB flag.
        const hasEmbeddedSig =
          html.includes('class="sig-img"') ||
          html.includes('class="sig-typed"') ||
          (hrSig.dataUrl && html.includes("data:image/"));
        if (!hasEmbeddedSig) {
          throw new HttpError(
            500,
            "Offer PDF could not embed the HR signature. Re-save the signature in Settings and try again.",
            { code: "HR_SIGNATURE_EMBED_FAILED" }
          );
        }
        offerLetter.content = html;
        offerLetter.issuedContent = html;
        offerLetter.offerDataSnapshot = frozenData;
        offerLetter.markModified("offerDataSnapshot");
        offerLetter.templateId = null;
        offerLetter.templateVersion = null;
        offerLetter.templateType = null;
      }
      await offerLetter.save();
    }

    // Prefer previously issued PDF (immutable). If GridFS ref is stale/missing, regenerate
    // from the frozen issuedContent. Status eligibility: ACCEPTED / REJECTED / WITHDRAWN blocked above.
    let pdfBuffer = null;
    const docxAttachment = null;
    try {
      if (getStorageFileId(offerLetter.generatedPdf)) {
        try {
          const stored = await getIssuedPdfDownload({
            offerLetter,
            connection,
          });
          pdfBuffer = stored?.buffer || null;
        } catch (storedErr) {
          console.warn(
            "[offerLetterController] Issued PDF unavailable for send/resend; regenerating:",
            storedErr.message
          );
          pdfBuffer = null;
        }
      }
      if (!pdfBuffer) {
        pdfBuffer = await pdfBufferFromHtml(offerLetter.issuedContent || offerLetter.content);
      }
    } catch (pdfErr) {
      console.error("[offerLetterController] PDF generation error:", pdfErr.message);
      throw new HttpError(500, `Failed to generate offer letter PDF attachment: ${pdfErr.message}`);
    }

    if ((!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) && !docxAttachment) {
      throw new HttpError(500, "Offer letter PDF attachment is missing or empty.");
    }

    if (pdfBuffer && !getStorageFileId(offerLetter.generatedPdf)) {
      await storeIssuedPdfIfNeeded({
        OfferLetter,
        offerLetter,
        pdfBuffer,
        connection,
      });
      const refreshed = await OfferLetter.findById(offerLetter._id).lean();
      if (refreshed?.generatedPdf) offerLetter.generatedPdf = refreshed.generatedPdf;
    }

    const companyName = req.auth.company?.companyName || req.auth.company?.name || "Company";

    const { CompanyHrPolicy } = req.auth.models;
    const policy = CompanyHrPolicy ? await getActiveCompanyHrPolicy(CompanyHrPolicy) : null;
    const validityDays = policy?.recruitmentRules?.offerValidityDays || 7;

    const {
      signingToken,
      tokenHash,
      tokenExpiresAt,
      reused: tokenReused,
    } = resolveOfferSigningTokenForSend({
      offerLetter,
      companyId: req.auth.company._id,
      candidateEmail,
      validityDays,
    });

    const clientUrl =
      process.env.CLIENT_URL ||
      process.env.APP_BASE_URL ||
      `${req.protocol}://${req.get("host")}`;
    const reviewLink = `${clientUrl}/offers/review/${signingToken}`;

    // Initialize delivery record if missing (needed for attempt diagnostics before SMTP)
    if (!offerLetter.emailDelivery) {
      offerLetter.emailDelivery = {
        status: "NOT_SENT",
        attempts: 0,
        history: [],
      };
    }
    const nextAttempt = (offerLetter.emailDelivery.attempts || 0) + 1;
    const sendStartedAt = Date.now();

    // Dispatch email (PDF preferred; filled DOCX when LibreOffice convert is not configured)
    const emailResult = await emailService.sendOfferLetter({
      companyName,
      candidateName: offerLetter.candidate.fullName,
      candidateEmail,
      position: offerLetter.position,
      pdfBuffer,
      docxBuffer: docxAttachment,
      joiningDate: offerLetter.joiningDate,
      monthlySalary: offerLetter.monthlySalary,
      reviewLink,
      company: req.auth.company,
      attempt: nextAttempt,
    });

    if (process.env.NODE_ENV !== "test") {
      console.log(
        "[offerLetterController] send/resend SMTP result",
        JSON.stringify({
          tenantId: String(req.auth.company?._id || ""),
          offerId: String(offerLetter._id),
          attempt: nextAttempt,
          tokenReused: Boolean(tokenReused),
          success: Boolean(emailResult?.success),
          messageId: emailResult?.messageId || null,
          responseCode: emailResult?.responseCode ?? null,
          durationMs: emailResult?.durationMs ?? Date.now() - sendStartedAt,
          error: emailResult?.success ? null : emailResult?.error || null,
        })
      );
    }

    const safeDeliveryError = emailResult.success
      ? ""
      : String(emailResult.error || "Email delivery failed").slice(0, 500);

    const attemptRecord = {
      sentAt: new Date(),
      recipient: candidateEmail,
      status: emailResult.success ? "SENT" : "DELIVERY_FAILED",
      messageId: emailResult.messageId || "",
      error: safeDeliveryError,
    };

    offerLetter.emailDelivery.attempts = (offerLetter.emailDelivery.attempts || 0) + 1;
    offerLetter.emailDelivery.sentTo = candidateEmail;
    offerLetter.emailDelivery.history.push(attemptRecord);

    if (!emailResult.success) {
      // Restore prior signing link — never invalidate a working token on SMTP failure
      offerLetter.signingTokenHash = priorTokenHash;
      offerLetter.signingTokenExpiresAt = priorTokenExpiry;
      offerLetter.signingTokenEncrypted = priorTokenEncrypted;
      offerLetter.status = priorStatus;
      if (priorSignature !== undefined) {
        offerLetter.signature = priorSignature;
      }
      offerLetter.emailDelivery.status = "DELIVERY_FAILED";
      offerLetter.emailDelivery.error = safeDeliveryError;
      await offerLetter.save();

      if (AuditLog) {
        await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_SEND_FAILED, offerLetter._id, {
          candidateEmail,
          error: safeDeliveryError,
          responseCode: emailResult.responseCode ?? null,
        });
      }

      return res.status(502).json({
        success: false,
        message: `Failed to deliver offer letter email to ${candidateEmail}: ${safeDeliveryError}`,
        offerLetter,
      });
    }

    // Commit signing token only after SMTP acceptance
    offerLetter.signingTokenHash = tokenHash;
    offerLetter.signingTokenExpiresAt = tokenExpiresAt;
    try {
      offerLetter.signingTokenEncrypted = encryptSecret(signingToken);
    } catch (encErr) {
      console.error(
        "[offerLetterController] Failed to encrypt signing token for reuse:",
        encErr.message
      );
      // Hash/expiry still committed so the emailed link works; reuse on next resend may mint new.
      offerLetter.signingTokenEncrypted = priorTokenEncrypted;
    }

    // Mark as SENT (do not create duplicate offers; leave signature untouched)
    offerLetter.status = OFFER_LETTER_STATUSES.SENT;
    offerLetter.emailedAt = new Date();
    offerLetter.issuedAt = offerLetter.issuedAt || new Date();
    offerLetter.emailDelivery.status = "SENT";
    offerLetter.emailDelivery.sentAt = new Date();
    offerLetter.emailDelivery.messageId = emailResult.messageId || "";
    offerLetter.emailDelivery.error = "";
    offerLetter.updatedAt = new Date();

    await offerLetter.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_SENT, offerLetter._id, {
        candidateEmail,
        messageId: emailResult.messageId,
        sentAt: offerLetter.emailDelivery.sentAt,
        tokenReused: Boolean(tokenReused),
      });
    }

    return res.json({
      success: true,
      message: `Offer letter successfully sent to ${candidateEmail}.`,
      offerLetter,
      reviewLink,
      signingToken,
      tokenReused: Boolean(tokenReused),
    });
  } catch (error) {
    next(error);
  }
}


import { HttpError } from "../utils/httpError.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import {
  DEFAULT_OFFER_CLAUSES,
  renderOfferLetterHtml,
} from "../services/offerTemplateService.js";
import { generateOfferLetterPdf } from "../services/pdfService.js";

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
 * Get summary counters for Offer Letters management page
 */
export async function getOfferSummary(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;

    const [total, draft, sent, accepted, rejected] = await Promise.all([
      OfferLetter.countDocuments({}),
      OfferLetter.countDocuments({ status: OFFER_LETTER_STATUSES.DRAFT }),
      OfferLetter.countDocuments({ status: OFFER_LETTER_STATUSES.SENT }),
      OfferLetter.countDocuments({ status: OFFER_LETTER_STATUSES.ACCEPTED }),
      OfferLetter.countDocuments({ status: OFFER_LETTER_STATUSES.REJECTED }),
    ]);

    res.json({
      success: true,
      summary: {
        total,
        draft,
        sent,
        accepted,
        rejected,
      },
    });
  } catch (error) {
    next(error);
  }
}

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
        .populate("employeeId", "fullName employeeCode email status")
        .populate("createdBy", "email role")
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
      issuedAt: offer.issuedAt || null,
      decisionAt: offer.decisionAt || null,
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
      .populate("employeeId", "fullName employeeCode email job status")
      .populate("createdBy", "email role")
      .lean();

    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    res.json({
      success: true,
      offerLetter,
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
      clauses: Array.isArray(clauses) && clauses.length > 0 ? clauses : DEFAULT_OFFER_CLAUSES,
      createdAt: new Date(),
    };

    const renderedHtml = renderOfferLetterHtml(offerData, req.auth.company);

    res.json({
      success: true,
      html: renderedHtml,
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
    const { OfferLetter, AuditLog } = req.auth.models;
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
    };

    const renderedHtml = renderOfferLetterHtml(offerData, req.auth.company);

    const newOffer = await OfferLetter.create({
      ...offerData,
      content: renderedHtml,
      status: OFFER_LETTER_STATUSES.DRAFT,
      createdBy: req.auth.user._id,
    });

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.OFFER_LETTER_CREATED, newOffer._id, {
        candidate: candidateClean,
        position: newOffer.position,
        monthlySalary: salaryNum,
        joiningDate: newOffer.joiningDate,
        status: newOffer.status,
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
    const { OfferLetter, AuditLog } = req.auth.models;
    const { id } = req.params;
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

    // Re-render HTML content deterministically
    const renderedHtml = renderOfferLetterHtml(offerLetter, req.auth.company);
    offerLetter.content = renderedHtml;
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
 * Manually update status of an offer letter (DRAFT -> SENT, ACCEPTED, REJECTED)
 */
export async function updateOfferStatus(req, res, next) {
  try {
    const { OfferLetter, AuditLog } = req.auth.models;
    const { id } = req.params;
    const { status, decisionNotes } = req.body || {};

    const cleanStatus = String(status || "").toUpperCase().trim();
    if (!Object.values(OFFER_LETTER_STATUSES).includes(cleanStatus)) {
      throw new HttpError(
        400,
        `Invalid status '${status}'. Must be DRAFT, SENT, ACCEPTED, or REJECTED.`
      );
    }

    const offerLetter = await OfferLetter.findById(id);
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    const oldStatus = offerLetter.status;

    // Disallow moving backward from issued or decided states to DRAFT
    if (cleanStatus === OFFER_LETTER_STATUSES.DRAFT && oldStatus !== OFFER_LETTER_STATUSES.DRAFT) {
      throw new HttpError(
        400,
        `Cannot revert an offer letter in '${oldStatus}' status back to DRAFT.`
      );
    }

    offerLetter.status = cleanStatus;

    if (cleanStatus === OFFER_LETTER_STATUSES.SENT) {
      offerLetter.issuedAt = new Date();
    } else if (
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
 * Download offer letter as PDF
 */
export async function downloadOfferLetterPdf(req, res, next) {
  try {
    const { OfferLetter } = req.auth.models;
    const { id } = req.params;

    const offerLetter = await OfferLetter.findById(id).lean();
    if (!offerLetter) {
      throw new HttpError(404, "Offer letter not found.");
    }

    // Generate real PDF buffer using server-side Puppeteer renderer
    const pdfBuffer = await generateOfferLetterPdf(offerLetter.content);

    const safeName = (offerLetter.candidate?.fullName || "Candidate")
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Offer_Letter_${safeName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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

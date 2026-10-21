import crypto from "node:crypto";
import fs from "node:fs";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { USER_ROLES, ONBOARDING_STATUSES } from "../models/User.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { TOKEN_TYPES } from "../models/AuthToken.js";
import { emailService } from "../services/emailService.js";
import { getDocumentAbsolutePath } from "../services/documentStorage.js";
import {
  signCandidateOnboardingToken,
  signEmployeeActivationToken,
} from "../utils/onboardingToken.js";

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * List all candidate onboarding submissions with status filter, search, and pagination
 */
export async function getOnboardingSubmissions(req, res, next) {
  try {
    const { User } = req.auth.models;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";

    const query = {
      "onboarding.status": { $exists: true, $ne: null },
    };

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

    const [total, candidateUsers] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .populate(
          "onboarding.offerLetterId",
          "position department monthlySalary annualSalary joiningDate status signature"
        )
        .populate("onboarding.employeeId", "fullName employeeCode email status")
        .populate("onboarding.approvedBy", "email role")
        .populate("onboarding.rejectedBy", "email role")
        .sort({ "onboarding.submittedAt": -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const submissions = candidateUsers.map((u) => {
      const ob = u.onboarding || {};
      return {
        _id: u._id,
        candidateUserId: u._id,
        candidate: ob.candidate || { email: u.email },
        candidateName: ob.candidate?.fullName || ob.personalDetails?.fullName || "",
        candidateEmail: ob.candidate?.email || u.email,
        status: ob.status || ONBOARDING_STATUSES.DRAFT,
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
        submittedAt: ob.submittedAt || null,
        reviewedAt: ob.reviewedAt || null,
        approvedAt: ob.approvedAt || null,
        approvedBy: ob.approvedBy || null,
        rejectedAt: ob.rejectedAt || null,
        rejectedBy: ob.rejectedBy || null,
        employeeId: ob.employeeId || null,
        history: ob.history || [],
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    });

    res.json({
      success: true,
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
      .populate("onboarding.offerLetterId")
      .populate("onboarding.employeeId", "fullName employeeCode email status")
      .populate("onboarding.reviewedBy", "email role")
      .populate("onboarding.approvedBy", "email role")
      .populate("onboarding.rejectedBy", "email role")
      .lean();

    if (!candidateUser || !candidateUser.onboarding) {
      throw new HttpError(404, "Onboarding submission not found.");
    }

    const ob = candidateUser.onboarding;
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
      submittedAt: ob.submittedAt,
      reviewedAt: ob.reviewedAt,
      reviewedBy: ob.reviewedBy,
      approvedAt: ob.approvedAt,
      approvedBy: ob.approvedBy,
      rejectedAt: ob.rejectedAt || null,
      rejectedBy: ob.rejectedBy || null,
      employeeId: ob.employeeId,
      history: ob.history || [],
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

    if (candidateUser.onboarding.status === ONBOARDING_STATUSES.APPROVED) {
      throw new HttpError(400, "This onboarding has already been approved and cannot be updated.");
    }

    const cleanReason = reason.trim();
    candidateUser.onboarding.status = ONBOARDING_STATUSES.CHANGES_REQUESTED;
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

    const serializedOnboarding = {
      _id: candidateUser._id,
      ...(candidateUser.onboarding.toObject ? candidateUser.onboarding.toObject() : candidateUser.onboarding),
    };

    res.json({
      success: true,
      message: "Correction request sent to candidate successfully.",
      onboarding: serializedOnboarding,
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
      candidateUser.onboarding.status === ONBOARDING_STATUSES.APPROVED ||
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

    const serializedOnboarding = {
      _id: candidateUser._id,
      ...(candidateUser.onboarding.toObject ? candidateUser.onboarding.toObject() : candidateUser.onboarding),
    };

    res.json({
      success: true,
      message: "Candidate onboarding has been rejected.",
      onboarding: serializedOnboarding,
      emailDelivered: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Stage 5: Approval-Driven Employee Creation
 * Strictly executes after HR approves complete, signed, and reviewed onboarding
 */
export async function approveOnboardingAndCreateEmployee(req, res, next) {
  try {
    const {
      User,
      OfferLetter,
      Employee,
      EmployeeCompensation,
      AuthToken,
      AuditLog,
    } = req.auth.models;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid onboarding submission ID.");
    }

    // 1. Atomically acquire approval lock on this candidate user to prevent concurrent duplicate employee creation
    let candidateUser = await User.findOneAndUpdate(
      {
        _id: id,
        "onboarding.status": ONBOARDING_STATUSES.SUBMITTED,
        employeeId: null,
        "onboarding.employeeId": null,
      },
      {
        $set: {
          "onboarding.status": "PROCESSING_APPROVAL",
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
        existing.onboarding.status === ONBOARDING_STATUSES.APPROVED ||
        existing.employeeId ||
        existing.onboarding.employeeId
      ) {
        throw new HttpError(409, "This candidate has already been approved and created as an employee.");
      }
      if (existing.onboarding.status === "PROCESSING_APPROVAL") {
        throw new HttpError(409, "This candidate onboarding approval is currently in progress.");
      }
      throw new HttpError(
        400,
        `Cannot approve onboarding with status '${existing.onboarding.status}'. Only SUBMITTED onboarding can be approved.`
      );
    }

    // Helper to revert atomic lock if validation or creation fails
    const revertApprovalLock = async () => {
      try {
        await User.updateOne(
          { _id: candidateUser._id, "onboarding.status": "PROCESSING_APPROVAL" },
          { $set: { "onboarding.status": ONBOARDING_STATUSES.SUBMITTED } }
        );
      } catch {}
    };

    // 2. Verify offer is signed and valid
    const offerLetter = await OfferLetter.findById(candidateUser.onboarding.offerLetterId);
    if (!offerLetter) {
      await revertApprovalLock();
      throw new HttpError(404, "Linked offer letter was not found.");
    }

    if (offerLetter.status !== OFFER_LETTER_STATUSES.ACCEPTED || !offerLetter.signature?.signedAt) {
      await revertApprovalLock();
      throw new HttpError(
        400,
        "Cannot approve onboarding: Linked offer letter has not been electronically signed and accepted by the candidate."
      );
    }

    const candidateEmail = (offerLetter.candidate?.email || candidateUser.email).trim().toLowerCase();

    if (offerLetter.convertedToEmployeeAt) {
      await revertApprovalLock();
      throw new HttpError(409, "This offer letter has already been converted to an employee profile.");
    }

    if (offerLetter.employeeId) {
      const linkedEmployee = await Employee.findById(offerLetter.employeeId);
      if (
        linkedEmployee &&
        (String(linkedEmployee.userId) === String(candidateUser._id) ||
          linkedEmployee.email.toLowerCase() === candidateEmail)
      ) {
        await revertApprovalLock();
        throw new HttpError(409, "This offer letter has already been converted to an employee profile.");
      }
    }

    // 3. Verify required onboarding information is complete
    const pd = candidateUser.onboarding.personalDetails || {};
    const addr = candidateUser.onboarding.residentialAddress || {};
    const ec = candidateUser.onboarding.emergencyContact || {};
    const bd = candidateUser.onboarding.bankDetails || {};
    const td = candidateUser.onboarding.taxDetails || {};

    if (!pd.fullName?.trim() || !pd.phoneNumber?.trim() || !pd.dateOfBirth) {
      await revertApprovalLock();
      throw new HttpError(400, "Candidate personal details are incomplete and cannot be approved.");
    }
    if (!addr.street?.trim() || !addr.city?.trim() || !addr.state?.trim() || !addr.postalCode?.trim()) {
      await revertApprovalLock();
      throw new HttpError(400, "Candidate residential address is incomplete and cannot be approved.");
    }
    if (!ec.name?.trim() || !ec.phone?.trim()) {
      await revertApprovalLock();
      throw new HttpError(400, "Candidate emergency contact details are incomplete and cannot be approved.");
    }
    if (!bd.accountNumber?.trim() || !bd.ifscCode?.trim()) {
      await revertApprovalLock();
      throw new HttpError(400, "Candidate bank details are incomplete and cannot be approved.");
    }
    if (!td.panNumber?.trim()) {
      await revertApprovalLock();
      throw new HttpError(400, "Candidate tax / PAN details are incomplete and cannot be approved.");
    }

    // 4. Generate unique employee code using project conventions
    const companySlug = req.auth.company?.slug || "EMP";
    const prefix = companySlug.substring(0, 3).toUpperCase();
    const count = await Employee.countDocuments({});
    let nextNum = count + 1;
    let employeeCode = `${prefix}-${String(nextNum).padStart(3, "0")}`;
    while (await Employee.findOne({ employeeCode })) {
      nextNum++;
      employeeCode = `${prefix}-${String(nextNum).padStart(3, "0")}`;
    }

    // Prevent duplicate email collision in employees collection
    const existingEmployee = await Employee.findOne({
      $or: [{ email: candidateEmail }, { userId: candidateUser._id }],
    });
    if (existingEmployee) {
      await revertApprovalLock();
      throw new HttpError(409, `An employee record with email '${candidateEmail}' already exists in this workspace.`);
    }

    // 5. Map verified onboarding data to Employee document
    const employeeDocs = (candidateUser.onboarding.documents || []).map((doc) => ({
      documentType: doc.documentType === "ID_PROOF" ? "ID_PROOF" : "OTHER",
      title: doc.title,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      storageKey: doc.storageKey,
      uploadedBy: req.auth.user._id,
      uploadedByRole: "HR_ADMIN",
      createdAt: doc.uploadedAt || new Date(),
    }));

    const employeePayload = {
      employeeCode,
      fullName: pd.fullName.trim(),
      preferredName: pd.preferredName?.trim() || "",
      email: candidateEmail,
      phoneNumber: pd.phoneNumber.trim(),
      personalEmail: pd.email ? pd.email.trim().toLowerCase() : candidateEmail,
      personalPhone: pd.personalPhone?.trim() || "",
      dateOfBirth: new Date(pd.dateOfBirth),
      gender: pd.gender?.trim() || "Not specified",
      city: pd.city?.trim() || offerLetter.workLocation || "",
      status: EMPLOYEE_STATUSES.ACTIVE,
      userId: candidateUser._id,
      job: {
        jobTitle: offerLetter.position,
        department: offerLetter.department || "",
        employmentType: offerLetter.employmentType || "Full-time Permanent",
        workLocation: offerLetter.workLocation || "",
        joiningDate: offerLetter.joiningDate || new Date(),
        reportingManagerId: offerLetter.reportingManager || null,
        project: {
          projectName: "",
          projectType: "MANDATE",
        },
      },
      residentialAddress: {
        street: addr.street.trim(),
        city: addr.city.trim(),
        state: addr.state.trim(),
        postalCode: addr.postalCode.trim(),
        country: addr.country?.trim() || "India",
      },
      emergencyContact: {
        name: ec.name.trim(),
        relationship: ec.relationship?.trim() || "Contact",
        phone: ec.phone.trim(),
      },
      bankDetails: {
        accountHolderName: bd.accountHolderName?.trim() || pd.fullName.trim(),
        bankName: bd.bankName?.trim() || "",
        accountNumber: bd.accountNumber?.trim() || "",
        ifscCode: bd.ifscCode?.trim() || "",
        accountType: bd.accountType?.trim() || "Salary Account",
      },
      taxDetails: {
        panNumber: td.panNumber?.trim() || "",
        taxRegime: td.taxRegime?.trim() || "New Tax Regime (Sec 115BAC)",
      },
      identityDetails: {
        idType: candidateUser.onboarding.identityDetails?.idType || "PAN / Aadhaar",
        idNumber: candidateUser.onboarding.identityDetails?.idNumber || td.panNumber?.trim() || "",
        isVerified: true,
      },
      documents: employeeDocs,
      schemaVersion: 1,
    };

    // 6. Transactional execution with safe compensating rollback
    let session = null;
    let useTransaction = false;
    const connection = req.auth.models.connection || User.db;
    const topologyType = connection?.client?.topology?.description?.type;
    const supportsTransactions =
      topologyType === "ReplicaSetWithPrimary" ||
      topologyType === "Sharded" ||
      topologyType === "LoadBalanced";

    if (supportsTransactions && typeof connection.startSession === "function") {
      try {
        session = await connection.startSession();
        session.startTransaction();
        useTransaction = true;
      } catch {
        if (session) {
          try {
            await session.endSession();
          } catch {}
          session = null;
        }
        useTransaction = false;
      }
    }

    let newEmployee = null;
    let newComp = null;
    const monthlySalary = offerLetter.monthlySalary;

    try {
      const sessionOpt = useTransaction && session ? { session } : {};

      const [createdEmp] = await Employee.create([employeePayload], sessionOpt);
      newEmployee = createdEmp;

      if (monthlySalary && EmployeeCompensation) {
        const basic = Math.round(monthlySalary * 0.5);
        const hra = Math.round(monthlySalary * 0.25);
        const conveyance = Math.round(monthlySalary * 0.1);
        const special = Math.round(monthlySalary * 0.15);

        const [createdComp] = await EmployeeCompensation.create(
          [
            {
              employeeId: newEmployee._id,
              revisions: [
                {
                  effectiveFromDate: offerLetter.joiningDate || new Date(),
                  monthlyCostToCompany: mongoose.Types.Decimal128.fromString(monthlySalary.toFixed(2)),
                  salaryComponents: {
                    basicSalary: mongoose.Types.Decimal128.fromString(basic.toFixed(2)),
                    houseRentAllowance: mongoose.Types.Decimal128.fromString(hra.toFixed(2)),
                    conveyanceAllowance: mongoose.Types.Decimal128.fromString(conveyance.toFixed(2)),
                    specialAllowance: mongoose.Types.Decimal128.fromString(special.toFixed(2)),
                  },
                  revisedBy: req.auth.user._id,
                  revisedAt: new Date(),
                },
              ],
              schemaVersion: 1,
            },
          ],
          sessionOpt
        );
        newComp = createdComp;
      }

      // Link offer letter to created employee
      offerLetter.employeeId = newEmployee._id;
      offerLetter.candidateUserId = candidateUser._id;
      await offerLetter.save(sessionOpt);

      // Update candidate user: link employee, update role, invalidate candidate token
      candidateUser.role = USER_ROLES.EMPLOYEE;
      candidateUser.isActive = false; // Inactive until Stage 6 activation
      candidateUser.employeeId = newEmployee._id;
      candidateUser.onboarding.employeeId = newEmployee._id;
      candidateUser.onboarding.status = ONBOARDING_STATUSES.APPROVED;
      candidateUser.onboarding.approvedAt = new Date();
      candidateUser.onboarding.approvedBy = req.auth.user._id;
      candidateUser.onboarding.onboardingTokenHash = null; // Invalidate candidate onboarding token upon approval
      candidateUser.onboarding.tokenExpiresAt = null;
      candidateUser.onboarding.history.push({
        action: "APPROVED",
        timestamp: new Date(),
        actorRole: "HR_ADMIN",
        notes: `Approved by HR. Employee profile created with code ${employeeCode}.`,
      });
      await candidateUser.save(sessionOpt);

      if (useTransaction && session) {
        await session.commitTransaction();
        await session.endSession();
        session = null;
      }
    } catch (createErr) {
      if (useTransaction && session) {
        try {
          await session.abortTransaction();
        } catch {}
        try {
          await session.endSession();
        } catch {}
        session = null;
      } else {
        // Safe compensating recovery for standalone/non-transactional databases
        if (newEmployee) {
          try {
            await Employee.deleteOne({ _id: newEmployee._id });
          } catch {}
        }
        if (newComp) {
          try {
            await EmployeeCompensation.deleteOne({ _id: newComp._id });
          } catch {}
        }
      }
      await revertApprovalLock();
      throw createErr;
    }

    // 10. Generate Employee Activation Token (Stage 6)
    const activationToken = signEmployeeActivationToken({
      companyId: req.auth.company._id,
      employeeId: newEmployee._id,
      userId: candidateUser._id,
      email: candidateEmail,
    });

    if (AuthToken) {
      await AuthToken.create({
        userId: candidateUser._id,
        email: candidateEmail,
        token: activationToken,
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

    // 11. Dispatch Account Activation Email
    let activationEmailSent = false;
    let emailError = "";
    try {
      const emailResult = await emailService.sendEmployeeActivationEmail({
        companyName: req.auth.company?.companyName || "Our Organization",
        employeeName: newEmployee.fullName,
        email: candidateEmail,
        activationLink,
        employeeCode,
      });
      activationEmailSent = Boolean(emailResult.success);
      if (!emailResult.success) {
        emailError = emailResult.error || "Email delivery failed";
      }
    } catch (sendErr) {
      console.error("[onboardingReviewController] Activation email warning:", sendErr.message);
      emailError = sendErr.message;
    }

    // 12. Record Audit Logs
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
            employeeId: newEmployee._id,
            employeeCode,
            activationEmailSent,
          },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });

        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
          targetType: "Employee",
          targetId: newEmployee._id,
          changes: {
            employeeCode,
            fullName: newEmployee.fullName,
            email: newEmployee.email,
            joiningDate: newEmployee.job.joiningDate,
          },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch (auditErr) {
        console.error("[onboardingReviewController] Audit log error:", auditErr.message);
      }
    }

    const serializedOnboarding = {
      _id: candidateUser._id,
      ...(candidateUser.onboarding.toObject ? candidateUser.onboarding.toObject() : candidateUser.onboarding),
    };

    res.status(201).json({
      success: true,
      message: `Onboarding approved successfully. Employee profile created (${employeeCode}) and activation email dispatched.`,
      employee: newEmployee,
      onboarding: serializedOnboarding,
      activationEmailSent,
      emailError: activationEmailSent ? undefined : emailError,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Resend activation email for an already-approved employee
 */
export async function resendEmployeeActivationEmail(req, res, next) {
  try {
    const { Employee, User, AuthToken, AuditLog } = req.auth.models;
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    const user = await User.findOne({ email: employee.email });
    if (!user) {
      throw new HttpError(404, "User account not found for this employee.");
    }

    if (user.isActive && user.lastLoginAt) {
      throw new HttpError(400, "Employee account is already activated and in use.");
    }

    // Invalidate old tokens
    if (AuthToken) {
      await AuthToken.updateMany(
        { email: employee.email, isActive: true },
        { isActive: false, usedAt: new Date() }
      );
    }

    const activationToken = signEmployeeActivationToken({
      companyId: req.auth.company._id,
      employeeId: employee._id,
      userId: user._id,
      email: employee.email,
    });

    if (AuthToken) {
      await AuthToken.create({
        userId: user._id,
        email: employee.email,
        token: activationToken,
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

    const emailResult = await emailService.sendEmployeeActivationEmail({
      companyName: req.auth.company?.companyName || "Our Organization",
      employeeName: employee.fullName,
      email: employee.email,
      activationLink,
      employeeCode: employee.employeeCode,
    });

    if (AuditLog) {
      try {
        await AuditLog.create({
          actorUserId: req.auth.user._id,
          actorEmail: req.auth.user.email,
          actorRole: req.auth.user.role,
          action: AUDIT_ACTIONS.INVITATION_RESENT,
          targetType: "Employee",
          targetId: employee._id,
          changes: { emailResult },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    res.json({
      success: true,
      message: `Activation email resent to ${employee.email}.`,
      deliverySuccess: emailResult.success,
    });
  } catch (error) {
    next(error);
  }
}

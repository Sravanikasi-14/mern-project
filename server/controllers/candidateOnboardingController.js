import crypto from "node:crypto";
import fs from "node:fs";
import mongoose from "mongoose";
import { findCompanyById, getCompanyModels } from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { ONBOARDING_STATUSES, ONBOARDING_DOCUMENT_TYPES } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { saveDocumentFile, getDocumentAbsolutePath } from "../services/documentStorage.js";
import { verifyCandidateOnboardingToken } from "../utils/onboardingToken.js";

/**
 * Shared helper to resolve and strictly verify candidate onboarding token, tenant context,
 * token hash, expiration, and authorization.
 */
export async function resolveAndVerifyCandidateOnboarding(
  token,
  { populateOffer = false, lean = false } = {}
) {
  let payload;
  try {
    payload = verifyCandidateOnboardingToken(token);
  } catch {
    throw new HttpError(400, "This onboarding invitation link is invalid or has expired.");
  }

  const company = await findCompanyById(payload.companyId);
  if (!company) {
    throw new HttpError(404, "Company workspace not found.");
  }

  const models = await getCompanyModels(company);
  const candidateId = payload.userId || payload.onboardingId;
  let query = models.User.findById(candidateId);
  if (populateOffer) {
    query = query.populate("onboarding.offerLetterId");
  }
  if (lean) {
    query = query.lean();
  }
  const user = await query;

  if (!user || !user.onboarding) {
    throw new HttpError(404, "Onboarding record not found.");
  }

  const candidateEmail = user.onboarding.candidate?.email || user.email;
  if (candidateEmail.toLowerCase() !== payload.sub.toLowerCase()) {
    throw new HttpError(403, "You are not authorized to access this onboarding record.");
  }

  // Status check: Rejected onboarding is blocked
  if (user.onboarding.status === ONBOARDING_STATUSES.REJECTED) {
    throw new HttpError(403, "This candidate onboarding has been rejected.");
  }

  // Token expiration verification
  if (!user.onboarding.tokenExpiresAt || new Date() > new Date(user.onboarding.tokenExpiresAt)) {
    throw new HttpError(400, "This onboarding invitation link has expired.");
  }

  // Token hash verification against current active token
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (!user.onboarding.onboardingTokenHash || user.onboarding.onboardingTokenHash !== tokenHash) {
    throw new HttpError(400, "This onboarding invitation link has been replaced or invalidated.");
  }

  return { company, models, user, payload, candidateEmail };
}

/**
 * Retrieve candidate onboarding state and prefilled read-only offer terms
 */
export async function getCandidateOnboarding(req, res, next) {
  try {
    const { token } = req.params;
    const { company, user, candidateEmail } = await resolveAndVerifyCandidateOnboarding(token, {
      populateOffer: true,
      lean: true,
    });

    const offer = user.onboarding.offerLetterId;

    res.json({
      success: true,
      onboarding: {
        _id: user._id,
        candidate: user.onboarding.candidate,
        status: user.onboarding.status,
        candidateName: user.onboarding.candidate?.fullName || "",
        candidateEmail: candidateEmail,
        offerTerms: offer
          ? {
              jobTitle: offer.position,
              position: offer.position,
              department: offer.department,
              workLocation: offer.workLocation,
              monthlySalary: offer.monthlySalary,
              annualSalary: offer.annualSalary,
              joiningDate: offer.joiningDate,
            }
          : {},
        personalDetails: {
          fullName: user.onboarding.candidate?.fullName || "",
          email: candidateEmail,
          ...(user.onboarding.personalDetails || {}),
        },
        residentialAddress: user.onboarding.residentialAddress || {},
        emergencyContact: user.onboarding.emergencyContact || {},
        bankDetails: user.onboarding.bankDetails || {},
        taxDetails: user.onboarding.taxDetails || {},
        identityDetails: user.onboarding.identityDetails || {},
        documents: (user.onboarding.documents || []).map((d) => {
          const docObj = typeof d?.toObject === "function" ? d.toObject() : { ...d };
          const id = docObj._id ? String(docObj._id) : (docObj.id ? String(docObj.id) : String(docObj.storageKey || ""));
          return {
            ...docObj,
            _id: id,
            id,
          };
        }),
        correctionReason: user.onboarding.correctionReason || "",
        submittedAt: user.onboarding.submittedAt || null,
        approvedAt: user.onboarding.approvedAt || null,
        history: user.onboarding.history || [],
      },
      offerDetails: offer
        ? {
            _id: offer._id,
            position: offer.position,
            department: offer.department,
            workLocation: offer.workLocation,
            employmentType: offer.employmentType,
            monthlySalary: offer.monthlySalary,
            annualSalary: offer.annualSalary,
            joiningDate: offer.joiningDate,
            candidate: offer.candidate,
            status: offer.status,
            signature: offer.signature,
          }
        : null,
      company: {
        name: company.companyName,
        slug: company.slug,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Save draft progress of candidate onboarding (partial fields allowed)
 */
export async function saveOnboardingDraft(req, res, next) {
  try {
    const { token } = req.params;
    const { user } = await resolveAndVerifyCandidateOnboarding(token, { lean: false });

    if (user.onboarding.status === ONBOARDING_STATUSES.APPROVED) {
      throw new HttpError(400, "Your onboarding has already been approved and cannot be edited.");
    }

    if (user.onboarding.status === ONBOARDING_STATUSES.SUBMITTED) {
      throw new HttpError(
        409,
        "Your onboarding has been submitted and is currently under review. Edits are disabled until HR requests changes."
      );
    }

    const {
      personalDetails,
      residentialAddress,
      emergencyContact,
      bankDetails,
      taxDetails,
      identityDetails,
    } = req.body || {};

    if (personalDetails && typeof personalDetails === "object") {
      const incomingPhone =
        personalDetails.phoneNumber !== undefined ? personalDetails.phoneNumber : personalDetails.phone;
      const currentPd = user.onboarding.personalDetails?.toObject?.() || user.onboarding.personalDetails || {};
      user.onboarding.personalDetails = {
        ...currentPd,
        fullName:
          personalDetails.fullName !== undefined
            ? String(personalDetails.fullName).trim()
            : currentPd.fullName,
        preferredName:
          personalDetails.preferredName !== undefined
            ? String(personalDetails.preferredName).trim()
            : currentPd.preferredName,
        phoneNumber:
          incomingPhone !== undefined ? String(incomingPhone).trim() : currentPd.phoneNumber,
        personalPhone:
          personalDetails.personalPhone !== undefined
            ? String(personalDetails.personalPhone).trim()
            : currentPd.personalPhone,
        dateOfBirth: personalDetails.dateOfBirth
          ? new Date(personalDetails.dateOfBirth)
          : currentPd.dateOfBirth,
        gender:
          personalDetails.gender !== undefined
            ? String(personalDetails.gender).trim()
            : currentPd.gender,
        city:
          personalDetails.city !== undefined ? String(personalDetails.city).trim() : currentPd.city,
      };
    }

    if (residentialAddress && typeof residentialAddress === "object") {
      const incomingStreet =
        residentialAddress.street !== undefined
          ? residentialAddress.street
          : residentialAddress.addressLine1 !== undefined
          ? residentialAddress.addressLine1
          : residentialAddress.address;
      const currentAddr =
        user.onboarding.residentialAddress?.toObject?.() || user.onboarding.residentialAddress || {};
      user.onboarding.residentialAddress = {
        ...currentAddr,
        street:
          incomingStreet !== undefined ? String(incomingStreet).trim() : currentAddr.street,
        city:
          residentialAddress.city !== undefined
            ? String(residentialAddress.city).trim()
            : currentAddr.city,
        state:
          residentialAddress.state !== undefined
            ? String(residentialAddress.state).trim()
            : currentAddr.state,
        postalCode:
          residentialAddress.postalCode !== undefined
            ? String(residentialAddress.postalCode).trim()
            : currentAddr.postalCode,
        country:
          residentialAddress.country !== undefined
            ? String(residentialAddress.country).trim()
            : currentAddr.country || "India",
      };
    }

    if (emergencyContact && typeof emergencyContact === "object") {
      const currentEc =
        user.onboarding.emergencyContact?.toObject?.() || user.onboarding.emergencyContact || {};
      user.onboarding.emergencyContact = {
        ...currentEc,
        name:
          emergencyContact.name !== undefined ? String(emergencyContact.name).trim() : currentEc.name,
        relationship:
          emergencyContact.relationship !== undefined
            ? String(emergencyContact.relationship).trim()
            : currentEc.relationship,
        phone:
          emergencyContact.phone !== undefined ? String(emergencyContact.phone).trim() : currentEc.phone,
      };
    }

    if (bankDetails && typeof bankDetails === "object") {
      const currentBd =
        user.onboarding.bankDetails?.toObject?.() || user.onboarding.bankDetails || {};
      user.onboarding.bankDetails = {
        ...currentBd,
        accountHolderName:
          bankDetails.accountHolderName !== undefined
            ? String(bankDetails.accountHolderName).trim()
            : currentBd.accountHolderName,
        bankName:
          bankDetails.bankName !== undefined ? String(bankDetails.bankName).trim() : currentBd.bankName,
        accountNumber:
          bankDetails.accountNumber !== undefined
            ? String(bankDetails.accountNumber).trim()
            : currentBd.accountNumber,
        ifscCode:
          bankDetails.ifscCode !== undefined
            ? String(bankDetails.ifscCode).trim().toUpperCase()
            : currentBd.ifscCode,
        accountType:
          bankDetails.accountType !== undefined
            ? String(bankDetails.accountType).trim()
            : currentBd.accountType,
      };
    }

    const incomingPan =
      (taxDetails && taxDetails.panNumber) ||
      (identityDetails && (identityDetails.panNumber || identityDetails.idNumber));
    if (taxDetails && typeof taxDetails === "object") {
      const currentTd =
        user.onboarding.taxDetails?.toObject?.() || user.onboarding.taxDetails || {};
      user.onboarding.taxDetails = {
        ...currentTd,
        panNumber:
          taxDetails.panNumber !== undefined
            ? String(taxDetails.panNumber).trim().toUpperCase()
            : incomingPan
            ? String(incomingPan).trim().toUpperCase()
            : currentTd.panNumber,
        taxRegime:
          taxDetails.taxRegime !== undefined
            ? String(taxDetails.taxRegime).trim()
            : currentTd.taxRegime,
      };
    } else if (incomingPan) {
      user.onboarding.taxDetails = user.onboarding.taxDetails || {};
      user.onboarding.taxDetails.panNumber = String(incomingPan).trim().toUpperCase();
    }

    if (identityDetails && typeof identityDetails === "object") {
      const currentId =
        user.onboarding.identityDetails?.toObject?.() || user.onboarding.identityDetails || {};
      user.onboarding.identityDetails = {
        ...currentId,
        idType:
          identityDetails.idType !== undefined
            ? String(identityDetails.idType).trim()
            : currentId.idType,
        idNumber:
          identityDetails.idNumber !== undefined
            ? String(identityDetails.idNumber).trim()
            : currentId.idNumber,
      };
    }

    await user.save();

    const raw = user.onboarding.toObject ? user.onboarding.toObject() : user.onboarding;
    const serialized = {
      _id: user._id,
      ...raw,
    };
    if (serialized.personalDetails) {
      serialized.personalDetails.phone = serialized.personalDetails.phoneNumber;
    }
    if (serialized.residentialAddress) {
      serialized.residentialAddress.addressLine1 = serialized.residentialAddress.street;
    }

    res.json({
      success: true,
      message: "Draft onboarding information saved.",
      onboarding: serialized,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Upload an onboarding document (base64 or buffer payload)
 */
export async function uploadOnboardingDocument(req, res, next) {
  try {
    const { token } = req.params;
    const { company, user } = await resolveAndVerifyCandidateOnboarding(token, { lean: false });

    const { documentType, title, fileName, fileData, mimeType } = req.body || {};

    if (!documentType || !Object.values(ONBOARDING_DOCUMENT_TYPES).includes(documentType)) {
      throw new HttpError(400, "Valid document type is required.");
    }

    if (!fileName || !fileData) {
      throw new HttpError(400, "File name and file content are required.");
    }

    if (user.onboarding.status === ONBOARDING_STATUSES.APPROVED) {
      throw new HttpError(400, "Onboarding has already been approved.");
    }

    // Save document to tenant isolated storage using candidate user namespace
    const saved = await saveDocumentFile({
      databaseName: company.databaseName,
      employeeId: `onboarding_${user._id}`,
      fileName,
      fileData,
      mimeType,
    });

    const docRecord = {
      _id: new mongoose.Types.ObjectId(),
      documentType,
      title: title ? String(title).trim() : fileName,
      fileName: saved.fileName,
      fileSize: saved.fileSize,
      mimeType: saved.mimeType,
      storageKey: saved.storageKey,
      uploadedAt: new Date(),
    };

    user.onboarding.documents.push(docRecord);
    await user.save();

    res.status(201).json({
      success: true,
      message: "Document uploaded successfully.",
      document: docRecord,
      documents: user.onboarding.documents,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete an uploaded onboarding document
 */
export async function deleteOnboardingDocument(req, res, next) {
  try {
    const { token, docId } = req.params;
    const { user } = await resolveAndVerifyCandidateOnboarding(token, { lean: false });

    if (user.onboarding.status === ONBOARDING_STATUSES.APPROVED) {
      throw new HttpError(400, "Onboarding has already been approved.");
    }

    const initialLen = user.onboarding.documents.length;
    user.onboarding.documents = user.onboarding.documents.filter(
      (d) =>
        !(
          (d._id && String(d._id) === docId) ||
          (d.id && String(d.id) === docId) ||
          (d.storageKey && String(d.storageKey) === docId)
        )
    );

    if (user.onboarding.documents.length === initialLen) {
      throw new HttpError(404, "Document not found.");
    }

    await user.save();

    res.json({
      success: true,
      message: "Document removed successfully.",
      documents: user.onboarding.documents,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download a candidate's uploaded onboarding document
 */
export async function downloadOnboardingDocument(req, res, next) {
  try {
    const { token, docId } = req.params;
    const { company, user } = await resolveAndVerifyCandidateOnboarding(token, { lean: true });

    const doc = user.onboarding.documents?.find(
      (d) =>
        (d._id && String(d._id) === docId) ||
        (d.id && String(d.id) === docId) ||
        (d.storageKey && String(d.storageKey) === docId)
    );
    if (!doc) {
      throw new HttpError(404, "Document not found.");
    }

    const filePath = getDocumentAbsolutePath({
      databaseName: company.databaseName,
      employeeId: `onboarding_${user._id}`,
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
 * Submit candidate onboarding for HR review
 */
export async function submitOnboarding(req, res, next) {
  try {
    const { token } = req.params;
    const { models, user } = await resolveAndVerifyCandidateOnboarding(token, { lean: false });

    if (user.onboarding.status === ONBOARDING_STATUSES.APPROVED) {
      throw new HttpError(400, "Your onboarding has already been approved.");
    }

    // Optional field updates if passed in final submission
    if (req.body && Object.keys(req.body).length > 0) {
      const {
        personalDetails,
        residentialAddress,
        emergencyContact,
        bankDetails,
        taxDetails,
        identityDetails,
      } = req.body;

      if (personalDetails && typeof personalDetails === "object") {
        const incomingPhone =
          personalDetails.phoneNumber !== undefined
            ? personalDetails.phoneNumber
            : personalDetails.phone !== undefined
            ? personalDetails.phone
            : user.onboarding.personalDetails?.phoneNumber;
        const currentPd = user.onboarding.personalDetails?.toObject?.() || user.onboarding.personalDetails || {};
        user.onboarding.personalDetails = {
          ...currentPd,
          fullName:
            personalDetails.fullName !== undefined
              ? String(personalDetails.fullName).trim()
              : currentPd.fullName,
          preferredName:
            personalDetails.preferredName !== undefined
              ? String(personalDetails.preferredName).trim()
              : currentPd.preferredName,
          phoneNumber:
            incomingPhone !== undefined ? String(incomingPhone).trim() : currentPd.phoneNumber,
          personalPhone:
            personalDetails.personalPhone !== undefined
              ? String(personalDetails.personalPhone).trim()
              : currentPd.personalPhone,
          dateOfBirth:
            personalDetails.dateOfBirth !== undefined
              ? personalDetails.dateOfBirth
                ? new Date(personalDetails.dateOfBirth)
                : null
              : currentPd.dateOfBirth,
          gender:
            personalDetails.gender !== undefined
              ? String(personalDetails.gender).trim()
              : currentPd.gender,
          city:
            personalDetails.city !== undefined ? String(personalDetails.city).trim() : currentPd.city,
        };
      }

      if (residentialAddress && typeof residentialAddress === "object") {
        const incomingStreet =
          residentialAddress.street !== undefined
            ? residentialAddress.street
            : residentialAddress.addressLine1 !== undefined
            ? residentialAddress.addressLine1
            : user.onboarding.residentialAddress?.street;
        const currentAddr =
          user.onboarding.residentialAddress?.toObject?.() || user.onboarding.residentialAddress || {};
        user.onboarding.residentialAddress = {
          ...currentAddr,
          street:
            incomingStreet !== undefined ? String(incomingStreet).trim() : currentAddr.street,
          city:
            residentialAddress.city !== undefined
              ? String(residentialAddress.city).trim()
              : currentAddr.city,
          state:
            residentialAddress.state !== undefined
              ? String(residentialAddress.state).trim()
              : currentAddr.state,
          postalCode:
            residentialAddress.postalCode !== undefined
              ? String(residentialAddress.postalCode).trim()
              : currentAddr.postalCode,
          country:
            residentialAddress.country !== undefined
              ? String(residentialAddress.country).trim()
              : currentAddr.country || "India",
        };
      }

      if (emergencyContact && typeof emergencyContact === "object") {
        const currentEc =
          user.onboarding.emergencyContact?.toObject?.() || user.onboarding.emergencyContact || {};
        user.onboarding.emergencyContact = {
          ...currentEc,
          name:
            emergencyContact.name !== undefined ? String(emergencyContact.name).trim() : currentEc.name,
          relationship:
            emergencyContact.relationship !== undefined
              ? String(emergencyContact.relationship).trim()
              : currentEc.relationship,
          phone:
            emergencyContact.phone !== undefined ? String(emergencyContact.phone).trim() : currentEc.phone,
        };
      }

      if (bankDetails && typeof bankDetails === "object") {
        const currentBd =
          user.onboarding.bankDetails?.toObject?.() || user.onboarding.bankDetails || {};
        user.onboarding.bankDetails = {
          ...currentBd,
          accountHolderName:
            bankDetails.accountHolderName !== undefined
              ? String(bankDetails.accountHolderName).trim()
              : currentBd.accountHolderName,
          bankName:
            bankDetails.bankName !== undefined ? String(bankDetails.bankName).trim() : currentBd.bankName,
          accountNumber:
            bankDetails.accountNumber !== undefined
              ? String(bankDetails.accountNumber).trim()
              : currentBd.accountNumber,
          ifscCode:
            bankDetails.ifscCode !== undefined
              ? String(bankDetails.ifscCode).trim().toUpperCase()
              : currentBd.ifscCode,
          accountType:
            bankDetails.accountType !== undefined
              ? String(bankDetails.accountType).trim()
              : currentBd.accountType,
        };
      }

      const incomingPan =
        (taxDetails && taxDetails.panNumber) ||
        (identityDetails && (identityDetails.panNumber || identityDetails.idNumber));
      if (taxDetails && typeof taxDetails === "object") {
        const currentTd =
          user.onboarding.taxDetails?.toObject?.() || user.onboarding.taxDetails || {};
        user.onboarding.taxDetails = {
          ...currentTd,
          panNumber:
            taxDetails.panNumber !== undefined
              ? String(taxDetails.panNumber).trim().toUpperCase()
              : incomingPan
              ? String(incomingPan).trim().toUpperCase()
              : currentTd.panNumber,
          taxRegime:
            taxDetails.taxRegime !== undefined
              ? String(taxDetails.taxRegime).trim()
              : currentTd.taxRegime,
        };
      } else if (incomingPan) {
        user.onboarding.taxDetails = user.onboarding.taxDetails || {};
        user.onboarding.taxDetails.panNumber = String(incomingPan).trim().toUpperCase();
      }
    }

    // Validate required fields before accepting submission
    const errors = {};
    const pd = user.onboarding.personalDetails || {};
    const addr = user.onboarding.residentialAddress || {};
    const ec = user.onboarding.emergencyContact || {};
    const bd = user.onboarding.bankDetails || {};
    const td = user.onboarding.taxDetails || {};

    const fullName = pd.fullName?.trim() || user.onboarding.candidate?.fullName?.trim();
    if (!fullName) errors["personalDetails.fullName"] = "Full legal name is required.";
    const phone =
      pd.phoneNumber?.trim() ||
      pd.phone?.trim() ||
      user.onboarding.candidate?.phoneNumber?.trim();
    if (!phone) errors["personalDetails.phoneNumber"] = "Phone number is required.";
    if (!pd.dateOfBirth) errors["personalDetails.dateOfBirth"] = "Date of birth is required.";
    if (!pd.gender?.trim()) errors["personalDetails.gender"] = "Gender is required.";

    const street = addr.street?.trim() || addr.addressLine1?.trim();
    if (!street) errors["residentialAddress.street"] = "Street address is required.";
    if (!addr.city?.trim()) errors["residentialAddress.city"] = "City is required.";
    if (!addr.state?.trim()) errors["residentialAddress.state"] = "State is required.";
    if (!addr.postalCode?.trim()) errors["residentialAddress.postalCode"] = "Postal code is required.";

    if (!ec.name?.trim()) errors["emergencyContact.name"] = "Emergency contact name is required.";
    if (!ec.phone?.trim()) errors["emergencyContact.phone"] = "Emergency contact phone is required.";

    if (!bd.accountHolderName?.trim()) errors["bankDetails.accountHolderName"] = "Bank account holder name is required.";
    if (!bd.bankName?.trim()) errors["bankDetails.bankName"] = "Bank name is required.";
    if (!bd.accountNumber?.trim()) errors["bankDetails.accountNumber"] = "Account number is required.";
    if (!bd.ifscCode?.trim()) errors["bankDetails.ifscCode"] = "IFSC code is required.";

    const panNumber =
      td.panNumber?.trim() ||
      user.onboarding.identityDetails?.panNumber?.trim() ||
      user.onboarding.identityDetails?.idNumber?.trim();
    if (!panNumber) errors["taxDetails.panNumber"] = "PAN or Tax ID number is required.";

    if (!user.onboarding.documents || user.onboarding.documents.length === 0) {
      errors.documents = "Please upload at least one required identity or verification document.";
    }

    if (Object.keys(errors).length > 0) {
      throw new HttpError(400, "Please fill in all required fields before submitting.", {
        errors,
        missingFields: Object.keys(errors),
      });
    }

    const wasChangesRequested = user.onboarding.status === ONBOARDING_STATUSES.CHANGES_REQUESTED;
    user.onboarding.status = ONBOARDING_STATUSES.SUBMITTED;
    user.onboarding.submittedAt = new Date();
    user.onboarding.correctionReason = ""; // Clear correction request note

    user.onboarding.history.push({
      action: wasChangesRequested ? "RESUBMITTED" : "SUBMITTED",
      timestamp: new Date(),
      actorRole: "CANDIDATE",
      notes: wasChangesRequested ? "Candidate resubmitted requested updates" : "Initial submission",
    });

    user.markModified("onboarding");
    await user.save();

    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorEmail: user.onboarding.candidate?.email || user.email,
          actorRole: "CANDIDATE",
          action: AUDIT_ACTIONS.ONBOARDING_SUBMITTED,
          targetType: "User",
          targetId: user._id,
          changes: { wasChangesRequested },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    const raw = user.onboarding.toObject ? user.onboarding.toObject() : user.onboarding;
    const serialized = {
      _id: user._id,
      ...raw,
      candidateName: user.onboarding.candidate?.fullName || user.onboarding.personalDetails?.fullName || "",
      candidateEmail: user.onboarding.candidate?.email || user.email,
    };
    if (serialized.personalDetails) {
      serialized.personalDetails.phone = serialized.personalDetails.phoneNumber;
    }
    if (serialized.residentialAddress) {
      serialized.residentialAddress.addressLine1 = serialized.residentialAddress.street;
    }

    res.json({
      success: true,
      message: "Your onboarding information has been submitted successfully for HR review.",
      onboarding: serialized,
    });
  } catch (error) {
    next(error);
  }
}

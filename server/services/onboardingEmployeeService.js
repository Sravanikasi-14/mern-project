import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { resolveDepartmentAssignment } from "./departmentLinkService.js";
import { resolveReportingManagerFromOfferHint } from "./reportingManagerService.js";

/**
 * Validates that the candidate's onboarding data is complete enough to become an Employee.
 * Throws HttpError(400) with the HR-facing message when something is missing.
 */
export function assertOnboardingDataComplete(onboarding) {
  const pd = onboarding.personalDetails || {};
  const addr = onboarding.residentialAddress || {};
  const ec = onboarding.emergencyContact || {};
  const bd = onboarding.bankDetails || {};
  const td = onboarding.taxDetails || {};

  if (!pd.fullName?.trim() || !pd.phoneNumber?.trim() || !pd.dateOfBirth) {
    throw new HttpError(400, "Candidate personal details are incomplete and cannot be approved.");
  }
  if (!addr.street?.trim() || !addr.city?.trim() || !addr.state?.trim() || !addr.postalCode?.trim()) {
    throw new HttpError(400, "Candidate residential address is incomplete and cannot be approved.");
  }
  if (!ec.name?.trim() || !ec.phone?.trim()) {
    throw new HttpError(400, "Candidate emergency contact details are incomplete and cannot be approved.");
  }
  if (!bd.accountNumber?.trim() || !bd.ifscCode?.trim()) {
    throw new HttpError(400, "Candidate bank details are incomplete and cannot be approved.");
  }
  if (!td.panNumber?.trim()) {
    throw new HttpError(400, "Candidate tax / PAN details are incomplete and cannot be approved.");
  }
}

/**
 * Validates that the linked offer is signed/accepted and not already converted.
 * Returns the normalized candidate email.
 */
export async function assertOfferReadyForConversion({ Employee, offerLetter, candidateUser, acceptedStatus }) {
  if (!offerLetter) {
    throw new HttpError(404, "Linked offer letter was not found.");
  }
  if (offerLetter.status !== acceptedStatus || !offerLetter.signature?.signedAt) {
    throw new HttpError(
      400,
      "Cannot approve onboarding: Linked offer letter has not been electronically signed and accepted by the candidate."
    );
  }

  const candidateEmail = (offerLetter.candidate?.email || candidateUser.email).trim().toLowerCase();

  if (offerLetter.convertedToEmployeeAt) {
    throw new HttpError(409, "This offer letter has already been converted to an employee profile.");
  }

  if (offerLetter.employeeId) {
    const linkedEmployee = await Employee.findById(offerLetter.employeeId);
    if (
      linkedEmployee &&
      (String(linkedEmployee.userId) === String(candidateUser._id) ||
        linkedEmployee.email.toLowerCase() === candidateEmail)
    ) {
      throw new HttpError(409, "This offer letter has already been converted to an employee profile.");
    }
  }

  return candidateEmail;
}

/** True when the connection supports multi-document transactions (replica set / sharded). */
export function connectionSupportsTransactions(connection) {
  const topologyType = connection?.client?.topology?.description?.type;
  return (
    (topologyType === "ReplicaSetWithPrimary" ||
      topologyType === "Sharded" ||
      topologyType === "LoadBalanced") &&
    typeof connection?.startSession === "function"
  );
}

/** Generates a unique employee code using project conventions (<SLUG3>-NNN). */
export async function generateEmployeeCode(Employee, company) {
  const companySlug = company?.slug || "EMP";
  const prefix = companySlug.substring(0, 3).toUpperCase();
  const count = await Employee.countDocuments({});
  let nextNum = count + 1;
  let employeeCode = `${prefix}-${String(nextNum).padStart(3, "0")}`;
  while (await Employee.findOne({ employeeCode })) {
    nextNum++;
    employeeCode = `${prefix}-${String(nextNum).padStart(3, "0")}`;
  }
  return employeeCode;
}

/**
 * Maps verified onboarding data + offer terms to an Employee document payload.
 * `reportingManagerId` must already be a resolved Employee ObjectId or null —
 * never pass OfferLetter.reportingManager (free-text name) here.
 */
export function buildEmployeePayload({
  candidateUser,
  offerLetter,
  employeeCode,
  candidateEmail,
  uploadedBy,
  reportingManagerId = null,
}) {
  const onboarding = candidateUser.onboarding;
  const pd = onboarding.personalDetails || {};
  const addr = onboarding.residentialAddress || {};
  const ec = onboarding.emergencyContact || {};
  const bd = onboarding.bankDetails || {};
  const td = onboarding.taxDetails || {};

  const employeeDocs = (onboarding.documents || []).map((doc) => ({
    documentType: doc.documentType === "ID_PROOF" ? "ID_PROOF" : "OTHER",
    title: doc.title,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    storageKey: doc.storageKey,
    uploadedBy,
    uploadedByRole: "HR_ADMIN",
    createdAt: doc.uploadedAt || new Date(),
  }));

  return {
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
      reportingManagerId: reportingManagerId || null,
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
      idType: onboarding.identityDetails?.idType || "PAN / Aadhaar",
      idNumber: onboarding.identityDetails?.idNumber || td.panNumber?.trim() || "",
      isVerified: true,
    },
    documents: employeeDocs,
    schemaVersion: 1,
  };
}

/**
 * Creates the Employee (+ compensation) from approved onboarding data.
 * Must only be invoked from successful account activation.
 * Returns { employee, compensation, employeeCode }; callers handle compensating rollback via the
 * returned handles when no transaction session is used.
 */
export async function createEmployeeFromOnboarding({
  models,
  company,
  candidateUser,
  offerLetter,
  candidateEmail,
  actorUserId,
  sessionOpt = {},
}) {
  const { Employee } = models;

  const existingEmployee = await Employee.findOne({
    $or: [{ email: candidateEmail }, { userId: candidateUser._id }],
  });
  if (existingEmployee) {
    throw new HttpError(409, `An employee record with email '${candidateEmail}' already exists in this workspace.`);
  }

  assertOnboardingDataComplete(candidateUser.onboarding);

  // OfferLetter.reportingManager is free-text; never assign it to ObjectId field.
  const reportingManagerId = await resolveReportingManagerFromOfferHint(
    Employee,
    offerLetter?.reportingManager
  );

  const employeeCode = await generateEmployeeCode(Employee, company);
  const employeePayload = buildEmployeePayload({
    candidateUser,
    offerLetter,
    employeeCode,
    candidateEmail,
    uploadedBy: actorUserId,
    reportingManagerId,
  });
  const departmentAssignment = await resolveDepartmentAssignment(models.Department, {
    department: employeePayload.job.department,
    departmentId: employeePayload.job.departmentId,
    departmentProvided: true,
    departmentIdProvided: Boolean(employeePayload.job.departmentId),
    session: sessionOpt.session,
  });
  employeePayload.job.department = departmentAssignment.departmentName || "";
  employeePayload.job.departmentId = departmentAssignment.departmentId;

  const result = { employee: null, compensation: null, employeeCode };

  try {
    await insertEmployeeAndCompensation({ models, offerLetter, employeePayload, actorUserId, sessionOpt, result });
  } catch (err) {
    // Without a transaction session, undo partial writes here.
    if (!sessionOpt.session) {
      await rollbackCreatedEmployee(models, result);
    }
    throw err;
  }

  return result;
}

/** Compensating cleanup for non-transactional databases. */
export async function rollbackCreatedEmployee(models, result) {
  if (result?.employee) {
    try {
      await models.Employee.deleteOne({ _id: result.employee._id });
    } catch {}
  }
  if (result?.compensation) {
    try {
      await models.EmployeeCompensation.deleteOne({ _id: result.compensation._id });
    } catch {}
  }
}

async function insertEmployeeAndCompensation({
  models,
  offerLetter,
  employeePayload,
  actorUserId,
  sessionOpt,
  result,
}) {
  const { Employee, EmployeeCompensation } = models;
  const [createdEmp] = await Employee.create([employeePayload], sessionOpt);
  result.employee = createdEmp;

  const monthlySalary = offerLetter.monthlySalary;
  if (monthlySalary && EmployeeCompensation) {
    const basic = Math.round(monthlySalary * 0.5);
    const hra = Math.round(monthlySalary * 0.25);
    const conveyance = Math.round(monthlySalary * 0.1);
    const special = Math.round(monthlySalary * 0.15);

    const [createdComp] = await EmployeeCompensation.create(
      [
        {
          employeeId: createdEmp._id,
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
              revisedBy: actorUserId,
              revisedAt: new Date(),
            },
          ],
          schemaVersion: 1,
        },
      ],
      sessionOpt
    );
    result.compensation = createdComp;
  }
}

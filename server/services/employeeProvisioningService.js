import crypto from "node:crypto";
import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { TOKEN_TYPES } from "../models/AuthToken.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword } from "../utils/password.js";
import { signEmployeeActivationToken } from "../utils/onboardingToken.js";
import { hashAuthToken } from "../utils/authTokenHash.js";
import { resolveDepartmentAssignment } from "./departmentLinkService.js";
import {
  assertValidReportingManagerAssignment,
  isStrictObjectId,
  parseReportingManagerInput,
} from "./reportingManagerService.js";

export const PROVISIONING_SOURCES = Object.freeze({
  MANUAL: "MANUAL",
  ONBOARDING: "ONBOARDING",
  BULK_IMPORT: "BULK_IMPORT",
});

export const ACCOUNT_STATUS = Object.freeze({
  PENDING_ACTIVATION: "PENDING_ACTIVATION",
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function trimStr(value) {
  return value == null ? "" : String(value).trim();
}

/**
 * Ordinary provisioning must not change a Company Admin or HR Admin into an employee.
 * Candidate conversion stays limited to the onboarding path that already loaded that user.
 */
function assertAccountCanBecomeEmployee(existing) {
  if (!existing) return;
  if (existing.role === USER_ROLES.HR_ADMIN) {
    throw new HttpError(409, "This email belongs to an HR admin account and cannot be provisioned as an employee.", {
      field: "email",
      errors: { email: "This email belongs to an HR admin account." },
      code: "EMAIL_OWNED_BY_HR_ADMIN",
    });
  }
  if (existing.role === USER_ROLES.COMPANY_ADMIN) {
    throw new HttpError(409, "This email belongs to the Company Admin account and cannot be used for an employee.", {
      field: "email",
      errors: { email: "This email belongs to the Company Admin account." },
      code: "EMAIL_OWNED_BY_COMPANY_ADMIN",
    });
  }
}

/**
 * Validate employee payload for provisioning.
 * Returns normalized fields or throws HttpError(400) with errors{}.
 */
export function validateEmployeeProvisionData(employeeData = {}, { requireEmployeeCode = true } = {}) {
  const errors = {};
  const fullName = trimStr(employeeData.fullName);
  const emailRaw = trimStr(employeeData.email);
  const employeeCode = trimStr(employeeData.employeeCode);

  if (!fullName) errors.fullName = "Full name is required";
  if (!emailRaw || !isValidEmail(emailRaw)) errors.email = "A valid email is required";
  if (requireEmployeeCode && !employeeCode) errors.employeeCode = "Employee code is required";

  if (employeeData.monthlySalary !== undefined && employeeData.monthlySalary !== null && employeeData.monthlySalary !== "") {
    const numSal = parseFloat(employeeData.monthlySalary);
    if (Number.isNaN(numSal) || numSal < 0) {
      errors.monthlySalary = "Please enter a valid non-negative salary amount.";
    }
  }

  if (employeeData.joiningDate) {
    if (Number.isNaN(new Date(employeeData.joiningDate).getTime())) {
      errors.joiningDate = "Please enter a valid joining date.";
    }
  }

  let reportingManagerId = null;
  if (employeeData.reportingManagerId !== undefined && employeeData.reportingManagerId !== null && employeeData.reportingManagerId !== "") {
    try {
      const parsed = parseReportingManagerInput(employeeData.reportingManagerId);
      reportingManagerId = parsed.managerId;
    } catch (err) {
      errors.reportingManagerId = err?.errors?.reportingManagerId || err.message || "Invalid reporting manager reference.";
    }
  }

  if (Object.keys(errors).length > 0) {
    const first = Object.values(errors)[0];
    throw new HttpError(400, first, { field: Object.keys(errors)[0], errors });
  }

  return {
    fullName,
    email: normalizeEmail(emailRaw),
    employeeCode,
    phoneNumber: trimStr(employeeData.phoneNumber),
    dateOfBirth: employeeData.dateOfBirth ? new Date(employeeData.dateOfBirth) : null,
    city: trimStr(employeeData.city),
    status:
      employeeData.status === EMPLOYEE_STATUSES.INACTIVE
        ? EMPLOYEE_STATUSES.INACTIVE
        : EMPLOYEE_STATUSES.ACTIVE,
    jobTitle: trimStr(employeeData.jobTitle),
    department: trimStr(employeeData.department),
    departmentId: employeeData.departmentId || null,
    employmentType: trimStr(employeeData.employmentType) || "Full-time",
    jobGrade: trimStr(employeeData.jobGrade),
    workLocation: trimStr(employeeData.workLocation),
    joiningDate: employeeData.joiningDate ? new Date(employeeData.joiningDate) : new Date(),
    reportingManagerId,
    projectName: trimStr(employeeData.projectName),
    projectType: trimStr(employeeData.projectType) || "MANDATE",
    monthlySalary: employeeData.monthlySalary,
    offerLetterId: employeeData.offerLetterId || null,
  };
}

/**
 * Generate a tenant-scoped employee code when none is provided.
 * Format: {SLUG_PREFIX}-{NNN}. Safe under uniqueness retries.
 */
export async function generateEmployeeCode(Employee, company, session = null) {
  const prefix = (company?.slug || "EMP").substring(0, 3).toUpperCase() || "EMP";
  const countQuery = Employee.countDocuments({});
  if (session) countQuery.session(session);
  let nextNum = (await countQuery) + 1;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = `${prefix}-${String(nextNum + attempt).padStart(3, "0")}`;
    const query = Employee.findOne({ employeeCode: code });
    if (session) query.session(session);
    const exists = await query;
    if (!exists) return code;
  }
  throw new HttpError(500, "Unable to generate a unique employee code. Please provide one manually.");
}

async function assertNoDuplicateEmployee(Employee, { email, employeeCode }, session = null) {
  const codeQuery = Employee.findOne({ employeeCode });
  const emailQuery = Employee.findOne({ email });
  if (session) {
    codeQuery.session(session);
    emailQuery.session(session);
  }
  const [existingCode, existingEmail] = await Promise.all([codeQuery, emailQuery]);
  if (existingCode) {
    throw new HttpError(409, "An employee with this employee code already exists.", {
      field: "employeeCode",
      errors: { employeeCode: "An employee with this employee code already exists." },
      code: "DUPLICATE_EMPLOYEE_CODE",
    });
  }
  if (existingEmail) {
    throw new HttpError(409, "An employee with this email address already exists.", {
      field: "email",
      errors: { email: "An employee with this email address already exists." },
      code: "DUPLICATE_EMPLOYEE_EMAIL",
    });
  }
}

async function resolveLinkedOffer(OfferLetter, offerLetterId, session = null) {
  if (!offerLetterId) return null;
  if (!mongoose.Types.ObjectId.isValid(offerLetterId)) {
    throw new HttpError(400, "Invalid offer letter ID provided.", {
      field: "offerLetterId",
      errors: { offerLetterId: "Invalid offer letter ID provided." },
    });
  }
  if (!OfferLetter) return null;

  const query = OfferLetter.findById(offerLetterId);
  if (session) query.session(session);
  const linkedOffer = await query;
  if (!linkedOffer) {
    throw new HttpError(404, "Referenced offer letter was not found.", {
      field: "offerLetterId",
      errors: { offerLetterId: "Referenced offer letter was not found." },
    });
  }
  if (linkedOffer.status !== "ACCEPTED") {
    throw new HttpError(
      400,
      `Cannot onboard candidate from offer letter with status '${linkedOffer.status}'. Only ACCEPTED offers can be onboarded.`,
      {
        field: "offerLetterId",
        errors: {
          offerLetterId: `Offer letter is in '${linkedOffer.status}' status. Only ACCEPTED offers can be onboarded.`,
        },
      }
    );
  }
  if (linkedOffer.employeeId) {
    throw new HttpError(409, "This offer letter has already been linked to an onboarded employee.", {
      field: "offerLetterId",
      errors: { offerLetterId: "This offer letter has already been linked to an onboarded employee." },
      code: "OFFER_ALREADY_LINKED",
    });
  }
  return linkedOffer;
}

/**
 * Issue a single-use activation token. Stores only the SHA-256 hash.
 * Returns the raw token + link for HR to share out-of-band (no email).
 */
export async function issueActivationToken({
  models,
  company,
  employee,
  user,
  actorUserId = null,
  clientBaseUrl,
  session = null,
}) {
  const { AuthToken } = models;
  const rawToken = signEmployeeActivationToken({
    companyId: company._id,
    employeeId: employee._id,
    userId: user._id,
    email: employee.email,
  });
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);

  if (AuthToken) {
    const invalidate = AuthToken.updateMany(
      { email: employee.email, role: "EMPLOYEE", isActive: true },
      { isActive: false }
    );
    if (session) invalidate.session(session);
    await invalidate;

    const docs = [
      {
        userId: user._id,
        email: employee.email,
        token: tokenHash,
        type: TOKEN_TYPES.INVITATION,
        role: "EMPLOYEE",
        expiresAt,
        createdBy: actorUserId || null,
        isActive: true,
      },
    ];
    if (session) {
      await AuthToken.create(docs, { session });
    } else {
      await AuthToken.create(docs[0]);
    }
  }

  const base =
    clientBaseUrl ||
    process.env.CLIENT_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5173";
  const activationLink = `${String(base).replace(/\/$/, "")}/activate?token=${encodeURIComponent(rawToken)}`;

  employee.invitation = {
    status: "PENDING",
    token: "", // never persist raw activation token on the employee record
    sentAt: new Date(),
    acceptedAt: null,
  };
  if (session) {
    await employee.save({ session });
  } else {
    await employee.save();
  }

  return { rawToken, activationLink, expiresAt, status: "PENDING" };
}

/**
 * Regenerate activation link for an existing pending employee.
 * Does not create a new Employee or User.
 */
export async function regenerateActivationLink(companyContext, employeeId) {
  const { models, company, actorUserId, clientBaseUrl } = companyContext;
  const { Employee, User } = models;

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new HttpError(404, "Employee not found");
  }

  if (employee.invitation?.status === "ACCEPTED") {
    throw new HttpError(400, "Employee has already activated their account. Ask them to log in or use password reset.");
  }

  let user = employee.userId ? await User.findById(employee.userId) : null;
  if (!user) {
    user = await User.findOne({ email: employee.email });
  }
  if (!user) {
    throw new HttpError(404, "Linked user account not found for this employee.");
  }

  if (user.isActive && user.lastLoginAt) {
    throw new HttpError(400, "This account is already active. Regeneration is not required.");
  }

  // Keep account pending until the employee sets a password
  user.isActive = false;
  user.role = USER_ROLES.EMPLOYEE;
  user.employeeId = employee._id;
  await user.save();

  const activation = await issueActivationToken({
    models,
    company,
    employee,
    user,
    actorUserId,
    clientBaseUrl,
  });

  if (models.AuditLog && actorUserId) {
    try {
      await models.AuditLog.create({
        actorUserId,
        actorEmail: companyContext.actorEmail || "",
        actorRole: companyContext.actorRole || USER_ROLES.HR_ADMIN,
        action: AUDIT_ACTIONS.INVITATION_RESENT,
        targetType: "Employee",
        targetId: employee._id,
        changes: { email: employee.email, deliveryStatus: "PENDING", emailSent: false },
        ipAddress: companyContext.ipAddress || "",
        timestamp: new Date(),
      });
    } catch {
      // non-fatal
    }
  }

  return {
    employee,
    user,
    accountStatus: ACCOUNT_STATUS.PENDING_ACTIVATION,
    activation: {
      status: ACCOUNT_STATUS.PENDING_ACTIVATION,
      activationLink: activation.activationLink,
      inviteLink: activation.activationLink,
      expiresAt: activation.expiresAt,
      emailSent: false,
      error: null,
    },
  };
}

/**
 * Shared employee + user provisioning used by Paths A, B, and C.
 *
 * @param {object} companyContext - { models, company, actorUserId, actorEmail, actorRole, clientBaseUrl, ipAddress }
 * @param {object} employeeData - employee fields
 * @param {object} options
 * @param {string} [options.source] - MANUAL | ONBOARDING | BULK_IMPORT
 * @param {string|null} [options.existingUserId] - Path B: reuse candidate User
 * @param {boolean} [options.generateCodeIfMissing] - auto-generate employeeCode
 * @param {object|null} [options.session] - mongoose session
 * @param {boolean} [options.skipAudit] - skip audit writes
 */
export async function provisionEmployeeAccount(companyContext, employeeData, options = {}) {
  const {
    models,
    company,
    actorUserId = null,
    actorEmail = "",
    actorRole = USER_ROLES.HR_ADMIN,
    clientBaseUrl,
    ipAddress = "",
  } = companyContext;

  if (!models?.Employee || !models?.User || !company) {
    throw new HttpError(500, "Company context is incomplete for employee provisioning.");
  }

  const {
    source = PROVISIONING_SOURCES.MANUAL,
    existingUserId = null,
    generateCodeIfMissing = false,
    session = null,
    skipAudit = false,
  } = options;

  const { Employee, User, EmployeeCompensation, OfferLetter, AuditLog, Department } = models;

  let normalized = validateEmployeeProvisionData(employeeData, {
    requireEmployeeCode: !generateCodeIfMissing || Boolean(trimStr(employeeData.employeeCode)),
  });

  if (!normalized.employeeCode && generateCodeIfMissing) {
    normalized = {
      ...normalized,
      employeeCode: await generateEmployeeCode(Employee, company, session),
    };
  }

  const departmentAssignment = await resolveDepartmentAssignment(Department, {
    department: normalized.department,
    departmentId: normalized.departmentId,
    departmentProvided: true,
    departmentIdProvided: Boolean(normalized.departmentId),
    existingDepartmentId: null,
    existingDepartmentName: "",
    session,
  });
  normalized = {
    ...normalized,
    department: departmentAssignment.departmentName || "",
    departmentId: departmentAssignment.departmentId,
  };

  // Same-company existence + ObjectId validation (create has no subject id yet → no cycle walk).
  if (normalized.reportingManagerId) {
    normalized = {
      ...normalized,
      reportingManagerId: await assertValidReportingManagerAssignment({
        Employee,
        employeeId: null,
        managerId: normalized.reportingManagerId,
      }),
    };
  }

  // Role / company overrides from the client are ignored — backend owns these.
  const linkedOffer = await resolveLinkedOffer(OfferLetter, normalized.offerLetterId || employeeData.offerLetterId, session);
  await assertNoDuplicateEmployee(
    Employee,
    { email: normalized.email, employeeCode: normalized.employeeCode },
    session
  );

  // Resolve User — never convert a Company Admin or HR Admin into an employee.
  let user = null;
  let createdUser = false;

  if (existingUserId) {
    const q = User.findById(existingUserId);
    if (session) q.session(session);
    user = await q;
    if (!user) {
      throw new HttpError(404, "Existing user account for onboarding was not found.");
    }
    if (user.email !== normalized.email) {
      throw new HttpError(400, "Onboarding user email does not match provisioned employee email.");
    }
    assertAccountCanBecomeEmployee(user);
  } else {
    const q = User.findOne({ email: normalized.email });
    if (session) q.session(session);
    const existing = await q;
    if (existing) {
      assertAccountCanBecomeEmployee(existing);
      if (existing.role === USER_ROLES.CANDIDATE || existing.onboarding) {
        throw new HttpError(409, "This email belongs to an in-progress candidate. Complete onboarding approval instead.", {
          field: "email",
          errors: { email: "This email belongs to an in-progress candidate." },
          code: "EMAIL_OWNED_BY_CANDIDATE",
        });
      }
      if (existing.employeeId) {
        throw new HttpError(409, "A user account with this email already exists.", {
          field: "email",
          errors: { email: "A user account with this email already exists." },
          code: "DUPLICATE_USER_EMAIL",
        });
      }
      if (existing.role !== USER_ROLES.EMPLOYEE) {
        throw new HttpError(409, "This email belongs to an account that cannot be used for an employee.", {
          field: "email",
          errors: { email: "This email belongs to an account that cannot be used for an employee." },
          code: "EMAIL_ROLE_CONFLICT",
        });
      }
      // Orphan EMPLOYEE user without employeeId — reuse safely for idempotent retry
      user = existing;
    }
  }

  if (!user) {
    // Unusable random password until activation; never accept client-supplied passwords here.
    const placeholder = `Pending!${crypto.randomBytes(24).toString("hex")}`;
    const passwordHash = await hashPassword(placeholder);
    const userDoc = {
      email: normalized.email,
      passwordHash,
      role: USER_ROLES.EMPLOYEE,
      isActive: false,
      employeeId: null,
      schemaVersion: 1,
    };
    if (session) {
      const created = await User.create([userDoc], { session });
      user = created[0];
    } else {
      user = await User.create(userDoc);
    }
    createdUser = true;
  } else {
    assertAccountCanBecomeEmployee(user);
    user.role = USER_ROLES.EMPLOYEE;
    user.isActive = false;
    // Candidate users may have no passwordHash; set a placeholder until activation.
    if (!user.passwordHash) {
      user.passwordHash = await hashPassword(`Pending!${crypto.randomBytes(24).toString("hex")}`);
    }
    if (session) await user.save({ session });
    else await user.save();
  }

  const employeeDoc = {
    userId: user._id,
    employeeCode: normalized.employeeCode,
    fullName: normalized.fullName,
    email: normalized.email,
    phoneNumber: normalized.phoneNumber,
    dateOfBirth: normalized.dateOfBirth,
    city: normalized.city,
    status: normalized.status,
    job: {
      jobTitle: normalized.jobTitle,
      department: normalized.department,
      departmentId: normalized.departmentId || null,
      employmentType: normalized.employmentType,
      jobGrade: normalized.jobGrade,
      workLocation: normalized.workLocation,
      joiningDate: normalized.joiningDate,
      reportingManagerId: normalized.reportingManagerId,
      project: {
        projectName: normalized.projectName,
        projectType: normalized.projectType,
      },
    },
    invitation: {
      status: "PENDING",
      token: "",
      sentAt: null,
      acceptedAt: null,
    },
    schemaVersion: 1,
  };

  let employee;
  try {
    if (session) {
      const created = await Employee.create([employeeDoc], { session });
      employee = created[0];
    } else {
      employee = await Employee.create(employeeDoc);
    }
  } catch (err) {
    // Unique index race — surface as 409
    if (err?.code === 11000) {
      const field = err.keyPattern?.employeeCode
        ? "employeeCode"
        : err.keyPattern?.email
          ? "email"
          : "email";
      throw new HttpError(409, `Duplicate ${field} detected.`, {
        field,
        errors: { [field]: `An employee with this ${field} already exists.` },
        code: field === "employeeCode" ? "DUPLICATE_EMPLOYEE_CODE" : "DUPLICATE_EMPLOYEE_EMAIL",
      });
    }
    // Compensating cleanup for non-transactional path
    if (createdUser && !session) {
      try {
        await User.deleteOne({ _id: user._id });
      } catch {
        // ignore
      }
    }
    throw err;
  }

  user.employeeId = employee._id;
  user.role = USER_ROLES.EMPLOYEE;
  user.isActive = false;
  if (session) await user.save({ session });
  else await user.save();

  // Compensation (optional)
  const numericSalary = parseFloat(normalized.monthlySalary);
  if (!Number.isNaN(numericSalary) && numericSalary > 0 && EmployeeCompensation) {
    const basic = numericSalary * 0.5;
    const hra = numericSalary * 0.25;
    const conveyance = numericSalary * 0.1;
    const special = numericSalary * 0.15;
    const compDoc = {
      employeeId: employee._id,
      revisions: [
        {
          effectiveFromDate: normalized.joiningDate,
          monthlyCostToCompany: mongoose.Types.Decimal128.fromString(numericSalary.toFixed(2)),
          salaryComponents: {
            basicSalary: mongoose.Types.Decimal128.fromString(basic.toFixed(2)),
            houseRentAllowance: mongoose.Types.Decimal128.fromString(hra.toFixed(2)),
            conveyanceAllowance: mongoose.Types.Decimal128.fromString(conveyance.toFixed(2)),
            specialAllowance: mongoose.Types.Decimal128.fromString(special.toFixed(2)),
          },
          revisedBy: actorUserId || null,
          revisedAt: new Date(),
        },
      ],
      schemaVersion: 1,
    };
    if (session) await EmployeeCompensation.create([compDoc], { session });
    else await EmployeeCompensation.create(compDoc);
  }

  if (linkedOffer) {
    linkedOffer.employeeId = employee._id;
    if (session) await linkedOffer.save({ session });
    else await linkedOffer.save();
  }

  const activation = await issueActivationToken({
    models,
    company,
    employee,
    user,
    actorUserId,
    clientBaseUrl,
    session,
  });

  if (!skipAudit && AuditLog) {
    try {
      await AuditLog.create({
        actorUserId: actorUserId || null,
        actorEmail: actorEmail || "system",
        actorRole: actorRole || USER_ROLES.HR_ADMIN,
        action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
        targetType: "Employee",
        targetId: employee._id,
        changes: {
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          email: employee.email,
          source,
          monthlySalary: !Number.isNaN(numericSalary) ? numericSalary : null,
        },
        ipAddress,
        timestamp: new Date(),
      });
      await AuditLog.create({
        actorUserId: actorUserId || null,
        actorEmail: actorEmail || "system",
        actorRole: actorRole || USER_ROLES.HR_ADMIN,
        action: AUDIT_ACTIONS.INVITATION_SENT,
        targetType: "Employee",
        targetId: employee._id,
        changes: {
          email: normalized.email,
          deliveryStatus: "PENDING",
          emailSent: false,
          source,
        },
        ipAddress,
        timestamp: new Date(),
      });
      if (linkedOffer) {
        await AuditLog.create({
          actorUserId: actorUserId || null,
          actorEmail: actorEmail || "system",
          actorRole: actorRole || USER_ROLES.HR_ADMIN,
          action: AUDIT_ACTIONS.OFFER_LETTER_LINKED,
          targetType: "OfferLetter",
          targetId: linkedOffer._id,
          changes: {
            offerLetterId: linkedOffer._id,
            employeeId: employee._id,
            employeeCode: employee.employeeCode,
            candidateName: linkedOffer.candidate?.fullName,
          },
          ipAddress,
          timestamp: new Date(),
        });
      }
    } catch {
      // non-fatal
    }
  }

  return {
    employee,
    user,
    createdUser,
    accountStatus: ACCOUNT_STATUS.PENDING_ACTIVATION,
    source,
    activation: {
      status: ACCOUNT_STATUS.PENDING_ACTIVATION,
      activationLink: activation.activationLink,
      inviteLink: activation.activationLink, // backward-compatible alias
      expiresAt: activation.expiresAt,
      emailSent: false,
      error: null,
    },
    linkedOfferId: linkedOffer?._id || null,
  };
}

/**
 * Validate a bulk-import row against tenant data without creating records.
 */
export async function validateImportRow(models, row, { seenEmails, seenCodes }) {
  const errors = {};
  let normalized;
  try {
    normalized = validateEmployeeProvisionData(row, { requireEmployeeCode: true });
  } catch (err) {
    if (err instanceof HttpError && err.errors) {
      return { valid: false, errors: err.errors, normalized: null };
    }
    return { valid: false, errors: { _row: err.message || "Invalid row" }, normalized: null };
  }

  const emailKey = normalized.email;
  const codeKey = normalized.employeeCode.toLowerCase();

  if (seenEmails.has(emailKey)) {
    errors.email = "Duplicate email within the import file.";
  }
  if (seenCodes.has(codeKey)) {
    errors.employeeCode = "Duplicate employee code within the import file.";
  }

  const [existingEmail, existingCode, existingUser] = await Promise.all([
    models.Employee.findOne({ email: emailKey }).select("_id").lean(),
    models.Employee.findOne({ employeeCode: normalized.employeeCode }).select("_id").lean(),
    models.User.findOne({ email: emailKey }).select("_id role employeeId onboarding").lean(),
  ]);

  if (existingEmail) errors.email = "An employee with this email already exists.";
  if (existingCode) errors.employeeCode = "An employee with this employee code already exists.";

  if (existingUser) {
    if (existingUser.role === USER_ROLES.HR_ADMIN) {
      errors.email = "This email belongs to an HR admin account.";
    } else if (existingUser.role === USER_ROLES.CANDIDATE || existingUser.onboarding) {
      errors.email = "This email belongs to an in-progress candidate.";
    } else if (existingUser.employeeId) {
      errors.email = "A user account with this email already exists.";
    }
  }

  // Optional: resolve reporting manager by employee code if provided as reportingManagerCode
  if (row.reportingManagerCode && !normalized.reportingManagerId) {
    const mgr = await models.Employee.findOne({
      employeeCode: trimStr(row.reportingManagerCode),
    })
      .select("_id")
      .lean();
    if (!mgr) {
      errors.reportingManagerCode = "Reporting manager employee code not found.";
    } else {
      normalized.reportingManagerId = mgr._id;
    }
  }

  if (normalized.reportingManagerId) {
    if (!isStrictObjectId(normalized.reportingManagerId)) {
      errors.reportingManagerId = "Invalid reporting manager reference.";
    } else {
      try {
        normalized.reportingManagerId = await assertValidReportingManagerAssignment({
          Employee: models.Employee,
          employeeId: null,
          managerId: normalized.reportingManagerId,
        });
      } catch (err) {
        errors.reportingManagerId =
          err?.errors?.reportingManagerId || err.message || "Invalid reporting manager reference.";
      }
    }
  }

  const valid = Object.keys(errors).length === 0;
  if (valid) {
    seenEmails.add(emailKey);
    seenCodes.add(codeKey);
  }

  return { valid, errors, normalized };
}

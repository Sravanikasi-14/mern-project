import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { generateEmployeeCode } from "./employeeProvisioningService.js";
import { connectionSupportsTransactions } from "./onboardingEmployeeService.js";
import { resolveDepartmentAssignment } from "./departmentLinkService.js";
import {
  assertValidReportingManagerAssignment,
  parseReportingManagerInput,
} from "./reportingManagerService.js";
import { HttpError } from "../utils/httpError.js";

const LINKABLE_ROLES = new Set([USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN]);

function sameId(left, right) {
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasField(profile, key) {
  return Object.prototype.hasOwnProperty.call(profile || {}, key);
}

/**
 * Employment fields safe to show on an employee profile.
 * Login secrets (password hash, invitation tokens) are never included.
 */
export function serializeLinkedEmployee(employee) {
  if (!employee) return null;
  const job = employee.job || {};
  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode || "",
    fullName: employee.fullName || "",
    email: employee.email || "",
    status: employee.status || EMPLOYEE_STATUSES.ACTIVE,
    jobTitle: job.jobTitle || "",
    department: job.department || "",
    departmentId: job.departmentId ? String(job.departmentId) : null,
    jobGrade: job.jobGrade || "",
    joiningDate: job.joiningDate || null,
    reportingManagerId: job.reportingManagerId ? String(job.reportingManagerId) : null,
  };
}

function conflict(message) {
  throw new HttpError(409, message, { code: "IDENTITY_LINK_CONFLICT" });
}

async function findOne(model, filter, session) {
  const query = model.findOne(filter);
  if (session) query.session(session);
  return query;
}

async function findById(model, id, session) {
  if (!id) return null;
  const query = model.findById(id);
  if (session) query.session(session);
  return query;
}

function assertLinkableRole(user) {
  if (!user) {
    throw new HttpError(404, "Account not found.", { code: "USER_NOT_FOUND" });
  }
  if (!LINKABLE_ROLES.has(user.role)) {
    throw new HttpError(409, "This account cannot be linked to an employee profile.", {
      code: "ROLE_NOT_LINKABLE",
    });
  }
}

async function resolveManager(models, employeeId, rawValue) {
  const parsed = parseReportingManagerInput(rawValue);
  if (!parsed.provided) return { provided: false, managerId: undefined };
  const managerId = await assertValidReportingManagerAssignment({
    Employee: models.Employee,
    employeeId,
    managerId: parsed.managerId,
  });
  return { provided: true, managerId };
}

function applyEmploymentFields(employee, profile, { creating, department, departmentAssignment, manager }) {
  if (creating || hasField(profile, "fullName")) {
    const name = trim(profile.fullName) || (creating ? employee.fullName : "");
    if (creating && !name) {
      throw new HttpError(400, "Name is required.", {
        code: "INVALID_INPUT",
        errors: { fullName: "Name is required." },
      });
    }
    if (name) employee.fullName = name;
  }

  if (creating || hasField(profile, "status")) {
    const status = profile.status || (creating ? EMPLOYEE_STATUSES.ACTIVE : employee.status);
    if (status && !Object.values(EMPLOYEE_STATUSES).includes(status)) {
      throw new HttpError(400, "Employment status must be ACTIVE or INACTIVE.", {
        code: "INVALID_INPUT",
        errors: { status: "Employment status must be ACTIVE or INACTIVE." },
      });
    }
    if (status) employee.status = status;
  }

  const job = employee.job || {};
  if (creating || hasField(profile, "jobTitle")) {
    job.jobTitle = hasField(profile, "jobTitle") ? trim(profile.jobTitle) : job.jobTitle || "";
  }
  if (creating || hasField(profile, "jobGrade")) {
    job.jobGrade = hasField(profile, "jobGrade") ? trim(profile.jobGrade) : job.jobGrade || "";
  }
  if (departmentAssignment) {
    if (departmentAssignment.changed) {
      job.department = departmentAssignment.departmentName;
      job.departmentId = departmentAssignment.departmentId;
    }
  } else if (department) {
    job.department = department.name;
    job.departmentId = department._id;
  } else if (creating || hasField(profile, "department")) {
    if (hasField(profile, "department")) job.department = trim(profile.department);
    else if (creating) job.department = job.department || "";
  }
  if (creating || hasField(profile, "joiningDate")) {
    if (!hasField(profile, "joiningDate") || profile.joiningDate == null || profile.joiningDate === "") {
      if (creating) job.joiningDate = null;
    } else {
      const date = new Date(profile.joiningDate);
      if (Number.isNaN(date.getTime())) {
        throw new HttpError(400, "Joining date is invalid.", {
          code: "INVALID_INPUT",
          errors: { joiningDate: "Joining date is invalid." },
        });
      }
      job.joiningDate = date;
    }
  }
  if (manager?.provided) {
    job.reportingManagerId = manager.managerId;
  } else if (creating && !job.reportingManagerId) {
    job.reportingManagerId = null;
  }
  employee.job = job;
  employee.markModified?.("job");
}

async function assertEmployeeCodeAvailable(Employee, employeeCode, exceptId, session) {
  const existing = await findOne(Employee, { employeeCode }, session);
  if (existing && !sameId(existing._id, exceptId)) {
    throw new HttpError(409, "An employee with this employee code already exists.", {
      code: "DUPLICATE_EMPLOYEE_CODE",
      errors: { employeeCode: "An employee with this employee code already exists." },
    });
  }
}

/**
 * Link a Company Admin or HR Admin login to one employee profile.
 * Uses User.employeeId and Employee.userId only. Never changes the system role.
 * Already-consistent links are returned unchanged unless employment fields are supplied.
 * Conflicting links are rejected and nothing is overwritten.
 */
export async function linkPortalOperatorEmployee({
  models,
  company,
  user: userOrId,
  profile = {},
  updateEmployment = false,
  session = null,
}) {
  if (!session && connectionSupportsTransactions(models.User?.db)) {
    return withPortalLinkTransaction(models, (transaction) =>
      linkPortalOperatorEmployee({
        models,
        company,
        user: userOrId,
        profile,
        updateEmployment,
        session: transaction,
      })
    );
  }

  const { User, Employee, Department } = models;
  const user = userOrId?.save
    ? userOrId
    : await findById(User, userOrId, session);
  assertLinkableRole(user);
  const role = user.role;

  if (hasField(profile, "email") && trim(profile.email).toLowerCase() !== user.email) {
    throw new HttpError(400, "The employee email must match the login email. A second login is not created.", {
      code: "EMAIL_MISMATCH",
      errors: { email: "The employee email must match the login email." },
    });
  }

  const pointed = user.employeeId
    ? await findById(Employee, user.employeeId, session)
    : null;
  const reverse = await findOne(Employee, { userId: user._id }, session);
  const byEmail = await findOne(Employee, { email: user.email }, session);

  if (pointed && reverse && !sameId(pointed._id, reverse._id)) {
    conflict("This account points at a different employee profile than the profile linked back to the account.");
  }
  if (pointed?.userId && !sameId(pointed.userId, user._id)) {
    conflict("This account points at an employee profile that is linked to a different login.");
  }
  if (reverse && user.employeeId && !sameId(reverse._id, user.employeeId)) {
    conflict("An employee profile points at this account, but the account points at a different profile.");
  }
  if (byEmail?.userId && !sameId(byEmail.userId, user._id)) {
    conflict("This email already belongs to an employee profile linked to a different login.");
  }
  if (pointed && byEmail && !sameId(pointed._id, byEmail._id)) {
    conflict("This account is linked to an employee profile with a different email address.");
  }
  if (reverse && byEmail && !sameId(reverse._id, byEmail._id)) {
    conflict("More than one employee profile matches this account.");
  }
  if (pointed && pointed.email && pointed.email !== user.email) {
    conflict("The linked employee profile uses a different email address.");
  }

  const target = pointed || reverse || (byEmail && (!byEmail.userId || sameId(byEmail.userId, user._id)) ? byEmail : null);

  if (byEmail && target && !sameId(byEmail._id, target._id)) {
    conflict("This email already belongs to a different employee profile.");
  }

  const alreadyConsistent =
    target &&
    sameId(target.userId, user._id) &&
    sameId(user.employeeId, target._id);

  if (alreadyConsistent && !updateEmployment) {
    if (user.role !== role) {
      conflict("Linking must not change the account role.");
    }
    return {
      created: false,
      unchanged: true,
      role,
      employeeProfile: serializeLinkedEmployee(target),
    };
  }

  const wantsDepartment =
    hasField(profile, "department") ||
    hasField(profile, "departmentId") ||
    profile.clearDepartment === true;
  const departmentAssignment = wantsDepartment
    ? await resolveDepartmentAssignment(Department, {
        department: profile.department,
        departmentId: profile.departmentId,
        departmentProvided: hasField(profile, "department"),
        departmentIdProvided: hasField(profile, "departmentId"),
        clearDepartment: profile.clearDepartment === true,
        existingDepartmentId: target?.job?.departmentId || null,
        existingDepartmentName: target?.job?.department || "",
        session,
      })
    : null;
  const manager = await resolveManager(
    models,
    target?._id || null,
    hasField(profile, "reportingManagerId") ? profile.reportingManagerId : undefined
  );

  if (!target) {
    const employeeCode = trim(profile.employeeCode) || (await generateEmployeeCode(Employee, company, session));
    await assertEmployeeCodeAvailable(Employee, employeeCode, null, session);
    if (byEmail) {
      conflict("This email already belongs to a different employee profile.");
    }

    const previousEmployeeId = user.employeeId || null;
    const draft = new Employee({
      userId: user._id,
      employeeCode,
      fullName: trim(profile.fullName) || user.fullName || "",
      email: user.email,
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: {},
    });
    applyEmploymentFields(draft, profile, { creating: true, department: null, departmentAssignment, manager });

    let createdDoc = null;
    let userSaved = false;
    try {
      await draft.save(session ? { session } : undefined);
      createdDoc = draft;
      if (user.role !== role) {
        conflict("Linking must not change the account role.");
      }
      user.employeeId = createdDoc._id;
      await user.save(session ? { session } : undefined);
      userSaved = true;
    } catch (error) {
      if (createdDoc?._id) {
        const cleanup = Employee.deleteOne({ _id: createdDoc._id });
        if (session) cleanup.session(session);
        await cleanup;
      }
      user.employeeId = previousEmployeeId;
      if (userSaved) {
        const revert = User.updateOne(
          { _id: user._id },
          { $set: { employeeId: previousEmployeeId } }
        );
        if (session) revert.session(session);
        await revert;
      }
      throw error;
    }

    return {
      created: true,
      unchanged: false,
      role: user.role,
      employeeProfile: serializeLinkedEmployee(createdDoc),
    };
  }

  const previousUserId = target.userId;
  const previousEmployeeId = user.employeeId;
  if (hasField(profile, "employeeCode")) {
    const nextCode = trim(profile.employeeCode);
    if (!nextCode) {
      throw new HttpError(400, "Employee ID is required.", {
        code: "INVALID_INPUT",
        errors: { employeeCode: "Employee ID is required." },
      });
    }
    if (nextCode !== target.employeeCode) {
      await assertEmployeeCodeAvailable(Employee, nextCode, target._id, session);
      target.employeeCode = nextCode;
    }
  }

  target.userId = user._id;
  if (updateEmployment || !alreadyConsistent) {
    if (updateEmployment) {
      applyEmploymentFields(target, profile, { creating: false, department: null, departmentAssignment, manager });
    }
  }

  try {
    await target.save(session ? { session } : undefined);
    user.employeeId = target._id;
    if (user.role !== role) {
      conflict("Linking must not change the account role.");
    }
    if (!sameId(previousEmployeeId, target._id) || user.isModified?.()) {
      await user.save(session ? { session } : undefined);
    }
  } catch (error) {
    target.userId = previousUserId;
    try {
      await target.save(session ? { session } : undefined);
    } catch {
      /* The original error is the one the caller must see. */
    }
    user.employeeId = previousEmployeeId;
    throw error;
  }

  const fresh = await findById(User, user._id, session);
  if (!fresh || fresh.role !== role) {
    conflict("Linking must not change the account role.");
  }

  return {
    created: false,
    unchanged: alreadyConsistent && !updateEmployment,
    role: fresh.role,
    employeeProfile: serializeLinkedEmployee(target),
  };
}

export async function getPortalEmployeeProfile({ models, userId, expectedRole = null }) {
  const { User, Employee } = models;
  const user = await User.findById(userId).select("role email fullName employeeId");
  if (!user || (expectedRole && user.role !== expectedRole)) {
    throw new HttpError(404, "Account not found.", { code: "USER_NOT_FOUND" });
  }
  assertLinkableRole(user);
  if (!user.employeeId) {
    return { employeeProfile: null, role: user.role };
  }
  const employee = await Employee.findById(user.employeeId);
  if (!employee || !sameId(employee.userId, user._id)) {
    return { employeeProfile: null, role: user.role, linkIncomplete: true };
  }
  return {
    employeeProfile: serializeLinkedEmployee(employee),
    role: user.role,
    linkIncomplete: false,
  };
}

/**
 * Run a portal-user mutation and its employee link in one transaction when the
 * tenant connection supports it. Otherwise the callback runs once and the link
 * service compensates a failed write itself.
 */
export async function withPortalLinkTransaction(models, work) {
  const connection = models.User?.db;
  if (!connectionSupportsTransactions(connection)) {
    return work(null);
  }
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

import { findCompanyById, getCompanyModels } from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { USER_ROLES, serializeUser } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import { setAuthCookie } from "../utils/authCookie.js";
import { signAuthToken, decodeAuthToken } from "../utils/token.js";
import { verifyEmployeeActivationToken } from "../utils/onboardingToken.js";

/**
 * Verify employee activation token before presenting password setup screen
 */
export async function verifyActivationTokenEndpoint(req, res, next) {
  try {
    const token = req.query?.token;
    if (!token || typeof token !== "string") {
      throw new HttpError(400, "Activation token is required.");
    }

    let payload;
    try {
      payload = verifyEmployeeActivationToken(token);
    } catch {
      throw new HttpError(400, "This activation link is invalid or has expired.");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);

    if (models.AuthToken) {
      const tokenDoc = await models.AuthToken.findOne({ token });
      if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
        throw new HttpError(409, "This account activation link has already been used. Please log in.");
      }
    }

    const user = await models.User.findById(payload.userId) || await models.User.findOne({ email: payload.sub });
    if (user) {
      if (user.onboarding) {
        if (user.onboarding.status === "REJECTED") {
          throw new HttpError(403, "This candidate onboarding has been rejected. Account activation is not permitted.");
        }
        if (user.onboarding.status !== "APPROVED") {
          throw new HttpError(400, "Account cannot be activated before onboarding approval.");
        }
      }
      if (user.isActive && user.lastLoginAt) {
        throw new HttpError(409, "This account activation link has already been used. Please log in.");
      }
    }

    const employee = await models.Employee.findById(payload.employeeId).lean();
    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    res.json({
      valid: true,
      email: payload.sub,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
      jobTitle: employee.job?.jobTitle || "",
      department: employee.job?.department || "",
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
 * Set password, activate employee account, and authenticate session
 */
export async function completeActivation(req, res, next) {
  try {
    const { token, password } = req.body || {};

    if (!token || typeof token !== "string") {
      throw new HttpError(400, "Activation token is required.");
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      throw new HttpError(400, "Password must be at least 8 characters long.");
    }

    let payload;
    try {
      payload = verifyEmployeeActivationToken(token);
    } catch {
      throw new HttpError(400, "This activation link is invalid or has expired.");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "Company workspace not found.");
    }

    const models = await getCompanyModels(company);

    if (models.AuthToken) {
      const tokenDoc = await models.AuthToken.findOne({ token });
      if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
        throw new HttpError(409, "This account activation link has already been used. Please log in.");
      }
    }

    let user = await models.User.findById(payload.userId);
    if (!user) {
      user = await models.User.findOne({ email: payload.sub });
    }

    if (!user) {
      throw new HttpError(404, "User account not found for this employee.");
    }

    if (user.onboarding) {
      if (user.onboarding.status === "REJECTED") {
        throw new HttpError(403, "This candidate onboarding has been rejected. Account activation is not permitted.");
      }
      if (user.onboarding.status !== "APPROVED") {
        throw new HttpError(400, "Account cannot be activated before onboarding approval.");
      }
    }

    if (user.isActive && user.lastLoginAt) {
      throw new HttpError(409, "This account has already been activated. Please log in.");
    }

    const employee = await models.Employee.findById(payload.employeeId);
    if (!employee) {
      throw new HttpError(404, "Employee profile not found.");
    }

    employee.userId = user._id;
    await employee.save();

    const passwordHash = await hashPassword(password);
    user.passwordHash = passwordHash;
    user.role = USER_ROLES.EMPLOYEE;
    user.isActive = true;
    user.employeeId = employee._id;
    user.lastLoginAt = new Date();
    await user.save();

    // Mark activation token as used
    if (models.AuthToken) {
      await models.AuthToken.updateMany(
        { email: payload.sub, isActive: true },
        { isActive: false, usedAt: new Date() }
      );
    }

    // Sign session token and set secure auth cookie
    const authToken = signAuthToken({
      userId: user._id,
      companyId: company._id,
    });
    setAuthCookie(res, authToken);

    if (models.AuthSession) {
      const decoded = decodeAuthToken(authToken);
      const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 8 * 60 * 60 * 1000);

      await models.AuthSession.create({
        userId: user._id,
        token: authToken,
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        expiresAt,
        isActive: true,
      });
    }

    if (models.AuditLog) {
      try {
        await models.AuditLog.create({
          actorUserId: user._id,
          actorEmail: user.email,
          actorRole: user.role,
          action: AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
          targetType: "User",
          targetId: user._id,
          changes: { employeeId: employee._id, activatedAt: new Date() },
          ipAddress: req.ip || "",
          timestamp: new Date(),
        });
      } catch {}
    }

    res.json({
      success: true,
      message: "Account activated successfully. Welcome to HRMS!",
      token: authToken,
      user: serializeUser(user),
      employee: {
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        email: employee.email,
      },
      company: {
        name: company.companyName,
        slug: company.slug,
      },
    });
  } catch (error) {
    next(error);
  }
}

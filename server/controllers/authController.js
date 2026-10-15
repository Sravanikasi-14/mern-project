import { findCompanyById, findCompanyBySlug, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES, LOGIN_ALLOWED_STATUSES } from "../models/Company.js";
import { USER_ROLES, serializeUser } from "../models/User.js";
import { clearAuthCookie, setAuthCookie, getAuthCookieName } from "../utils/authCookie.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { verifyOnboardingToken } from "../utils/onboardingToken.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { decodeAuthToken, signAuthToken, verifyAuthToken } from "../utils/token.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicCompany(company) {
  return {
    _id: company._id,
    companyName: company.companyName,
    companyCode: company.slug,
    slug: company.slug,
    status: company.status,
    branding: company.branding,
  };
}

export async function login(req, res, next) {
  try {
    const rawCompanyCode = req.body?.companyCode ?? req.body?.slug;
    const { email, password } = req.body || {};

    if (!isNonEmptyString(rawCompanyCode) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      throw new HttpError(400, "Please enter your company code, email, and password.", {
        code: "INVALID_INPUT",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      throw new HttpError(400, "Please enter a valid email address.", {
        code: "INVALID_INPUT",
        errors: { email: "Please enter a valid email address." },
      });
    }

    const company = await findCompanyBySlug(rawCompanyCode.trim().toLowerCase());
    if (!company) {
      throw new HttpError(404, "We couldn't find this company workspace. Check your company code.", {
        code: "COMPANY_NOT_FOUND",
      });
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(
        403,
        "This company workspace is suspended or inactive. Please contact support.",
        { code: "COMPANY_SUSPENDED" }
      );
    }

    let models;
    try {
      models = await getCompanyModels(company);
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "We're unable to connect right now. Please try again in a moment.", {
        code: "SERVICE_UNAVAILABLE",
      });
    }

    const user = await models.User.findOne({ email: normalizedEmail }).select(
      "+passwordHash"
    );
    const passwordMatches = await verifyPassword(password, user?.passwordHash);

    if (!user || !passwordMatches) {
      throw new HttpError(
        401,
        "The company code, email, or password is incorrect. Please check your details and try again.",
        { code: "INVALID_CREDENTIALS" }
      );
    }

    if (!user.isActive) {
      throw new HttpError(
        403,
        "This account is inactive. Please contact your company administrator.",
        { code: "ACCOUNT_DISABLED" }
      );
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signAuthToken({
      userId: user._id,
      companyId: company._id,
    });
    setAuthCookie(res, token);

    // Track active session in company's authSessions collection
    if (models.AuthSession) {
      const decoded = decodeAuthToken(token);
      const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 8 * 60 * 60 * 1000);

      await models.AuthSession.create({
        userId: user._id,
        token,
        ipAddress: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        expiresAt,
        isActive: true,
      });
    }

    res.json({
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res) {
  const token = req.cookies?.[getAuthCookieName()];
  if (token) {
    try {
      const payload = verifyAuthToken(token);
      const company = await findCompanyById(payload.companyId);
      if (company) {
        const models = await getCompanyModels(company);
        if (models.AuthSession) {
          await models.AuthSession.updateMany(
            { token, isActive: true },
            { isActive: false }
          );
        }
      }
    } catch {
      // Ignore token verification errors during logout
    }
  }

  clearAuthCookie(res);
  res.json({ message: "Logged out" });
}

export async function me(req, res) {
  res.json({
    user: serializeUser(req.auth.user),
    company: publicCompany(req.auth.company),
  });
}

export async function verifyOnboardingInvitation(req, res, next) {
  try {
    const token = req.query?.token;
    if (!isNonEmptyString(token)) {
      throw new HttpError(400, "Onboarding token is required");
    }

    let payload;
    try {
      payload = verifyOnboardingToken(token);
    } catch {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "We couldn't find this company workspace. Check your company code.");
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(403, "This company workspace is currently suspended or inactive. Please contact support.");
    }

    const models = await getCompanyModels(company);

    // If tracked in authTokens collection, verify token status
    if (models.AuthToken) {
      const tokenDoc = await models.AuthToken.findOne({ token });
      if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
        throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
      }
    }

    const existingUser = await models.User.findOne({ email: payload.sub });
    if (existingUser) {
      throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
    }

    res.json({
      valid: true,
      companyCode: company.slug,
      companyName: company.companyName,
      email: payload.sub,
      fullName: company.primaryContact?.fullName || "",
    });
  } catch (error) {
    next(error);
  }
}

export async function completeOnboarding(req, res, next) {
  try {
    const { token, password } = req.body || {};

    if (!isNonEmptyString(token)) {
      throw new HttpError(400, "Onboarding token is required");
    }

    if (!isNonEmptyString(password) || password.length < 8) {
      throw new HttpError(400, "Password must be at least 8 characters long");
    }

    let payload;
    try {
      payload = verifyOnboardingToken(token);
    } catch {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(404, "We couldn't find this company workspace. Check your company code.");
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(403, "This company workspace is currently suspended or inactive. Please contact support.");
    }

    const models = await getCompanyModels(company);

    if (models.AuthToken) {
      const tokenDoc = await models.AuthToken.findOne({ token });
      if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
        throw new HttpError(409, "An account has already been established for this invitation. Please log in.");
      }
    }

    const existingUser = await models.User.findOne({ email: payload.sub });
    if (existingUser) {
      throw new HttpError(409, "An account has already been established for this invitation. Please log in.");
    }

    const passwordHash = await hashPassword(password);
    const user = await models.User.create({
      email: payload.sub,
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      lastLoginAt: new Date(),
      schemaVersion: 1,
    });

    const authToken = signAuthToken({
      userId: user._id,
      companyId: company._id,
    });
    setAuthCookie(res, authToken);

    // Track active session in authSessions
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

    // Mark invitation token as used in authTokens
    if (models.AuthToken) {
      await models.AuthToken.updateMany(
        { email: payload.sub, isActive: true },
        { usedAt: new Date(), isActive: false }
      );
    }

    res.status(201).json({
      message: "HR Admin account created successfully",
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controlled development workflow to set up the initial HR Admin account
 * for an already-provisioned company without requiring an invitation link.
 * Strictly prevents arbitrary company creation or privilege escalation.
 */
export async function setupInitialAdmin(req, res, next) {
  try {
    const { companyCode, email, password, confirmPassword } = req.body || {};

    if (
      !isNonEmptyString(companyCode) ||
      !isNonEmptyString(email) ||
      !isNonEmptyString(password)
    ) {
      throw new HttpError(400, "Please enter your company code, email, and password.");
    }

    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      throw new HttpError(400, "Please enter a valid email address.");
    }

    if (password.length < 8) {
      throw new HttpError(400, "Password must be at least 8 characters long.");
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new HttpError(400, "Passwords do not match. Please verify and try again.");
    }

    const cleanCode = companyCode.trim().toLowerCase();
    const company = await findCompanyBySlug(cleanCode);

    if (!company) {
      throw new HttpError(
        404,
        "We couldn't find this company workspace. Check your company code."
      );
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(
        403,
        "This company workspace is currently suspended or inactive. Please contact support."
      );
    }

    const models = await getCompanyModels(company);

    // Security check: Check if an HR Admin is already established in this company
    const existingAdmin = await models.User.findOne({ role: USER_ROLES.HR_ADMIN });
    if (existingAdmin) {
      throw new HttpError(
        409,
        "An HR Admin account is already established for this company. Please sign in or contact your administrator."
      );
    }

    // Security check: If the provisioned company has a designated primary contact email, verify match
    if (company.primaryContact?.email) {
      const primaryEmail = normalizeEmail(company.primaryContact.email);
      if (primaryEmail && primaryEmail !== normalizedEmail) {
        throw new HttpError(
          403,
          "Only the designated primary contact email for this company can set up the initial HR Admin account."
        );
      }
    }

    // Ensure email is not already taken by an existing user in this company
    const existingUser = await models.User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new HttpError(
        409,
        "An account with this email address already exists. Please sign in."
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await models.User.create({
      email: normalizedEmail,
      passwordHash,
      role: USER_ROLES.HR_ADMIN,
      isActive: true,
      lastLoginAt: new Date(),
      schemaVersion: 1,
    });

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

    res.status(201).json({
      message: "Initial HR Admin account established successfully",
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}


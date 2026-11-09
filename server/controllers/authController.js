import mongoose from "mongoose";
import { findCompanyById, findCompanyBySlug, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES, LOGIN_ALLOWED_STATUSES } from "../models/Company.js";
import { USER_ROLES, serializeUser } from "../models/User.js";
import { clearAuthCookie, setAuthCookie, getAuthCookieName } from "../utils/authCookie.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { verifyOnboardingToken } from "../utils/onboardingToken.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { createAuthSessionRecord } from "../utils/authSession.js";
import { stopActiveLiveTrackingSessions } from "../services/attendanceService.js";
import { parseProfileImageUpload } from "../services/documentStorage.js";
import { signAuthToken, verifyAuthToken, decodeAuthToken } from "../utils/token.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  isNativeRefreshClient,
} from "../utils/refreshSession.js";
import {
  acceptHrAdminInvitation,
  verifyHrAdminInvitationToken,
} from "../services/hrAdminManagementService.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicCompany(company) {
  const branding = company.branding || {};
  return {
    _id: company._id,
    name: company.companyName,
    companyName: company.companyName,
    companyCode: company.slug,
    slug: company.slug,
    status: company.status,
    // Never expose logo binary bytes in session/auth payloads
    branding: {
      displayName: branding.displayName || "",
      logoUrl: branding.logoUrl || "",
      logoMimeType: branding.logoMimeType || "",
      primaryColor: branding.primaryColor || "#4338ca",
    },
    timezone: company.config?.timezone || "Asia/Kolkata",
    hrAccessEnforcement: {
      mode: company.config?.hrAccessEnforcement?.mode === "ENFORCED" ? "ENFORCED" : "OFF",
    },
    config: {
      timezone: company.config?.timezone || "Asia/Kolkata",
      currencyCode: company.config?.currencyCode || "INR",
    },
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

    if (user.role === USER_ROLES.CANDIDATE) {
      throw new HttpError(
        403,
        "Candidate accounts cannot log in directly. Please complete your onboarding and activate your employee account.",
        { code: "CANDIDATE_ACCESS_DENIED" }
      );
    }

    if (
      user.onboarding &&
      user.onboarding.status &&
      user.onboarding.status !== "APPROVED" &&
      user.onboarding.status !== "ACTIVATED"
    ) {
      throw new HttpError(
        403,
        "Candidate onboarding must be approved before logging in.",
        { code: "ONBOARDING_NOT_APPROVED" }
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

    // Web logins stay access-token + cookie only. Native apps also get a
    // longer-lived refresh token so a killed process can restore the session.
    const refreshToken = isNativeRefreshClient(req) ? generateRefreshToken() : null;
    await createAuthSessionRecord(models, {
      userId: user._id,
      token,
      req,
      refreshToken,
    });

    res.json({
      token,
      ...(refreshToken ? { refreshToken } : {}),
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}

async function revokeRefreshSession(req) {
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
  const companyId = req.body?.companyId;
  if (!refreshToken || !mongoose.Types.ObjectId.isValid(String(companyId || ""))) return;

  const company = await findCompanyById(companyId);
  if (!company) return;
  const models = await getCompanyModels(company);
  if (!models.AuthSession) return;

  await models.AuthSession.updateMany(
    { refreshTokenHash: hashRefreshToken(refreshToken), isActive: true },
    { isActive: false }
  );
}

export async function refreshSession(req, res, next) {
  try {
    const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
    const companyId = req.body?.companyId;
    if (!refreshToken || refreshToken.length < 20 || !mongoose.Types.ObjectId.isValid(String(companyId || ""))) {
      throw new HttpError(401, "Your session has expired. Please sign in again.", { code: "SESSION_EXPIRED" });
    }

    const company = await findCompanyById(companyId);
    if (!company || !LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(401, "Your session has expired. Please sign in again.", { code: "SESSION_EXPIRED" });
    }

    const models = await getCompanyModels(company);
    const session = await models.AuthSession.findOne({
      refreshTokenHash: hashRefreshToken(refreshToken),
      isActive: true,
    });

    if (!session || !session.refreshExpiresAt || session.refreshExpiresAt.getTime() <= Date.now()) {
      throw new HttpError(401, "Your session has expired. Please sign in again.", { code: "SESSION_EXPIRED" });
    }

    const user = await models.User.findById(session.userId);
    if (!user || !user.isActive || user.role === "CANDIDATE") {
      throw new HttpError(401, "Your session has expired. Please sign in again.", { code: "SESSION_EXPIRED" });
    }

    const token = signAuthToken({
      userId: user._id,
      companyId: company._id,
    });
    const decoded = decodeAuthToken(token);
    session.token = token;
    session.expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 8 * 60 * 60 * 1000);
    await session.save();
    setAuthCookie(res, token);

    res.json({
      token,
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res) {
  try {
    await revokeRefreshSession(req);
  } catch (err) {
    console.error("[logout] Failed to revoke refresh session:", err?.message || err);
  }

  const authHeader = req.headers?.authorization;
  const headerToken = authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  const token = headerToken || req.cookies?.[getAuthCookieName()];
  let trackingStopped = false;
  let trackingStopWarning = null;

  if (token) {
    try {
      const payload = verifyAuthToken(token);
      const company = await findCompanyById(payload.companyId);
      if (company) {
        const models = await getCompanyModels(company);

        // Stop live tracking before invalidating the auth session.
        try {
          const user = await models.User.findById(payload.sub).select("_id email");
          if (user && models.Employee) {
            const employee = await models.Employee.findOne({
              $or: [{ userId: user._id }, { email: user.email }],
            });
            if (employee) {
              await stopActiveLiveTrackingSessions({
                models,
                employee,
                reason: "logout",
              });
              trackingStopped = true;
            }
          }
        } catch (err) {
          console.error("[logout] Failed to stop live tracking:", err?.message || err);
          trackingStopWarning =
            "Signed out, but stopping the live tracking session may have failed.";
        }

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
  res.json({
    message: "Logged out",
    trackingStopped,
    ...(trackingStopWarning ? { trackingStopWarning } : {}),
  });
}

export async function me(req, res) {
  // Baseline contract: user + company only.
  // A1–A6 authorization summary (effectiveAuthorizationService) removed from this path.
  res.json({
    user: serializeUser(req.auth.user),
    company: publicCompany(req.auth.company),
  });
}

export async function updateProfile(req, res, next) {
  try {
    const { fullName, phoneNumber, preferences } = req.body || {};
    const user = req.auth.user;
    const company = req.auth.company;
    const models = await getCompanyModels(company);
    // Candidates may only manage name / phone / photo. They never get an Employee record here.
    const isCandidate = user.role === USER_ROLES.CANDIDATE;

    const updateFields = {};
    if (fullName !== undefined) {
      const trimmed = String(fullName).trim();
      if (!trimmed) {
        throw new HttpError(400, "Full name cannot be empty.");
      }
      updateFields.fullName = trimmed;
    }
    if (phoneNumber !== undefined) updateFields.phoneNumber = String(phoneNumber).trim();
    if (!isCandidate && preferences && typeof preferences === "object") {
      updateFields.preferences = {
        emailNotifications: preferences.emailNotifications !== false,
        weeklyDigest: preferences.weeklyDigest !== false,
        compactView: Boolean(preferences.compactView),
      };
    }

    const updatedUser = await models.User.findByIdAndUpdate(
      user._id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // If user is linked to an Employee record, update basic fields on Employee too
    if (!isCandidate && user.employeeId && models.Employee) {
      const empUpdate = {};
      if (updateFields.fullName !== undefined) empUpdate.fullName = updateFields.fullName;
      if (updateFields.phoneNumber !== undefined) empUpdate.phoneNumber = updateFields.phoneNumber;
      if (Object.keys(empUpdate).length) {
        await models.Employee.findByIdAndUpdate(user.employeeId, { $set: empUpdate });
      }
    }

    res.json({
      message: "Profile updated successfully",
      user: serializeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}

/** Linked Employee for avatar sync (never creates one). Candidates are never linked. */
async function findLinkedEmployeeId(models, user) {
  if (!models.Employee || user.role === USER_ROLES.CANDIDATE) return null;
  if (user.employeeId) {
    const byId = await models.Employee.exists({ _id: user.employeeId });
    if (byId) return byId._id;
  }
  const byUser = await models.Employee.exists({ userId: user._id });
  return byUser ? byUser._id : null;
}

function sendAvatarBytes(res, { data, mimeType }) {
  res.setHeader("Content-Type", mimeType || "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  return res.send(Buffer.from(data));
}

export async function uploadProfileAvatar(req, res, next) {
  try {
    const user = req.auth.user;
    const models = await getCompanyModels(req.auth.company);
    const { fileName, fileData, mimeType } = req.body || {};
    const image = parseProfileImageUpload({ fileName, fileData, mimeType });
    const version = Date.now();

    const updatedUser = await models.User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          avatar: `/api/auth/avatar?v=${version}`,
          avatarMimeType: image.mimeType,
          avatarData: image.buffer,
        },
      },
      { new: true }
    );

    let employee = null;
    const employeeId = await findLinkedEmployeeId(models, user);
    if (employeeId) {
      const employeeAvatar = `/api/employees/${employeeId}/avatar?v=${version}`;
      await models.Employee.updateOne(
        { _id: employeeId },
        {
          $set: {
            avatar: employeeAvatar,
            avatarMimeType: image.mimeType,
            avatarData: image.buffer,
          },
        }
      );
      employee = { _id: employeeId, avatar: employeeAvatar };
    }

    res.json({
      message: "Profile photo updated successfully",
      user: serializeUser(updatedUser),
      employee,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProfileAvatar(req, res, next) {
  try {
    const user = req.auth.user;
    const models = await getCompanyModels(req.auth.company);
    const clear = { $set: { avatar: "", avatarMimeType: "" }, $unset: { avatarData: "" } };

    const updatedUser = await models.User.findByIdAndUpdate(user._id, clear, { new: true });

    let employee = null;
    const employeeId = await findLinkedEmployeeId(models, user);
    if (employeeId) {
      await models.Employee.updateOne({ _id: employeeId }, clear);
      employee = { _id: employeeId, avatar: "" };
    }

    res.json({
      message: "Profile photo removed",
      user: serializeUser(updatedUser),
      employee,
    });
  } catch (error) {
    next(error);
  }
}

/** Streams the caller's own photo: User first, else linked Employee. */
export async function streamOwnAvatar(req, res, next) {
  try {
    const user = req.auth.user;
    const models = await getCompanyModels(req.auth.company);

    const account = await models.User.findById(user._id).select("+avatarData avatarMimeType");
    if (account?.avatarData?.length) {
      return sendAvatarBytes(res, { data: account.avatarData, mimeType: account.avatarMimeType });
    }

    const employeeId = await findLinkedEmployeeId(models, user);
    if (employeeId) {
      const employee = await models.Employee.findById(employeeId).select(
        "+avatarData avatarMimeType"
      );
      if (employee?.avatarData?.length) {
        return sendAvatarBytes(res, {
          data: employee.avatarData,
          mimeType: employee.avatarMimeType,
        });
      }
    }

    throw new HttpError(404, "No profile photo has been uploaded.");
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!isNonEmptyString(currentPassword) || !isNonEmptyString(newPassword)) {
      throw new HttpError(400, "Please provide your current password and new password.");
    }

    if (newPassword.length < 8) {
      throw new HttpError(400, "New password must be at least 8 characters long.");
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      throw new HttpError(400, "New passwords do not match. Please verify and try again.");
    }

    const user = req.auth.user;
    const company = req.auth.company;
    const models = await getCompanyModels(company);

    const userDoc = await models.User.findById(user._id).select("+passwordHash");
    if (!userDoc) {
      throw new HttpError(404, "User account not found.");
    }

    const isValidCurrent = await verifyPassword(currentPassword, userDoc.passwordHash);
    if (!isValidCurrent) {
      throw new HttpError(400, "Incorrect current password. Please try again.");
    }

    const newHash = await hashPassword(newPassword);
    userDoc.passwordHash = newHash;
    await userDoc.save();

    // Revoke all active sessions so stolen/old JWTs cannot survive a password change.
    if (models.AuthSession) {
      await models.AuthSession.updateMany(
        { userId: userDoc._id, isActive: true },
        { isActive: false }
      );
    }

    clearAuthCookie(res);

    res.json({
      message: "Password changed successfully. Please sign in again with your new password.",
      requireReauth: true,
    });
  } catch (error) {
    next(error);
  }
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

    if (payload.purpose === "hr_admin_invitation") {
      const verified = await verifyHrAdminInvitationToken({
        models,
        payload,
        rawToken: token,
      });
      return res.json({
        ...verified,
        companyCode: company.slug,
        companyName: company.companyName,
        company: publicCompany(company),
      });
    }

    // If this is an employee onboarding invitation
    if (payload.purpose === "employee_onboarding") {
      if (models.AuthToken) {
        const tokenDoc = await models.AuthToken.findOne({ token });
        if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
          throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
        }
      }

      let employee = null;
      if (payload.employeeId) {
        employee = await models.Employee.findById(payload.employeeId);
      }
      if (!employee) {
        employee = await models.Employee.findOne({ email: payload.sub });
      }

      if (!employee) {
        throw new HttpError(404, "Employee record not found for this onboarding invitation.");
      }

      if (employee.invitation?.status === "ACCEPTED") {
        throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
      }

      return res.json({
        valid: true,
        type: "EMPLOYEE",
        companyCode: company.slug,
        companyName: company.companyName,
        company: publicCompany(company),
        email: payload.sub,
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        jobTitle: employee.job?.jobTitle || "",
        department: employee.job?.department || "",
        employee: {
          _id: employee._id,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          email: employee.email,
          job: employee.job,
        },
      });
    }

    // Default HR Admin initial onboarding
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
      type: "HR_ADMIN",
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

    if (payload.purpose === "hr_admin_invitation") {
      const { user } = await acceptHrAdminInvitation({
        models,
        company,
        payload,
        rawToken: token,
        password,
        req,
      });

      const authToken = signAuthToken({
        userId: user._id,
        companyId: company._id,
      });
      setAuthCookie(res, authToken);

      await createAuthSessionRecord(models, {
        userId: user._id,
        token: authToken,
        req,
      });

      return res.status(201).json({
        message: "HR Admin account activated successfully",
        token: authToken,
        user: serializeUser(user),
        company: publicCompany(company),
      });
    }

    // Handle Employee Self-Service Onboarding Completion
    if (payload.purpose === "employee_onboarding") {
      if (models.AuthToken) {
        const tokenDoc = await models.AuthToken.findOne({ token });
        if (tokenDoc && (!tokenDoc.isActive || tokenDoc.usedAt)) {
          throw new HttpError(409, "An account has already been established for this invitation. Please log in.");
        }
      }

      let employee = null;
      if (payload.employeeId) {
        employee = await models.Employee.findById(payload.employeeId);
      }
      if (!employee) {
        employee = await models.Employee.findOne({ email: payload.sub });
      }

      if (!employee) {
        throw new HttpError(404, "Employee record not found for this invitation.");
      }

      if (employee.invitation?.status === "ACCEPTED") {
        throw new HttpError(409, "An account has already been established for this invitation. Please log in.");
      }

      const passwordHash = await hashPassword(password);

      let user = null;
      if (employee.userId) {
        user = await models.User.findById(employee.userId);
      }
      if (!user) {
        user = await models.User.findOne({ email: payload.sub });
      }

      if (user) {
        user.passwordHash = passwordHash;
        user.isActive = true;
        user.lastLoginAt = new Date();
        await user.save();
      } else {
        user = await models.User.create({
          email: payload.sub,
          passwordHash,
          role: USER_ROLES.EMPLOYEE,
          isActive: true,
          lastLoginAt: new Date(),
          schemaVersion: 1,
        });
        employee.userId = user._id;
      }

      // Populate permitted self-service fields
      const {
        preferredName,
        personalEmail,
        personalPhone,
        phoneNumber,
        dateOfBirth,
        gender,
        residentialAddress,
        emergencyContact,
        bankDetails,
        taxDetails,
      } = req.body || {};

      if (preferredName !== undefined) employee.preferredName = String(preferredName).trim();
      if (personalEmail !== undefined) employee.personalEmail = String(personalEmail).trim().toLowerCase();
      if (personalPhone !== undefined) employee.personalPhone = String(personalPhone).trim();
      if (phoneNumber !== undefined) employee.phoneNumber = String(phoneNumber).trim();
      if (dateOfBirth) employee.dateOfBirth = new Date(dateOfBirth);
      if (gender !== undefined) employee.gender = String(gender).trim();

      if (residentialAddress && typeof residentialAddress === "object") {
        employee.residentialAddress = { ...employee.residentialAddress, ...residentialAddress };
      }
      if (emergencyContact && typeof emergencyContact === "object") {
        employee.emergencyContact = { ...employee.emergencyContact, ...emergencyContact };
      }
      if (bankDetails && typeof bankDetails === "object") {
        employee.bankDetails = { ...employee.bankDetails, ...bankDetails };
      }
      if (taxDetails && typeof taxDetails === "object") {
        employee.taxDetails = { ...employee.taxDetails, ...taxDetails };
      }

      employee.invitation = {
        status: "ACCEPTED",
        token: "",
        sentAt: employee.invitation?.sentAt || new Date(),
        acceptedAt: new Date(),
      };

      await employee.save();

      const authToken = signAuthToken({
        userId: user._id,
        companyId: company._id,
      });
      setAuthCookie(res, authToken);

      await createAuthSessionRecord(models, {
        userId: user._id,
        token: authToken,
        req,
      });

      if (models.AuthToken) {
        await models.AuthToken.updateMany(
          { email: payload.sub, isActive: true },
          { usedAt: new Date(), isActive: false }
        );
      }

      if (models.AuditLog) {
        try {
          await models.AuditLog.create({
            actorUserId: user._id,
            actorEmail: user.email,
            actorRole: USER_ROLES.EMPLOYEE,
            action: "ONBOARDING_COMPLETED",
            targetType: "Employee",
            targetId: employee._id,
            changes: { onboardingCompleted: true },
            ipAddress: req.ip || "",
            timestamp: new Date(),
          });
        } catch {}
      }

      return res.status(201).json({
        message: "Employee onboarding completed successfully",
        token: authToken,
        user: serializeUser(user),
        employee,
        company: publicCompany(company),
      });
    }

    // Default HR Admin initial onboarding
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

    await createAuthSessionRecord(models, {
      userId: user._id,
      token: authToken,
      req,
    });

    // Mark invitation token as used in authTokens
    if (models.AuthToken) {
      await models.AuthToken.updateMany(
        { email: payload.sub, isActive: true },
        { usedAt: new Date(), isActive: false }
      );
    }

    res.status(201).json({
      message: "HR Admin account created successfully",
      token: authToken,
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

    await createAuthSessionRecord(models, {
      userId: user._id,
      token: authToken,
      req,
    });

    res.status(201).json({
      message: "Initial HR Admin account established successfully",
      token: authToken,
      user: serializeUser(user),
      company: publicCompany(company),
    });
  } catch (error) {
    next(error);
  }
}


import { findCompanyById, getCompanyModels } from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import {
  ONBOARDING_ACCOUNT_SETUP_STATUSES,
  ONBOARDING_STATUSES,
  USER_ROLES,
  serializeUser,
} from "../models/User.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { hashPassword } from "../utils/password.js";
import { setAuthCookie } from "../utils/authCookie.js";
import { signAuthToken, decodeAuthToken } from "../utils/token.js";
import { verifyEmployeeActivationToken } from "../utils/onboardingToken.js";
import { findAuthTokenByRawToken } from "../utils/authTokenHash.js";
import {
  assertOfferReadyForConversion,
  connectionSupportsTransactions,
  createEmployeeFromOnboarding,
  rollbackCreatedEmployee,
} from "../services/onboardingEmployeeService.js";
import { emitOnboardingEvent, ONBOARDING_EVENT_TYPES } from "../services/onboardingEventsService.js";

const ACTIVATION_LOCK_STALE_MS = 2 * 60 * 1000;

/**
 * Shared validation of onboarding state for candidate-pipeline users.
 * Manual / bulk provisioning users have no onboarding subdocument and skip this.
 */
function assertOnboardingAllowsActivation(user) {
  const status = user.onboarding?.status;
  if (status === ONBOARDING_STATUSES.REJECTED) {
    throw new HttpError(403, "This candidate onboarding has been rejected. Account activation is not permitted.");
  }
  if (status === ONBOARDING_STATUSES.ACTIVATED) {
    throw new HttpError(409, "This account has already been activated. Please log in.");
  }
  // APPROVED also covers legacy accounts that were approved (with an Employee) before this change.
  if (!ONBOARDING_ACCOUNT_SETUP_STATUSES.includes(status)) {
    throw new HttpError(400, "Account cannot be activated before onboarding approval.");
  }
}

/**
 * Verify account-setup / activation token before presenting the password setup screen
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

    const user = (await models.User.findById(payload.userId)) || (await models.User.findOne({ email: payload.sub }));
    if (user) {
      if (user.onboarding) {
        assertOnboardingAllowsActivation(user);
      }
      if (user.isActive && user.lastLoginAt) {
        throw new HttpError(409, "This account activation link has already been used. Please log in.");
      }
    }

    if (models.AuthToken) {
      const tokenDoc = await findAuthTokenByRawToken(models.AuthToken, token);
      if (tokenDoc) {
        if (!tokenDoc.isActive || tokenDoc.usedAt) {
          throw new HttpError(409, "This account activation link has already been used. Please log in.");
        }
        if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
          throw new HttpError(400, "This activation link has expired. Ask HR to regenerate it.");
        }
      } else if (user && !user.onboarding) {
        // Manual/bulk activations always persist a hashed AuthToken row.
        throw new HttpError(400, "This activation link is invalid or has expired.");
      }
    }

    const employeeId = payload.employeeId || user?.onboarding?.employeeId || user?.employeeId || null;
    const employee = employeeId ? await models.Employee.findById(employeeId).lean() : null;

    // Candidate pipeline: Employee does not exist until activation completes.
    if (!employee && user?.onboarding) {
      const ob = user.onboarding;
      let offer = null;
      if (ob.offerLetterId && models.OfferLetter) {
        offer = await models.OfferLetter.findById(ob.offerLetterId).select("position department").lean();
      }
      return res.json({
        valid: true,
        accountSetup: true,
        email: payload.sub,
        fullName: ob.personalDetails?.fullName?.trim() || ob.candidate?.fullName || "",
        employeeCode: "",
        jobTitle: offer?.position || "",
        department: offer?.department || "",
        company: {
          name: company.companyName,
          slug: company.slug,
        },
      });
    }

    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    res.json({
      valid: true,
      accountSetup: false,
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
 * Atomically claim the activation mutex for a candidate-pipeline user.
 * Returns the locked user document (post-update) or throws a 409 when another activation is
 * running / already completed.
 */
async function acquireActivationLock(models, userId) {
  const staleBefore = new Date(Date.now() - ACTIVATION_LOCK_STALE_MS);
  const locked = await models.User.findOneAndUpdate(
    {
      _id: userId,
      "onboarding.status": { $in: ONBOARDING_ACCOUNT_SETUP_STATUSES },
      $or: [
        { "onboarding.activationLockedAt": null },
        { "onboarding.activationLockedAt": { $exists: false } },
        { "onboarding.activationLockedAt": { $lt: staleBefore } },
      ],
    },
    { $set: { "onboarding.activationLockedAt": new Date() } },
    { returnDocument: "after" }
  );

  if (!locked) {
    const current = await models.User.findById(userId);
    if (current?.onboarding?.status === ONBOARDING_STATUSES.ACTIVATED) {
      throw new HttpError(409, "This account has already been activated. Please log in.");
    }
    if (current?.onboarding?.activationLockedAt) {
      throw new HttpError(409, "Account activation is already in progress. Please wait a moment.");
    }
    throw new HttpError(400, "Account cannot be activated before onboarding approval.");
  }
  return locked;
}

/**
 * Set password, complete account setup, create the Employee (candidate pipeline) and authenticate.
 *
 * This is the ONLY place a candidate's Employee + compensation are created.
 */
export async function completeActivation(req, res, next) {
  let models = null;
  let lockedUserId = null;
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

    models = await getCompanyModels(company);

    let user = await models.User.findById(payload.userId);
    if (!user) {
      user = await models.User.findOne({ email: payload.sub });
    }

    if (!user) {
      throw new HttpError(404, "User account not found for this employee.");
    }

    if (user.onboarding) {
      assertOnboardingAllowsActivation(user);
    }

    if (user.isActive && user.lastLoginAt) {
      throw new HttpError(409, "This account has already been activated. Please log in.");
    }

    if (models.AuthToken) {
      const tokenDoc = await findAuthTokenByRawToken(models.AuthToken, token);
      if (tokenDoc) {
        if (!tokenDoc.isActive || tokenDoc.usedAt) {
          throw new HttpError(409, "This account activation link has already been used. Please log in.");
        }
        if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
          throw new HttpError(400, "This activation link has expired. Ask HR to regenerate it.");
        }
      } else if (!user.onboarding) {
        throw new HttpError(400, "This activation link is invalid or has expired.");
      }
    }

    const passwordHash = await hashPassword(password);
    let employee = null;
    let employeeCreatedNow = false;
    let employeeCode = "";

    if (user.onboarding) {
      // ---- Candidate pipeline: lock, (create employee unless already linked), activate ----
      user = await acquireActivationLock(models, user._id);
      lockedUserId = user._id;

      const linkedEmployeeId = user.onboarding.employeeId || user.employeeId || payload.employeeId || null;
      if (linkedEmployeeId) {
        // Idempotent retry / legacy approval that already created the employee.
        employee = await models.Employee.findById(linkedEmployeeId);
        if (!employee) {
          throw new HttpError(404, "Employee profile not found.");
        }
      }

      const activatedAt = new Date();
      const actorUserId = user.onboarding.approvedBy || user._id;
      let created = null;
      let session = null;
      let useTransaction = false;
      const connection = models.connection || models.User.db;

      if (!employee && connectionSupportsTransactions(connection)) {
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
      const sessionOpt = useTransaction && session ? { session } : {};

      try {
        let offerLetter = null;
        if (!employee) {
          offerLetter = await models.OfferLetter.findById(user.onboarding.offerLetterId);
          const candidateEmail = await assertOfferReadyForConversion({
            Employee: models.Employee,
            offerLetter,
            candidateUser: user,
            acceptedStatus: OFFER_LETTER_STATUSES.ACCEPTED,
          });

          created = await createEmployeeFromOnboarding({
            models,
            company,
            candidateUser: user,
            offerLetter,
            candidateEmail,
            actorUserId,
            sessionOpt,
          });
          employee = created.employee;
          employeeCode = created.employeeCode;
          employeeCreatedNow = true;

          // Link offer letter to the created employee
          offerLetter.employeeId = employee._id;
          offerLetter.candidateUserId = user._id;
          await offerLetter.save(sessionOpt);
        } else {
          employeeCode = employee.employeeCode;
        }

        employee.userId = user._id;
        employee.invitation = {
          ...(employee.invitation?.toObject?.() || employee.invitation || {}),
          status: "ACCEPTED",
          token: "",
          acceptedAt: activatedAt,
        };
        await employee.save(sessionOpt);

        user.passwordHash = passwordHash;
        user.role = USER_ROLES.EMPLOYEE;
        user.isActive = true;
        user.employeeId = employee._id;
        user.lastLoginAt = activatedAt;
        user.onboarding.employeeId = employee._id;
        user.onboarding.status = ONBOARDING_STATUSES.ACTIVATED;
        user.onboarding.accountActivatedAt = activatedAt;
        user.onboarding.activationLockedAt = null;
        user.onboarding.history.push({
          action: "ACTIVATED",
          timestamp: activatedAt,
          actorRole: "CANDIDATE",
          notes: employeeCreatedNow
            ? `Account activated. Employee profile created with code ${employeeCode}.`
            : "Account activated.",
        });
        await user.save(sessionOpt);

        if (useTransaction && session) {
          await session.commitTransaction();
          await session.endSession();
          session = null;
        }
        lockedUserId = null; // lock cleared as part of the same save
      } catch (activationErr) {
        if (useTransaction && session) {
          try {
            await session.abortTransaction();
          } catch {}
          try {
            await session.endSession();
          } catch {}
          session = null;
        } else if (created) {
          // Safe compensating recovery for standalone/non-transactional databases
          await rollbackCreatedEmployee(models, created);
          try {
            await models.OfferLetter.updateOne(
              { _id: user.onboarding.offerLetterId, employeeId: created.employee?._id },
              { $set: { employeeId: null } }
            );
          } catch {}
        }
        throw activationErr;
      }
    } else {
      // ---- Manual / bulk provisioning: Employee already exists ----
      if (!payload.employeeId) {
        throw new HttpError(400, "This activation link is invalid or has expired.");
      }
      employee = await models.Employee.findById(payload.employeeId);
      if (!employee) {
        throw new HttpError(404, "Employee profile not found.");
      }

      employee.userId = user._id;
      employee.invitation = {
        ...(employee.invitation?.toObject?.() || employee.invitation || {}),
        status: "ACCEPTED",
        token: "",
        acceptedAt: new Date(),
      };
      await employee.save();

      user.passwordHash = passwordHash;
      user.role = USER_ROLES.EMPLOYEE;
      user.isActive = true;
      user.employeeId = employee._id;
      user.lastLoginAt = new Date();
      await user.save();
    }

    // Mark all activation/invite tokens for this email as used
    if (models.AuthToken) {
      await models.AuthToken.updateMany(
        { email: payload.sub, isActive: true },
        { isActive: false, usedAt: new Date() }
      );
    }

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
        if (employeeCreatedNow) {
          await models.AuditLog.create({
            actorUserId: user._id,
            actorEmail: user.email,
            actorRole: user.role,
            action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
            targetType: "Employee",
            targetId: employee._id,
            changes: {
              employeeCode: employee.employeeCode,
              fullName: employee.fullName,
              email: employee.email,
              joiningDate: employee.job?.joiningDate,
              source: "ACCOUNT_ACTIVATION",
            },
            ipAddress: req.ip || "",
            timestamp: new Date(),
          });
        }
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
      } catch {
        // non-fatal
      }
    }

    if (user.onboarding) {
      const eventBase = {
        companyId: company._id,
        submissionId: user._id,
        status: ONBOARDING_STATUSES.ACTIVATED,
      };
      if (employeeCreatedNow) {
        emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.EMPLOYEE_CREATED });
      }
      emitOnboardingEvent({ ...eventBase, type: ONBOARDING_EVENT_TYPES.ACCOUNT_ACTIVATED });
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
    // Release the activation mutex if we failed before it was cleared by the activation save.
    if (models && lockedUserId) {
      try {
        await models.User.updateOne(
          { _id: lockedUserId },
          { $set: { "onboarding.activationLockedAt": null } }
        );
      } catch {}
    }
    next(error);
  }
}

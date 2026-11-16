import { LOGIN_ALLOWED_STATUSES } from "../models/Company.js";
import { findCompanyById, getCompanyModels } from "../config/db.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { HttpError } from "../utils/httpError.js";
import { verifyAuthToken } from "../utils/token.js";
import { assertSubscriptionAllowsAccess } from "../utils/subscriptionAccess.js";
import { isPlatformMaintenanceEnabled } from "../services/platformSettingsService.js";

const AUTH_SESSION_SELECT = "token isActive clientPlatform userId expiresAt";

/**
 * F49 — Auth-path User projection: identity + access fields only.
 * Excludes passwordHash, large onboarding payloads, and unused nested docs.
 */
export const AUTH_USER_SELECT = [
  "_id",
  "email",
  "role",
  "isActive",
  "fullName",
  "name",
  "employeeId",
  "hrAccess",
  "preferences.emailNotifications",
  "onboarding.status",
].join(" ");

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers?.authorization;
    const headerToken =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
    // Prefer the explicit Authorization header so a newly issued login token is
    // not shadowed by a leftover httpOnly cookie from a previous account.
    const token = headerToken || req.cookies?.[getAuthCookieName()];

    if (!token) {
      throw new HttpError(401, "Authentication required");
    }

    let payload;
    try {
      payload = verifyAuthToken(token);
    } catch {
      throw new HttpError(401, "Invalid or expired credentials");
    }

    // F49: short-lived company metadata cache (status + tenant databaseName).
    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(401, "Invalid or expired credentials");
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(403, "This company is not available", {
        code: "COMPANY_SUSPENDED",
      });
    }

    assertSubscriptionAllowsAccess(company);

    const maintenance = await isPlatformMaintenanceEnabled();
    if (maintenance.enabled) {
      throw new HttpError(503, maintenance.message, {
        code: "PLATFORM_MAINTENANCE",
      });
    }

    const models = await getCompanyModels(company);

    // F49: lean projected User + AuthSession in parallel; one session read by token.
    const [user, session] = await Promise.all([
      models.User.findById(payload.sub).select(AUTH_USER_SELECT).lean(),
      models.AuthSession
        ? models.AuthSession.findOne({ token }).select(AUTH_SESSION_SELECT).lean()
        : Promise.resolve(null),
    ]);

    if (!user || !user.isActive || user.role === "CANDIDATE") {
      throw new HttpError(401, "Invalid or expired credentials");
    }

    // APPROVED = legacy approved+activated accounts; ACTIVATED = account setup completed.
    if (
      user.onboarding &&
      user.onboarding.status &&
      user.onboarding.status !== "APPROVED" &&
      user.onboarding.status !== "ACTIVATED"
    ) {
      throw new HttpError(
        401,
        "Candidate onboarding must be approved before employee portal access is permitted"
      );
    }

    if (models.AuthSession) {
      // Missing row: allow (legacy / edge). Inactive row: logout/revoke.
      // Active row: accept. Single find preserves prior two-step semantics.
      if (session && session.isActive === false) {
        throw new HttpError(401, "Session has been logged out");
      }
    }

    req.auth = {
      user,
      company,
      models,
      // F49: reuse for platform resolution without a second AuthSession query.
      session: session && session.isActive ? session : null,
      token,
    };

    next();
  } catch (error) {
    next(error);
  }
}

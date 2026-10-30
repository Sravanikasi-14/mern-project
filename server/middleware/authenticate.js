import { LOGIN_ALLOWED_STATUSES } from "../models/Company.js";
import { findCompanyById, getCompanyModels } from "../config/db.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { HttpError } from "../utils/httpError.js";
import { verifyAuthToken } from "../utils/token.js";

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers?.authorization;
    const headerToken = authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
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

    const company = await findCompanyById(payload.companyId);
    if (!company) {
      throw new HttpError(401, "Invalid or expired credentials");
    }

    if (!LOGIN_ALLOWED_STATUSES.has(company.status)) {
      throw new HttpError(403, "This company is not available");
    }

    const models = await getCompanyModels(company);
    const user = await models.User.findById(payload.sub);

    if (!user || !user.isActive || user.role === "CANDIDATE") {
      throw new HttpError(401, "Invalid or expired credentials");
    }

    if (user.onboarding && user.onboarding.status && user.onboarding.status !== "APPROVED") {
      throw new HttpError(401, "Candidate onboarding must be approved before employee portal access is permitted");
    }

    if (models.AuthSession) {
      const revoked = await models.AuthSession.findOne({
        token,
        isActive: false,
      });
      if (revoked) {
        throw new HttpError(401, "Session has been logged out");
      }
    }

    req.auth = {
      user,
      company,
      models,
    };

    next();
  } catch (error) {
    next(error);
  }
}

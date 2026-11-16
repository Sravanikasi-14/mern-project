import PlatformAdmin from "../models/PlatformAdmin.js";
import PlatformAdminSession from "../models/PlatformAdminSession.js";
import { getPlatformAuthCookieName } from "../utils/platformAuthCookie.js";
import { isPlatformAdminDevMfaBypassEnabled } from "../utils/platformDevMfaBypass.js";
import { verifyPlatformAuthToken } from "../utils/platformToken.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Authenticates a fully MFA-completed Platform Admin session.
 * Does not attach tenant models — platform handlers must not call getCompanyModels.
 */
export async function authenticatePlatformAdmin(req, _res, next) {
  try {
    const authHeader = req.headers?.authorization;
    const headerToken =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
    const token = headerToken || req.cookies?.[getPlatformAuthCookieName()];

    if (!token) {
      throw new HttpError(401, "Platform authentication required", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    let payload;
    try {
      payload = verifyPlatformAuthToken(token);
    } catch {
      throw new HttpError(401, "Invalid or expired platform credentials", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    if (payload.typ !== "platform_admin") {
      throw new HttpError(401, "Invalid or expired platform credentials", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    const [admin, session] = await Promise.all([
      PlatformAdmin.findById(payload.sub)
        .select("_id email fullName isActive mfaEnabled mfaVerifiedAt lastLoginAt createdAt")
        .lean(),
      PlatformAdminSession.findOne({ token })
        .select("token isActive platformAdminId expiresAt")
        .lean(),
    ]);

    if (!admin || !admin.isActive) {
      throw new HttpError(401, "Invalid or expired platform credentials", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    // Production and non-dev environments still require MFA enrollment.
    // Development-only bypass allows a password-issued session without mutating MFA state.
    if (!admin.mfaEnabled && !isPlatformAdminDevMfaBypassEnabled()) {
      throw new HttpError(403, "MFA enrollment is required before accessing the platform", {
        code: "PLATFORM_MFA_REQUIRED",
      });
    }

    if (!session || session.isActive === false) {
      throw new HttpError(401, "Platform session has been logged out", {
        code: "PLATFORM_SESSION_REVOKED",
      });
    }

    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(401, "Invalid or expired platform credentials", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    if (String(session.platformAdminId) !== String(admin._id)) {
      throw new HttpError(401, "Invalid or expired platform credentials", {
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    req.platformAuth = {
      admin,
      session,
      token,
    };
    next();
  } catch (err) {
    next(err);
  }
}

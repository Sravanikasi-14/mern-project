import PlatformAdmin from "../models/PlatformAdmin.js";
import { hashPassword } from "../utils/password.js";
import { isPlatformAdminDevMfaBypassEnabled } from "../utils/platformDevMfaBypass.js";

/** Same policy as bootstrapPlatformAdmin.js */
export const PLATFORM_ADMIN_PASSWORD_MIN_LENGTH = 12;

/**
 * Password reset is development-only (same NODE_ENV gate as MFA bypass).
 * Always refused when NODE_ENV is production.
 */
export function assertPlatformAdminPasswordResetAllowed() {
  if (!isPlatformAdminDevMfaBypassEnabled()) {
    throw new Error(
      "Platform Admin password reset is allowed only when NODE_ENV=development"
    );
  }
}

export function validatePlatformAdminPassword(password) {
  if (typeof password !== "string" || !password) {
    throw new Error("New password is required");
  }
  if (password.length < PLATFORM_ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `New password must be at least ${PLATFORM_ADMIN_PASSWORD_MIN_LENGTH} characters`
    );
  }
}

/**
 * Reset password for the singleton active Platform Admin.
 * Updates only passwordHash + passwordChangedAt. Does not change email, MFA, or status.
 *
 * @returns {{ id: string, email: string }} Safe identifiers only — never returns secrets.
 */
export async function resetActivePlatformAdminPassword(newPassword) {
  assertPlatformAdminPasswordResetAllowed();
  validatePlatformAdminPassword(newPassword);

  const admin = await PlatformAdmin.findOne({ isActive: true }).select(
    "+passwordHash _id email isActive mfaEnabled"
  );
  if (!admin) {
    throw new Error("No active Platform Admin found to reset");
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await PlatformAdmin.findOneAndUpdate(
    { _id: admin._id, isActive: true },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    },
    {
      returnDocument: "after",
      select: "_id email isActive mfaEnabled mfaVerifiedAt fullName",
    }
  );

  if (!updated) {
    throw new Error("No active Platform Admin found to reset");
  }

  return {
    id: String(updated._id),
    email: updated.email,
  };
}

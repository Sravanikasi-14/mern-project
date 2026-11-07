import { USER_ROLES } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Company Admin foundation helpers (Phase CA1).
 *
 * Constraint: each company tenant database may have at most one User with
 * role=COMPANY_ADMIN and isActive=true. Enforced by:
 *   1. Partial unique MongoDB index `unique_active_company_admin` on User.
 *   2. Pre-checks in these helpers (fast-fail before write).
 *   3. Mapping duplicate-key (E11000) to HTTP 409 for concurrent races.
 *
 * Recovery (trusted administrative process):
 *   - Deactivate the current active Company Admin (isActive=false).
 *   - Create or activate the replacement Company Admin.
 *   - Inactive Company Admin rows may remain for audit; they do not block a new active one.
 */

function isDuplicateKeyError(error) {
  return Boolean(
    error &&
      (error.code === 11000 ||
        error.code === 11001 ||
        String(error.message || "").includes("E11000") ||
        String(error.message || "").includes("unique_active_company_admin"))
  );
}

function conflictActiveCompanyAdmin() {
  return new HttpError(
    409,
    "This company already has an active Company Admin. Deactivate the current Company Admin before assigning another.",
    { code: "COMPANY_ADMIN_ALREADY_ACTIVE" }
  );
}

/**
 * @param {import("mongoose").Model} User
 */
export async function findActiveCompanyAdmin(User) {
  return User.findOne({
    role: USER_ROLES.COMPANY_ADMIN,
    isActive: true,
  }).lean();
}

/**
 * Create a Company Admin user. Fails if an active Company Admin already exists.
 * @param {import("mongoose").Model} User
 * @param {{ email: string, passwordHash: string, fullName?: string, phoneNumber?: string, isActive?: boolean }} data
 */
export async function createCompanyAdmin(User, data) {
  const wantActive = data.isActive !== false;
  if (wantActive) {
    const existing = await findActiveCompanyAdmin(User);
    if (existing) throw conflictActiveCompanyAdmin();
  }

  try {
    return await User.create({
      email: String(data.email || "")
        .trim()
        .toLowerCase(),
      passwordHash: data.passwordHash,
      role: USER_ROLES.COMPANY_ADMIN,
      isActive: wantActive,
      fullName: data.fullName || "",
      phoneNumber: data.phoneNumber || "",
      schemaVersion: 1,
    });
  } catch (error) {
    if (wantActive && isDuplicateKeyError(error)) {
      throw conflictActiveCompanyAdmin();
    }
    throw error;
  }
}

/**
 * Activate an existing Company Admin account. Fails if another active Company Admin exists.
 * @param {import("mongoose").Model} User
 * @param {string|import("mongoose").Types.ObjectId} userId
 */
export async function activateCompanyAdmin(User, userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new HttpError(404, "User not found", { code: "USER_NOT_FOUND" });
  }
  if (user.role !== USER_ROLES.COMPANY_ADMIN) {
    throw new HttpError(400, "User is not a Company Admin account.", {
      code: "NOT_COMPANY_ADMIN",
    });
  }
  if (user.isActive) {
    return user;
  }

  const existing = await findActiveCompanyAdmin(User);
  if (existing && String(existing._id) !== String(user._id)) {
    throw conflictActiveCompanyAdmin();
  }

  user.isActive = true;
  try {
    await user.save();
    return user;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw conflictActiveCompanyAdmin();
    }
    throw error;
  }
}

/**
 * Deactivate the Company Admin so a replacement can be activated/created.
 * @param {import("mongoose").Model} User
 * @param {string|import("mongoose").Types.ObjectId} userId
 */
export async function deactivateCompanyAdmin(User, userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new HttpError(404, "User not found", { code: "USER_NOT_FOUND" });
  }
  if (user.role !== USER_ROLES.COMPANY_ADMIN) {
    throw new HttpError(400, "User is not a Company Admin account.", {
      code: "NOT_COMPANY_ADMIN",
    });
  }
  if (!user.isActive) {
    return user;
  }
  user.isActive = false;
  await user.save();
  return user;
}

export { isDuplicateKeyError };

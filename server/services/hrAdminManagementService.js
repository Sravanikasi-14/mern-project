import crypto from "node:crypto";
import { USER_ROLES } from "../models/User.js";
import { TOKEN_TYPES } from "../models/AuthToken.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { emailService } from "./emailService.js";
import { isHrAccessConfigured, serializeHrAccess } from "./hrAccessConfigService.js";
import { hashAuthToken, findAuthTokenByRawToken } from "../utils/authTokenHash.js";
import { signHrAdminInvitationToken } from "../utils/onboardingToken.js";
import { hashPassword } from "../utils/password.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { serializeLinkedEmployee, linkPortalOperatorEmployee } from "./portalIdentityLinkService.js";
import { HttpError } from "../utils/httpError.js";

const INVITE_TTL_MS = (() => {
  const raw = process.env.HR_ADMIN_INVITATION_EXPIRES_IN || process.env.ONBOARDING_TOKEN_EXPIRES_IN || "7d";
  const match = String(raw).trim().match(/^(\d+)([dhms])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult = unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
  return n * mult;
})();

export const HR_INVITATION_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
});

function clientBase() {
  return String(process.env.CLIENT_URL || process.env.APP_BASE_URL || "http://localhost:5173").replace(
    /\/$/,
    ""
  );
}

function inviteLinkFor(rawToken) {
  return `${clientBase()}/onboard?token=${encodeURIComponent(rawToken)}`;
}

async function writeAudit(models, { actor, action, targetId, changes = {}, ipAddress = "" }) {
  if (!models.AuditLog || !targetId) return;
  try {
    await models.AuditLog.create({
      actorUserId: actor?._id || null,
      actorEmail: actor?.email || "system",
      actorRole: actor?.role || USER_ROLES.COMPANY_ADMIN,
      action,
      targetType: "User",
      targetId,
      changes,
      ipAddress: ipAddress || "",
      timestamp: new Date(),
    });
  } catch {
    // Audit must not block the primary action.
  }
}

async function revokeAuthSessions(models, userId) {
  if (!models.AuthSession || !userId) return;
  await models.AuthSession.updateMany({ userId, isActive: true }, { isActive: false });
}

async function invalidateHrInviteTokens(models, email) {
  if (!models.AuthToken) return;
  await models.AuthToken.updateMany(
    { email: normalizeEmail(email), role: "HR_ADMIN", isActive: true },
    { isActive: false, usedAt: new Date() }
  );
}

async function issueHrInviteToken({ models, company, user, actorUserId }) {
  const rawToken = signHrAdminInvitationToken({
    companyId: company._id,
    userId: user._id,
    email: user.email,
  });
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await invalidateHrInviteTokens(models, user.email);

  if (models.AuthToken) {
    await models.AuthToken.create({
      userId: user._id,
      email: user.email,
      token: tokenHash,
      type: TOKEN_TYPES.INVITATION,
      role: "HR_ADMIN",
      expiresAt,
      createdBy: actorUserId || null,
      isActive: true,
    });
  }

  return { rawToken, inviteLink: inviteLinkFor(rawToken), expiresAt };
}

/**
 * Derive display invitation status. Expired is computed for PENDING past expiresAt.
 */
export function resolveHrInvitationStatus(user, now = new Date()) {
  const inv = user?.hrInvitation;
  if (!inv?.status) {
    if (user?.isActive) return HR_INVITATION_STATUSES.ACCEPTED;
    return null;
  }
  if (inv.status === HR_INVITATION_STATUSES.PENDING && inv.expiresAt && new Date(inv.expiresAt) < now) {
    return HR_INVITATION_STATUSES.EXPIRED;
  }
  return inv.status;
}

function serializeHrAdmin(user, employee = null) {
  const invitationStatus = resolveHrInvitationStatus(user);
  const access = serializeHrAccess(user.hrAccess);
  return {
    id: String(user._id),
    fullName: user.fullName || "",
    email: user.email,
    isActive: Boolean(user.isActive),
    accountStatus: user.isActive ? "ACTIVE" : "INACTIVE",
    invitationStatus,
    accessConfigured: isHrAccessConfigured(user.hrAccess),
    accessSummary: access.summary,
    createdAt: user.createdAt || null,
    invitedAt: user.hrInvitation?.sentAt || user.createdAt || null,
    acceptedAt: user.hrInvitation?.acceptedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    expiresAt: user.hrInvitation?.expiresAt || null,
    employeeProfile: employee ? serializeLinkedEmployee(employee) : null,
  };
}

async function employeeProfilesByUser(models, users) {
  const ids = users.map((user) => user.employeeId).filter(Boolean);
  if (!ids.length || !models.Employee) return new Map();
  const employees = await models.Employee.find({ _id: { $in: ids } })
    .select("employeeCode fullName email status job userId")
    .lean();
  return new Map(employees.map((employee) => [String(employee._id), employee]));
}

export async function listHrAdmins({ models, query = {} }) {
  const { User } = models;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const statusFilter = String(query.status || "ALL").toUpperCase();
  const invitationFilter = String(query.invitationStatus || "ALL").toUpperCase();

  const filter = { role: USER_ROLES.HR_ADMIN };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { fullName: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
    ];
  }
  if (statusFilter === "ACTIVE") filter.isActive = true;
  if (statusFilter === "INACTIVE") filter.isActive = false;

  const docs = await User.find(filter)
    .select("fullName email isActive lastLoginAt createdAt hrInvitation hrAccess employeeId")
    .sort({ createdAt: -1 })
    .lean();

  const profiles = await employeeProfilesByUser(models, docs);
  const now = new Date();
  let items = docs.map((d) => {
    const employee = d.employeeId ? profiles.get(String(d.employeeId)) : null;
    const linked =
      employee && employee.userId && String(employee.userId) === String(d._id) ? employee : null;
    const serialized = serializeHrAdmin(d, linked);
    // Persist computed EXPIRED for filter consistency without write storms
    return serialized;
  });

  if (invitationFilter !== "ALL") {
    items = items.filter((item) => item.invitationStatus === invitationFilter);
  }

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  const summary = {
    total: docs.length,
    active: docs.filter((d) => d.isActive).length,
    inactive: docs.filter((d) => !d.isActive).length,
    pendingInvitations: docs.filter(
      (d) => resolveHrInvitationStatus(d, now) === HR_INVITATION_STATUSES.PENDING
    ).length,
  };

  return {
    items: paged,
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getHrAdminById({ models, hrAdminId }) {
  const user = await models.User.findOne({
    _id: hrAdminId,
    role: USER_ROLES.HR_ADMIN,
  })
    .select("fullName email isActive lastLoginAt createdAt hrInvitation hrAccess employeeId")
    .lean();

  if (!user) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }
  const profiles = await employeeProfilesByUser(models, [user]);
  const employee = user.employeeId ? profiles.get(String(user.employeeId)) : null;
  const linked =
    employee && employee.userId && String(employee.userId) === String(user._id) ? employee : null;
  return serializeHrAdmin(user, linked);
}

export async function inviteHrAdmin({
  models,
  company,
  actor,
  fullName,
  email,
  ipAddress = "",
}) {
  const { User } = models;
  const name = typeof fullName === "string" ? fullName.trim() : "";
  const normalizedEmail = normalizeEmail(email);

  if (!name) {
    throw new HttpError(400, "Name is required.", {
      code: "INVALID_INPUT",
      errors: { fullName: "Name is required." },
    });
  }
  if (!isValidEmail(normalizedEmail)) {
    throw new HttpError(400, "Please enter a valid email address.", {
      code: "INVALID_INPUT",
      errors: { email: "Please enter a valid email address." },
    });
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    if (existing.role === USER_ROLES.HR_ADMIN && existing.isActive) {
      throw new HttpError(409, "An active HR Admin with this email already exists.", {
        code: "HR_ADMIN_EXISTS",
      });
    }
    if (
      existing.role === USER_ROLES.HR_ADMIN &&
      resolveHrInvitationStatus(existing) === HR_INVITATION_STATUSES.PENDING
    ) {
      throw new HttpError(409, "A pending invitation already exists for this email.", {
        code: "INVITATION_PENDING",
      });
    }
    if (existing.role === USER_ROLES.COMPANY_ADMIN) {
      throw new HttpError(409, "This email belongs to the Company Admin account.", {
        code: "EMAIL_IN_USE",
      });
    }
    throw new HttpError(409, "This email is already registered in the company workspace.", {
      code: "EMAIL_IN_USE",
    });
  }

  const placeholderHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
  const user = await User.create({
    email: normalizedEmail,
    passwordHash: placeholderHash,
    role: USER_ROLES.HR_ADMIN,
    fullName: name,
    isActive: false,
    lastLoginAt: null,
    hrInvitation: {
      status: HR_INVITATION_STATUSES.PENDING,
      sentAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: null,
      invitedBy: actor?._id || null,
    },
    schemaVersion: 1,
  });

  const issued = await issueHrInviteToken({
    models,
    company,
    user,
    actorUserId: actor?._id,
  });

  user.hrInvitation.expiresAt = issued.expiresAt;
  user.hrInvitation.sentAt = new Date();
  await user.save();

  const mailResult = await emailService.sendHrAdminInvitation({
    companyName: company.companyName,
    hrAdminName: name,
    email: normalizedEmail,
    inviteLink: issued.inviteLink,
    company,
  });

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_INVITED,
    targetId: user._id,
    changes: {
      email: normalizedEmail,
      fullName: name,
      emailSent: Boolean(mailResult?.success),
    },
    ipAddress,
  });

  return {
    hrAdmin: serializeHrAdmin(user.toObject ? user.toObject() : user),
    inviteLink: issued.inviteLink,
    expiresAt: issued.expiresAt,
    emailSent: Boolean(mailResult?.success),
    emailError: mailResult?.success ? null : mailResult?.error || "Email delivery failed",
  };
}

export async function resendHrAdminInvitation({
  models,
  company,
  actor,
  hrAdminId,
  ipAddress = "",
}) {
  const user = await models.User.findOne({
    _id: hrAdminId,
    role: USER_ROLES.HR_ADMIN,
  });
  if (!user) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }

  const status = resolveHrInvitationStatus(user);
  if (user.isActive && user.lastLoginAt) {
    throw new HttpError(400, "This HR Admin has already activated their account.", {
      code: "ALREADY_ACTIVATED",
    });
  }
  if (status === HR_INVITATION_STATUSES.REVOKED) {
    throw new HttpError(400, "This invitation was revoked and cannot be resent.", {
      code: "INVITATION_REVOKED",
    });
  }
  if (status === HR_INVITATION_STATUSES.ACCEPTED) {
    throw new HttpError(400, "This invitation was already accepted.", {
      code: "INVITATION_ACCEPTED",
    });
  }

  const issued = await issueHrInviteToken({
    models,
    company,
    user,
    actorUserId: actor?._id,
  });

  user.hrInvitation = {
    ...(user.hrInvitation?.toObject?.() || user.hrInvitation || {}),
    status: HR_INVITATION_STATUSES.PENDING,
    sentAt: new Date(),
    expiresAt: issued.expiresAt,
    revokedAt: null,
    invitedBy: actor?._id || user.hrInvitation?.invitedBy || null,
  };
  user.isActive = false;
  await user.save();

  const mailResult = await emailService.sendHrAdminInvitation({
    companyName: company.companyName,
    hrAdminName: user.fullName || "HR Admin",
    email: user.email,
    inviteLink: issued.inviteLink,
    company,
  });

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_INVITE_RESENT,
    targetId: user._id,
    changes: { email: user.email, emailSent: Boolean(mailResult?.success) },
    ipAddress,
  });

  return {
    hrAdmin: serializeHrAdmin(user.toObject ? user.toObject() : user),
    inviteLink: issued.inviteLink,
    expiresAt: issued.expiresAt,
    emailSent: Boolean(mailResult?.success),
    emailError: mailResult?.success ? null : mailResult?.error || "Email delivery failed",
  };
}

export async function revokeHrAdminInvitation({ models, actor, hrAdminId, ipAddress = "" }) {
  const user = await models.User.findOne({
    _id: hrAdminId,
    role: USER_ROLES.HR_ADMIN,
  });
  if (!user) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }

  const status = resolveHrInvitationStatus(user);
  if (status !== HR_INVITATION_STATUSES.PENDING && status !== HR_INVITATION_STATUSES.EXPIRED) {
    throw new HttpError(400, "Only pending or expired invitations can be revoked.", {
      code: "INVITATION_NOT_REVOCABLE",
    });
  }

  await invalidateHrInviteTokens(models, user.email);

  user.hrInvitation = {
    ...(user.hrInvitation?.toObject?.() || user.hrInvitation || {}),
    status: HR_INVITATION_STATUSES.REVOKED,
    revokedAt: new Date(),
  };
  user.isActive = false;
  await user.save();
  await revokeAuthSessions(models, user._id);

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_INVITE_REVOKED,
    targetId: user._id,
    changes: { email: user.email },
    ipAddress,
  });

  return { hrAdmin: serializeHrAdmin(user.toObject ? user.toObject() : user) };
}

export async function deactivateHrAdmin({ models, actor, hrAdminId, ipAddress = "" }) {
  const user = await models.User.findOne({
    _id: hrAdminId,
    role: USER_ROLES.HR_ADMIN,
  });
  if (!user) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }
  if (!user.isActive) {
    throw new HttpError(400, "This HR Admin account is already inactive.", {
      code: "ALREADY_INACTIVE",
    });
  }

  user.isActive = false;
  await user.save();
  await revokeAuthSessions(models, user._id);

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_DEACTIVATED,
    targetId: user._id,
    changes: { email: user.email, isActive: false },
    ipAddress,
  });

  return { hrAdmin: serializeHrAdmin(user.toObject ? user.toObject() : user) };
}

export async function activateHrAdmin({ models, actor, hrAdminId, ipAddress = "" }) {
  const user = await models.User.findOne({
    _id: hrAdminId,
    role: USER_ROLES.HR_ADMIN,
  });
  if (!user) {
    throw new HttpError(404, "HR Admin account not found.", { code: "HR_ADMIN_NOT_FOUND" });
  }
  if (user.isActive) {
    throw new HttpError(400, "This HR Admin account is already active.", {
      code: "ALREADY_ACTIVE",
    });
  }

  const status = resolveHrInvitationStatus(user);
  if (status === HR_INVITATION_STATUSES.PENDING || status === HR_INVITATION_STATUSES.EXPIRED) {
    throw new HttpError(
      400,
      "This account has not completed invitation acceptance. Resend the invitation instead.",
      { code: "INVITATION_INCOMPLETE" }
    );
  }
  if (status === HR_INVITATION_STATUSES.REVOKED) {
    throw new HttpError(400, "This invitation was revoked. Invite the HR Admin again.", {
      code: "INVITATION_REVOKED",
    });
  }
  if (!user.lastLoginAt && status !== HR_INVITATION_STATUSES.ACCEPTED) {
    throw new HttpError(
      400,
      "This account cannot be activated until the invitation has been accepted.",
      { code: "INVITATION_INCOMPLETE" }
    );
  }

  user.isActive = true;
  await user.save();

  await writeAudit(models, {
    actor,
    action: AUDIT_ACTIONS.HR_ADMIN_ACTIVATED,
    targetId: user._id,
    changes: { email: user.email, isActive: true },
    ipAddress,
  });

  return { hrAdmin: serializeHrAdmin(user.toObject ? user.toObject() : user) };
}

/**
 * Accept a CA3 HR Admin invitation: set password, activate, consume token.
 * Called from authController when purpose === hr_admin_invitation.
 */
export async function acceptHrAdminInvitation({
  models,
  company,
  payload,
  rawToken,
  password,
  req,
}) {
  const { User, AuthToken } = models;

  if (AuthToken) {
    const tokenDoc = await findAuthTokenByRawToken(AuthToken, rawToken, {
      role: "HR_ADMIN",
    });
    if (!tokenDoc) {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }
    if (!tokenDoc.isActive || tokenDoc.usedAt) {
      throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
    }
    if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }
  }

  let user = payload.userId ? await User.findById(payload.userId).select("+passwordHash") : null;
  if (!user) {
    user = await User.findOne({ email: payload.sub }).select("+passwordHash");
  }
  if (!user || user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(404, "HR Admin invitation account not found.");
  }

  const status = resolveHrInvitationStatus(user);
  if (status === HR_INVITATION_STATUSES.REVOKED) {
    throw new HttpError(400, "This invitation has been revoked.");
  }
  if (user.isActive && user.lastLoginAt) {
    throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
  }

  const passwordHash = await hashPassword(password);
  user.passwordHash = passwordHash;
  user.isActive = true;
  user.lastLoginAt = new Date();
  user.hrInvitation = {
    ...(user.hrInvitation?.toObject?.() || user.hrInvitation || {}),
    status: HR_INVITATION_STATUSES.ACCEPTED,
    acceptedAt: new Date(),
  };
  if (user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(409, "This account cannot be activated as an HR Admin.", {
      code: "ROLE_NOT_LINKABLE",
    });
  }
  await linkPortalOperatorEmployee({
    models,
    company,
    user,
    profile: {},
    updateEmployment: false,
  });
  await user.save();

  if (AuthToken) {
    await AuthToken.updateMany(
      { email: user.email, role: "HR_ADMIN", isActive: true },
      { isActive: false, usedAt: new Date() }
    );
  }

  await writeAudit(models, {
    actor: user,
    action: AUDIT_ACTIONS.HR_ADMIN_INVITE_ACCEPTED,
    targetId: user._id,
    changes: { email: user.email },
    ipAddress: req?.ip || "",
  });

  return { user, company };
}

export async function verifyHrAdminInvitationToken({ models, payload, rawToken }) {
  if (models.AuthToken) {
    const tokenDoc = await findAuthTokenByRawToken(models.AuthToken, rawToken, {
      role: "HR_ADMIN",
    });
    if (!tokenDoc) {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }
    if (!tokenDoc.isActive || tokenDoc.usedAt) {
      throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
    }
    if (tokenDoc.expiresAt && new Date(tokenDoc.expiresAt) < new Date()) {
      throw new HttpError(400, "Invalid or expired onboarding invitation link");
    }
  }

  let user = payload.userId
    ? await models.User.findById(payload.userId)
    : await models.User.findOne({ email: payload.sub });

  if (!user || user.role !== USER_ROLES.HR_ADMIN) {
    throw new HttpError(404, "HR Admin invitation account not found.");
  }

  const status = resolveHrInvitationStatus(user);
  if (status === HR_INVITATION_STATUSES.REVOKED) {
    throw new HttpError(400, "This invitation has been revoked.");
  }
  if (user.isActive && user.lastLoginAt) {
    throw new HttpError(409, "This onboarding invitation has already been completed. Please log in.");
  }

  return {
    valid: true,
    type: "HR_ADMIN",
    invitation: "hr_admin_invitation",
    email: user.email,
    fullName: user.fullName || "",
  };
}

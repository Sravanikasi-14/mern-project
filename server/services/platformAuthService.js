import crypto from "node:crypto";
import PlatformAdmin from "../models/PlatformAdmin.js";
import PlatformAdminSession from "../models/PlatformAdminSession.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { encryptSecret, decryptSecret } from "../utils/platformSecretCrypto.js";
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotpCode,
} from "../utils/platformTotp.js";
import {
  isPlatformAdminMfaBypassEnabled,
  platformAdminMfaBypassReason,
} from "../utils/platformDevMfaBypass.js";
import {
  signPlatformAuthToken,
  signPlatformMfaChallengeToken,
  verifyPlatformMfaChallengeToken,
} from "../utils/platformToken.js";
import {
  PLATFORM_AUDIT_ACTIONS,
  recordPlatformAudit,
} from "./platformAuditService.js";

const RECOVERY_CODE_COUNT = 10;

function clientMeta(req) {
  return {
    ipAddress: req?.ip || "",
    userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 300),
  };
}

function publicAdmin(admin) {
  return {
    id: String(admin._id),
    email: admin.email,
    fullName: admin.fullName,
    mfaEnabled: Boolean(admin.mfaEnabled),
    lastLoginAt: admin.lastLoginAt || null,
  };
}

function generateRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    codes.push(crypto.randomBytes(5).toString("hex"));
  }
  return codes;
}

async function hashRecoveryCodes(codes) {
  const hashes = [];
  for (const code of codes) {
    hashes.push(await hashPassword(code));
  }
  return hashes;
}

async function consumeRecoveryCode(adminDoc, code) {
  const hashes = adminDoc.mfaRecoveryCodeHashes || [];
  for (let i = 0; i < hashes.length; i += 1) {
    if (await verifyPassword(code, hashes[i])) {
      hashes.splice(i, 1);
      adminDoc.mfaRecoveryCodeHashes = hashes;
      await adminDoc.save();
      return true;
    }
  }
  return false;
}

async function issueSession(admin, req) {
  const { getPlatformSessionTtlMs } = await import("./platformSettingsService.js");
  const ttlMs = await getPlatformSessionTtlMs();
  const expiresInSeconds = Math.max(60, Math.floor(ttlMs / 1000));
  const token = signPlatformAuthToken({
    adminId: admin._id,
    expiresInSeconds,
  });
  const expiresAt = new Date(Date.now() + ttlMs);
  const meta = clientMeta(req);
  await PlatformAdminSession.create({
    platformAdminId: admin._id,
    token,
    isActive: true,
    expiresAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await PlatformAdmin.updateOne(
    { _id: admin._id },
    { $set: { lastLoginAt: new Date() } }
  );
  return { token, expiresAt, maxAgeMs: ttlMs, admin: publicAdmin(admin) };
}

export async function platformLogin({ email, password, req }) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized) || !password) {
    throw new HttpError(400, "Email and password are required", {
      code: "VALIDATION_ERROR",
    });
  }

  const admin = await PlatformAdmin.findOne({ email: normalized }).select(
    "+passwordHash +mfaSecretEncrypted +mfaRecoveryCodeHashes email fullName isActive mfaEnabled mfaVerifiedAt lastLoginAt"
  );

  const passwordOk = await verifyPassword(password, admin?.passwordHash);
  if (!admin || !admin.isActive || !passwordOk) {
    await recordPlatformAudit({
      actor: admin ? { _id: admin._id, email: admin.email } : { email: normalized },
      action: PLATFORM_AUDIT_ACTIONS.LOGIN_FAILURE,
      outcome: "FAILURE",
      metadata: { reason: "invalid_credentials" },
      req,
    });
    throw new HttpError(401, "Invalid email or password", {
      code: "PLATFORM_INVALID_CREDENTIALS",
    });
  }

  // Temporary MFA pause (PLATFORM_ADMIN_MFA_ENFORCEMENT) and/or development bypass:
  // issue a full session after password verification. MFA setup/verify APIs remain intact.
  if (isPlatformAdminMfaBypassEnabled()) {
    const via = platformAdminMfaBypassReason() || "mfa_bypass";
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.LOGIN_SUCCESS,
      outcome: "SUCCESS",
      metadata: { via, nodeEnv: process.env.NODE_ENV || "" },
      req,
    });
    const session = await issueSession(admin, req);
    return {
      ...session,
      mfaBypassed: true,
      requiresMfa: false,
      requiresMfaSetup: false,
    };
  }

  if (!admin.mfaEnabled) {
    const mfaToken = signPlatformMfaChallengeToken({
      adminId: admin._id,
      purpose: "mfa_setup",
    });
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.MFA_CHALLENGE_ISSUED,
      outcome: "SUCCESS",
      metadata: { purpose: "mfa_setup" },
      req,
    });
    return {
      requiresMfaSetup: true,
      mfaToken,
      admin: publicAdmin(admin),
    };
  }

  const mfaToken = signPlatformMfaChallengeToken({
    adminId: admin._id,
    purpose: "mfa_verify",
  });
  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.MFA_CHALLENGE_ISSUED,
    outcome: "SUCCESS",
    metadata: { purpose: "mfa_verify" },
    req,
  });
  return {
    requiresMfa: true,
    mfaToken,
    admin: publicAdmin(admin),
  };
}

async function loadAdminFromChallenge(mfaToken, expectedPurpose) {
  let payload;
  try {
    payload = verifyPlatformMfaChallengeToken(mfaToken);
  } catch {
    throw new HttpError(401, "MFA challenge expired or invalid", {
      code: "PLATFORM_MFA_CHALLENGE_INVALID",
    });
  }
  if (payload.typ !== "platform_mfa_challenge" || payload.purpose !== expectedPurpose) {
    throw new HttpError(401, "MFA challenge expired or invalid", {
      code: "PLATFORM_MFA_CHALLENGE_INVALID",
    });
  }
  const admin = await PlatformAdmin.findById(payload.sub).select(
    "+passwordHash +mfaSecretEncrypted +mfaRecoveryCodeHashes email fullName isActive mfaEnabled mfaVerifiedAt lastLoginAt"
  );
  if (!admin || !admin.isActive) {
    throw new HttpError(401, "MFA challenge expired or invalid", {
      code: "PLATFORM_MFA_CHALLENGE_INVALID",
    });
  }
  return admin;
}

export async function startMfaSetup({ mfaToken, req }) {
  const admin = await loadAdminFromChallenge(mfaToken, "mfa_setup");
  if (admin.mfaEnabled) {
    throw new HttpError(409, "MFA is already enabled", { code: "PLATFORM_MFA_ALREADY_ENABLED" });
  }

  const secret = generateTotpSecret();
  admin.mfaSecretEncrypted = encryptSecret(secret);
  await admin.save();

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.MFA_SETUP_STARTED,
    outcome: "SUCCESS",
    req,
  });

  return {
    secret,
    otpauthUrl: buildOtpAuthUrl({ secret, email: admin.email }),
    admin: publicAdmin(admin),
  };
}

export async function confirmMfaSetup({ mfaToken, code, req }) {
  const admin = await loadAdminFromChallenge(mfaToken, "mfa_setup");
  if (!admin.mfaSecretEncrypted) {
    throw new HttpError(400, "Start MFA setup before confirming", {
      code: "PLATFORM_MFA_SETUP_REQUIRED",
    });
  }
  const secret = decryptSecret(admin.mfaSecretEncrypted);
  if (!verifyTotpCode(secret, code)) {
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.MFA_VERIFY_FAILURE,
      outcome: "FAILURE",
      metadata: { stage: "setup_confirm" },
      req,
    });
    throw new HttpError(401, "Invalid MFA code", { code: "PLATFORM_MFA_INVALID" });
  }

  const recoveryCodes = generateRecoveryCodes();
  admin.mfaEnabled = true;
  admin.mfaVerifiedAt = new Date();
  admin.mfaRecoveryCodeHashes = await hashRecoveryCodes(recoveryCodes);
  await admin.save();

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.MFA_SETUP_COMPLETED,
    outcome: "SUCCESS",
    req,
  });
  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.LOGIN_SUCCESS,
    outcome: "SUCCESS",
    metadata: { via: "mfa_setup" },
    req,
  });

  const session = await issueSession(admin, req);
  return { ...session, recoveryCodes };
}

export async function verifyMfa({ mfaToken, code, recoveryCode, req }) {
  const admin = await loadAdminFromChallenge(mfaToken, "mfa_verify");
  if (!admin.mfaEnabled || !admin.mfaSecretEncrypted) {
    throw new HttpError(403, "MFA enrollment is required", {
      code: "PLATFORM_MFA_REQUIRED",
    });
  }

  let ok = false;
  let usedRecovery = false;
  if (recoveryCode) {
    ok = await consumeRecoveryCode(admin, String(recoveryCode).trim().toLowerCase());
    usedRecovery = ok;
  } else {
    const secret = decryptSecret(admin.mfaSecretEncrypted);
    ok = verifyTotpCode(secret, code);
  }

  if (!ok) {
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.MFA_VERIFY_FAILURE,
      outcome: "FAILURE",
      req,
    });
    throw new HttpError(401, "Invalid MFA code", { code: "PLATFORM_MFA_INVALID" });
  }

  await recordPlatformAudit({
    actor: admin,
    action: usedRecovery
      ? PLATFORM_AUDIT_ACTIONS.MFA_RECOVERY_USED
      : PLATFORM_AUDIT_ACTIONS.MFA_VERIFY_SUCCESS,
    outcome: "SUCCESS",
    req,
  });
  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.LOGIN_SUCCESS,
    outcome: "SUCCESS",
    metadata: { via: usedRecovery ? "recovery" : "totp" },
    req,
  });

  return issueSession(admin, req);
}

export async function platformLogout({ token, admin, req }) {
  if (token) {
    await PlatformAdminSession.updateOne(
      { token, isActive: true },
      { $set: { isActive: false, revokedAt: new Date() } }
    );
  }
  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.LOGOUT,
    outcome: "SUCCESS",
    req,
  });
}

export async function getPlatformMe(admin) {
  return { admin: publicAdmin(admin) };
}

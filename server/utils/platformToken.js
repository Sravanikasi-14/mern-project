import crypto from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * F85 — Platform JWT signing secret.
 * Production: PLATFORM_JWT_SECRET is required (fail closed; no JWT_SECRET fallback).
 * Non-production: PLATFORM_JWT_SECRET, else JWT_SECRET for local/test convenience.
 */
function platformSecret() {
  const dedicated = process.env.PLATFORM_JWT_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!dedicated || dedicated.length < 32) {
      throw new Error(
        "PLATFORM_JWT_SECRET must be set to at least 32 characters in production"
      );
    }
    return dedicated;
  }

  const secret = dedicated || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "PLATFORM_JWT_SECRET (or JWT_SECRET in non-production) must be at least 32 characters"
    );
  }
  return secret;
}

export function getPlatformJwtIssuer() {
  return process.env.PLATFORM_JWT_ISSUER || "hrms-platform-admin";
}

export function getPlatformJwtAudience() {
  return process.env.PLATFORM_JWT_AUDIENCE || "hrms-platform-admins";
}

export function getPlatformMfaAudience() {
  return process.env.PLATFORM_MFA_JWT_AUDIENCE || "hrms-platform-admin-mfa";
}

export function signPlatformAuthToken({ adminId, expiresInSeconds = null }) {
  const envFallback = process.env.PLATFORM_JWT_EXPIRES_IN || "8h";
  const expiresIn =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? Math.floor(expiresInSeconds)
      : envFallback;
  return jwt.sign(
    {
      sub: String(adminId),
      typ: "platform_admin",
      jti: crypto.randomUUID(),
    },
    platformSecret(),
    {
      expiresIn,
      issuer: getPlatformJwtIssuer(),
      audience: getPlatformJwtAudience(),
    }
  );
}

export function verifyPlatformAuthToken(token) {
  return jwt.verify(token, platformSecret(), {
    issuer: getPlatformJwtIssuer(),
    audience: getPlatformJwtAudience(),
  });
}

/** Short-lived challenge after password, before MFA verify/setup. */
export function signPlatformMfaChallengeToken({ adminId, purpose }) {
  if (!["mfa_verify", "mfa_setup"].includes(purpose)) {
    throw new Error("Invalid MFA challenge purpose");
  }
  return jwt.sign(
    {
      sub: String(adminId),
      typ: "platform_mfa_challenge",
      purpose,
      jti: crypto.randomUUID(),
    },
    platformSecret(),
    {
      expiresIn: process.env.PLATFORM_MFA_CHALLENGE_EXPIRES_IN || "5m",
      issuer: getPlatformJwtIssuer(),
      audience: getPlatformMfaAudience(),
    }
  );
}

export function verifyPlatformMfaChallengeToken(token) {
  return jwt.verify(token, platformSecret(), {
    issuer: getPlatformJwtIssuer(),
    audience: getPlatformMfaAudience(),
  });
}

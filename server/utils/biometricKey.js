import crypto from "node:crypto";
import { HttpError } from "./httpError.js";

/**
 * Production: FACE_BIOMETRIC_KEY must be set (≥32 chars).
 * Test: allows FACE_BIOMETRIC_KEY or a test default when NODE_ENV=test.
 * Never derives from JWT_SECRET. Never uses a hardcoded production fallback.
 */

const MIN_KEY_LEN = 32;

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

export function validateFaceBiometricKeyConfig({ throwOnError = true } = {}) {
  const raw = String(process.env.FACE_BIOMETRIC_KEY || process.env.HRMS_FACE_BIOMETRIC_KEY || "").trim();
  if (raw.length >= MIN_KEY_LEN) {
    return { ok: true, source: "FACE_BIOMETRIC_KEY", length: raw.length };
  }

  if (isProductionRuntime()) {
    const message =
      "FACE_BIOMETRIC_KEY is required in production (min 32 characters). " +
      "Generate with: openssl rand -base64 48. Do not reuse JWT_SECRET.";
    if (throwOnError) {
      throw new Error(message);
    }
    return { ok: false, message };
  }

  if (process.env.NODE_ENV === "test") {
    return { ok: true, source: "test-fallback", length: 0 };
  }

  // Non-production (dev): warn but allow only when explicitly opted in
  if (process.env.ALLOW_INSECURE_FACE_BIOMETRIC_FALLBACK === "true") {
    return { ok: true, source: "dev-insecure-fallback", length: 0 };
  }

  const message =
    "FACE_BIOMETRIC_KEY is missing or too short. Set a ≥32 character secret, " +
    "or for local dev only set ALLOW_INSECURE_FACE_BIOMETRIC_FALLBACK=true.";
  if (throwOnError) {
    throw new Error(message);
  }
  return { ok: false, message };
}

export function getBiometricEncryptionKeyBytes() {
  const raw = String(process.env.FACE_BIOMETRIC_KEY || process.env.HRMS_FACE_BIOMETRIC_KEY || "").trim();
  if (raw.length >= MIN_KEY_LEN) {
    return crypto.createHash("sha256").update(raw).digest();
  }

  if (isProductionRuntime()) {
    throw new HttpError(500, "FACE_BIOMETRIC_KEY is not configured.");
  }

  if (process.env.NODE_ENV === "test") {
    return crypto
      .createHash("sha256")
      .update("face:test-only-biometric-key-do-not-use-in-prod")
      .digest();
  }

  if (process.env.ALLOW_INSECURE_FACE_BIOMETRIC_FALLBACK === "true") {
    return crypto.createHash("sha256").update(`face:dev-fallback:${process.env.USER || "local"}`).digest();
  }

  throw new HttpError(500, "FACE_BIOMETRIC_KEY is not configured.");
}

/**
 * Key rotation note: changing FACE_BIOMETRIC_KEY invalidates existing ciphertext.
 * Re-enroll employees after rotation, or run a one-time decrypt-with-old / encrypt-with-new migration.
 */
export function biometricKeyMigrationNotes() {
  return {
    rotation:
      "Rotating FACE_BIOMETRIC_KEY makes existing embeddings undecryptable. " +
      "Revoke enrollments and require re-enrollment, or migrate offline with the previous key.",
    generate: "openssl rand -base64 48",
  };
}

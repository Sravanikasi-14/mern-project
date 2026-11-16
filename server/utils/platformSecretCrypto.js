import crypto from "node:crypto";

/**
 * Encrypt/decrypt Platform Admin MFA secrets at rest (AES-256-GCM).
 * Key: PLATFORM_MFA_ENCRYPTION_KEY (64 hex chars) or derived from PLATFORM_JWT_SECRET.
 */
function resolveKey() {
  const hex = process.env.PLATFORM_MFA_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }
  const secret = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PLATFORM_JWT_SECRET (or JWT_SECRET) must be set (≥32 chars) for MFA encryption");
  }
  return crypto.createHash("sha256").update(`hrms-platform-mfa:${secret}`).digest();
}

export function encryptSecret(plaintext) {
  const key = resolveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret payload");
  }
  const key = resolveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

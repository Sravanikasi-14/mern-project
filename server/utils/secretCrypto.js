import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const raw =
    process.env.EMAIL_SETTINGS_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "";

  if (!raw || raw.length < 16) {
    throw new Error(
      "EMAIL_SETTINGS_SECRET (or JWT_SECRET) must be set to encrypt SMTP credentials"
    );
  }

  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypts a secret string for storage (e.g. Gmail app password).
 * @param {string} plaintext
 * @returns {string} base64url payload: iv.ciphertext.tag
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("Cannot encrypt empty secret");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Decrypts a value produced by encryptSecret.
 * @param {string} payload
 * @returns {string}
 */
export function decryptSecret(payload) {
  if (typeof payload !== "string" || !payload.includes(".")) {
    throw new Error("Invalid encrypted secret payload");
  }

  const [ivB64, dataB64, tagB64] = payload.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("Invalid encrypted secret payload");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

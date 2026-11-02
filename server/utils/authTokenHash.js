import crypto from "node:crypto";

/**
 * Hash a raw activation/invite token for at-rest storage.
 * Only the hash is persisted; the raw token is returned once to HR.
 */
export function hashAuthToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) {
    throw new Error("Token is required for hashing");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Look up an AuthToken by raw token value.
 * Supports hashed storage (preferred) and legacy raw-JWT rows.
 */
export async function findAuthTokenByRawToken(AuthToken, rawToken, extraFilter = {}) {
  if (!AuthToken || !rawToken) return null;
  const tokenHash = hashAuthToken(rawToken);
  return AuthToken.findOne({
    ...extraFilter,
    $or: [{ token: tokenHash }, { token: rawToken }],
  });
}

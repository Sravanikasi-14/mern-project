import { resolveClientPlatformForAuthSession } from "./clientPlatform.js";
import { decodeAuthToken } from "./token.js";
import { hashRefreshToken, REFRESH_SESSION_MS } from "./refreshSession.js";

/**
 * Persist an AuthSession row with server-validated clientPlatform.
 * `refreshToken` is optional and used by the native apps only.
 */
export async function createAuthSessionRecord(models, { userId, token, req, refreshToken }) {
  if (!models?.AuthSession || !token || !userId) return null;

  const decoded = decodeAuthToken(token);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 8 * 60 * 60 * 1000);

  const doc = {
    userId,
    token,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
    clientPlatform: resolveClientPlatformForAuthSession(req),
    expiresAt,
    isActive: true,
  };

  if (refreshToken) {
    doc.refreshTokenHash = hashRefreshToken(refreshToken);
    doc.refreshExpiresAt = new Date(Date.now() + REFRESH_SESSION_MS);
  }

  return models.AuthSession.create(doc);
}

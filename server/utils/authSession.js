import { resolveClientPlatformForAuthSession } from "./clientPlatform.js";
import { decodeAuthToken } from "./token.js";

/**
 * Persist an AuthSession row with server-validated clientPlatform.
 */
export async function createAuthSessionRecord(models, { userId, token, req }) {
  if (!models?.AuthSession || !token || !userId) return null;

  const decoded = decodeAuthToken(token);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 8 * 60 * 60 * 1000);

  return models.AuthSession.create({
    userId,
    token,
    ipAddress: req?.ip || "",
    userAgent: req?.headers?.["user-agent"] || "",
    clientPlatform: resolveClientPlatformForAuthSession(req),
    expiresAt,
    isActive: true,
  });
}

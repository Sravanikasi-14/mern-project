import crypto from "node:crypto";

/** Mobile refresh sessions outlive the access JWT so a killed app can sign back in. */
export const REFRESH_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function generateRefreshToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Android/iOS clients identify themselves with this header.
 * Platform binding for tracking still requires the HMAC proof; this flag only
 * decides whether login may return a refresh token. Web logins omit the header.
 */
export function isNativeRefreshClient(req) {
  const platform = String(req?.headers?.["x-hrms-client-platform"] || "")
    .trim()
    .toLowerCase();
  return platform === "android" || platform === "ios";
}

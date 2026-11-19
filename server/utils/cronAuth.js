import crypto from "node:crypto";
import { HttpError } from "./httpError.js";

/**
 * Shared authentication for external / platform cron HTTP triggers.
 *
 * Secrets (never log these values):
 * - CRON_SECRET (preferred; used by Vercel Cron when configured)
 * - ANNOUNCEMENT_CRON_SECRET (legacy fallback for announcement + scheduler callers)
 *
 * Contract:
 * - Authorization: Bearer <secret>
 * - Constant-time compare when lengths match
 * - No user JWT / cookie auth
 *
 * @returns {"ok"|"denied"|"unconfigured"}
 */
export function resolveCronSecret() {
  const primary = String(process.env.CRON_SECRET || "").trim();
  if (primary) return primary;
  return String(process.env.ANNOUNCEMENT_CRON_SECRET || "").trim();
}

export function cronAuthorized(req) {
  const secret = resolveCronSecret();
  if (!secret) return "unconfigured";

  const header = String(
    typeof req?.get === "function"
      ? req.get("authorization") || req.get("Authorization") || ""
      : req?.headers?.authorization || req?.headers?.Authorization || ""
  );
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return "denied";

  const left = Buffer.from(token, "utf8");
  const right = Buffer.from(secret, "utf8");
  if (left.length !== right.length) return "denied";
  // timingSafeEqual throws if lengths differ — already guarded above.
  return crypto.timingSafeEqual(left, right) ? "ok" : "denied";
}

/**
 * Express middleware for cron-only routes.
 * Maps unconfigured → 503, denied → 401. Never includes the secret in errors.
 */
export function requireCronSecret(req, res, next) {
  try {
    const verdict = cronAuthorized(req);
    if (verdict === "unconfigured") {
      return next(
        new HttpError(503, "Cron authentication is not configured.", {
          code: "CRON_UNCONFIGURED",
        })
      );
    }
    if (verdict !== "ok") {
      return next(new HttpError(401, "Unauthorized", { code: "CRON_UNAUTHORIZED" }));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

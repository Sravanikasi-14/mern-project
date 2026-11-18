import PlatformAuditLog, { PLATFORM_AUDIT_ACTIONS } from "../models/PlatformAuditLog.js";

export { PLATFORM_AUDIT_ACTIONS };

const SENSITIVE_META_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "mfaSecret",
  "secret",
  "recoveryCode",
  "recoveryCodes",
  "authorization",
  "cookie",
]);

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_META_KEYS.has(key)) continue;
    if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    if (value != null && typeof value === "object") {
      out[key] = sanitizeMetadata(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Append-only platform audit write. Never throws to callers for audit failures
 * after logging — mutations should still succeed; tests can await directly.
 */
export async function recordPlatformAudit({
  actor = null,
  action,
  targetType = "Platform",
  targetId = "",
  outcome = "SUCCESS",
  metadata = {},
  req = null,
}) {
  try {
    if (!Object.values(PLATFORM_AUDIT_ACTIONS).includes(action)) {
      console.error("[platformAudit] unknown action (skipped):", action);
      return null;
    }
    const doc = {
      actorPlatformAdminId: actor?._id || actor?.id || null,
      actorEmail: actor?.email || "",
      action,
      targetType,
      targetId: targetId != null ? String(targetId) : "",
      outcome,
      metadata: sanitizeMetadata(metadata),
      ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || "",
      userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 300),
      timestamp: new Date(),
    };
    return await PlatformAuditLog.create(doc);
  } catch (err) {
    // Mutations / login must succeed even if audit persistence fails.
    console.error("[platformAudit] append failed:", err?.message || err);
    return null;
  }
}

export async function listPlatformAuditForTarget({ targetType, targetId, limit = 50 }) {
  return PlatformAuditLog.find({
    targetType,
    targetId: String(targetId),
  })
    .sort({ timestamp: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();
}

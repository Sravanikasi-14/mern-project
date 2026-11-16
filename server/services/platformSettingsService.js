import PlatformSettings from "../models/PlatformSettings.js";
import PlatformAuditLog, { PLATFORM_AUDIT_ACTIONS } from "../models/PlatformAuditLog.js";
import { HttpError } from "../utils/httpError.js";
import { recordPlatformAudit } from "./platformAuditService.js";
import { getOrCreatePlatformSettings } from "./platformEntitlementService.js";

let maintenanceCache = { value: null, expiresAt: 0 };

export function invalidateMaintenanceCache() {
  maintenanceCache = { value: null, expiresAt: 0 };
}

export async function isPlatformMaintenanceEnabled() {
  const now = Date.now();
  if (maintenanceCache.value != null && now < maintenanceCache.expiresAt) {
    return maintenanceCache.value;
  }
  const settings = await PlatformSettings.findOne({ singletonKey: "default" })
    .select("maintenance.enabled maintenance.message")
    .lean();
  const enabled = Boolean(settings?.maintenance?.enabled);
  maintenanceCache = {
    value: {
      enabled,
      message:
        settings?.maintenance?.message ||
        "The platform is undergoing scheduled maintenance. Please try again later.",
    },
    expiresAt: now + 15_000,
  };
  return maintenanceCache.value;
}

function toSettingsDto(doc) {
  return {
    general: {
      platformName: doc.general?.platformName || "HRMS Platform",
      supportEmail: doc.general?.supportEmail || "",
      defaultTimezone: doc.general?.defaultTimezone || "Asia/Kolkata",
      defaultCurrency: doc.general?.defaultCurrency || "INR",
      brandingTagline: doc.general?.brandingTagline || "",
    },
    security: {
      platformMfaRequired: doc.security?.platformMfaRequired !== false,
      platformSessionHours: doc.security?.platformSessionHours || 8,
      loginRateLimitPerWindow: doc.security?.loginRateLimitPerWindow || 10,
      loginRateLimitWindowMinutes: doc.security?.loginRateLimitWindowMinutes || 15,
      mfaRateLimitPerWindow: doc.security?.mfaRateLimitPerWindow || 20,
      notes: [
        "Platform Admin MFA enrollment and verification remain mandatory regardless of display flags.",
        "Login/MFA rate-limit fields are policy documentation today; runtime enforcement uses middleware defaults (and env) until shared/dynamic limiters are wired.",
        "Platform session hours are enforced for JWT exp, session expiresAt, and cookie maxAge on newly issued sessions.",
      ],
    },
    maintenance: {
      enabled: Boolean(doc.maintenance?.enabled),
      message:
        doc.maintenance?.message ||
        "The platform is undergoing scheduled maintenance. Please try again later.",
      plannedStart: doc.maintenance?.plannedStart || null,
      plannedEnd: doc.maintenance?.plannedEnd || null,
      updatedAt: doc.maintenance?.updatedAt || null,
      updatedByEmail: doc.maintenance?.updatedByEmail || "",
    },
    updatedAt: doc.updatedAt || null,
    updatedByEmail: doc.updatedByEmail || "",
  };
}

export async function getPlatformSettingsView() {
  const doc = await getOrCreatePlatformSettings();
  return { settings: toSettingsDto(doc) };
}

export async function updatePlatformSettings({ payload, confirm, admin, req }) {
  const doc = await getOrCreatePlatformSettings();
  const changes = {};

  if (payload?.general) {
    const g = payload.general;
    if (g.platformName != null) {
      doc.general.platformName = String(g.platformName).trim().slice(0, 120) || "HRMS Platform";
      changes.platformName = true;
    }
    if (g.supportEmail != null) {
      doc.general.supportEmail = String(g.supportEmail).trim().slice(0, 160);
      changes.supportEmail = true;
    }
    if (g.defaultTimezone != null) {
      doc.general.defaultTimezone = String(g.defaultTimezone).trim().slice(0, 80) || "Asia/Kolkata";
      changes.defaultTimezone = true;
    }
    if (g.defaultCurrency != null) {
      doc.general.defaultCurrency = String(g.defaultCurrency).trim().toUpperCase().slice(0, 8) || "INR";
      changes.defaultCurrency = true;
    }
    if (g.brandingTagline != null) {
      doc.general.brandingTagline = String(g.brandingTagline).trim().slice(0, 200);
      changes.brandingTagline = true;
    }
  }

  if (payload?.security) {
    const s = payload.security;
    // MFA cannot be turned off for Platform Admin
    if (s.platformMfaRequired === false) {
      throw new HttpError(400, "Platform Admin MFA is mandatory and cannot be disabled", {
        code: "MFA_MANDATORY",
      });
    }
    if (s.platformSessionHours != null) {
      const hours = Number.parseInt(s.platformSessionHours, 10);
      if (!Number.isFinite(hours) || hours < 1 || hours > 72) {
        throw new HttpError(400, "platformSessionHours must be between 1 and 72", {
          code: "VALIDATION_ERROR",
        });
      }
      doc.security.platformSessionHours = hours;
      changes.platformSessionHours = hours;
    }
    if (s.loginRateLimitPerWindow != null) {
      doc.security.loginRateLimitPerWindow = Math.min(
        1000,
        Math.max(1, Number.parseInt(s.loginRateLimitPerWindow, 10) || 10)
      );
      changes.loginRateLimitPerWindow = true;
    }
    if (s.loginRateLimitWindowMinutes != null) {
      doc.security.loginRateLimitWindowMinutes = Math.min(
        1440,
        Math.max(1, Number.parseInt(s.loginRateLimitWindowMinutes, 10) || 15)
      );
      changes.loginRateLimitWindowMinutes = true;
    }
    if (s.mfaRateLimitPerWindow != null) {
      doc.security.mfaRateLimitPerWindow = Math.min(
        1000,
        Math.max(1, Number.parseInt(s.mfaRateLimitPerWindow, 10) || 20)
      );
      changes.mfaRateLimitPerWindow = true;
    }
    doc.security.platformMfaRequired = true;
  }

  if (payload?.maintenance) {
    const m = payload.maintenance;
    if (m.enabled != null && Boolean(m.enabled) !== Boolean(doc.maintenance?.enabled)) {
      if (!confirm) {
        throw new HttpError(400, "Confirmation is required to change maintenance mode", {
          code: "CONFIRMATION_REQUIRED",
        });
      }
      doc.maintenance.enabled = Boolean(m.enabled);
      changes.maintenanceEnabled = doc.maintenance.enabled;
    }
    if (m.message != null) {
      doc.maintenance.message = String(m.message).trim().slice(0, 500);
      changes.maintenanceMessage = true;
    }
    if (m.plannedStart !== undefined) {
      doc.maintenance.plannedStart = m.plannedStart ? new Date(m.plannedStart) : null;
      changes.plannedStart = true;
    }
    if (m.plannedEnd !== undefined) {
      doc.maintenance.plannedEnd = m.plannedEnd ? new Date(m.plannedEnd) : null;
      changes.plannedEnd = true;
    }
    if (changes.maintenanceEnabled != null || changes.maintenanceMessage || changes.plannedStart || changes.plannedEnd) {
      doc.maintenance.updatedAt = new Date();
      doc.maintenance.updatedByEmail = admin?.email || "";
    }
  }

  if (Object.keys(changes).length === 0) {
    return { settings: toSettingsDto(doc) };
  }

  doc.updatedByPlatformAdminId = admin?._id || null;
  doc.updatedByEmail = admin?.email || "";
  doc.markModified("general");
  doc.markModified("security");
  doc.markModified("maintenance");
  await doc.save();
  invalidateMaintenanceCache();

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.SETTINGS_UPDATED,
    targetType: "PlatformSettings",
    targetId: "default",
    outcome: "SUCCESS",
    metadata: { changes },
    req,
  });

  return { settings: toSettingsDto(doc) };
}

export async function listPlatformAuditEntries({
  action,
  targetType,
  targetId,
  from,
  to,
  limit = 50,
  offset = 0,
} = {}) {
  const filter = {};
  if (action) filter.action = String(action);
  if (targetType) filter.targetType = String(targetType);
  if (targetId) filter.targetId = String(targetId);
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to) filter.timestamp.$lte = new Date(to);
  }

  const take = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);

  const [entries, total] = await Promise.all([
    PlatformAuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(take)
      .lean(),
    PlatformAuditLog.countDocuments(filter),
  ]);

  return {
    total,
    limit: take,
    offset: skip,
    actions: Object.values(PLATFORM_AUDIT_ACTIONS),
    entries: entries.map((e) => ({
      id: String(e._id),
      action: e.action,
      outcome: e.outcome,
      targetType: e.targetType,
      targetId: e.targetId,
      actorEmail: e.actorEmail,
      metadata: e.metadata || {},
      ipAddress: e.ipAddress || "",
      timestamp: e.timestamp,
    })),
  };
}

/** Used by platform auth session creation. */
export async function getPlatformSessionTtlMs() {
  const doc = await PlatformSettings.findOne({ singletonKey: "default" })
    .select("security.platformSessionHours")
    .lean();
  const hours = Number(doc?.security?.platformSessionHours) || 8;
  return Math.min(72, Math.max(1, hours)) * 60 * 60 * 1000;
}

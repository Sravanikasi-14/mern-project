import Company from "../models/Company.js";
import { HttpError } from "../utils/httpError.js";
import {
  getPlatformCapability,
  getPlatformFeatureCatalogPublic,
  listPlatformCapabilityKeys,
  listPlatformModuleKeys,
} from "../constants/platformFeatureCatalog.js";
import { planAllowsModuleFromRecord } from "./platformPlanService.js";
import {
  PLATFORM_AUDIT_ACTIONS,
  recordPlatformAudit,
} from "./platformAuditService.js";
import {
  countCompaniesAffectedByGlobalModuleDisable,
  getEffectiveEntitlementsForCompany,
  getOrCreatePlatformSettings,
  reasonLabel,
  serializeGlobalFeatureState,
} from "./platformEntitlementService.js";
import {
  clearCompanyMetadataCache,
  invalidateCompanyMetadataCache,
} from "../utils/companyMetadataCache.js";

function normalizeBoolMap(input, allowedKeys) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Invalid feature map", { code: "VALIDATION_ERROR" });
  }
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, `Unknown feature key: ${key}`, { code: "UNKNOWN_FEATURE_KEY" });
    }
    let enabled;
    if (typeof value === "boolean") enabled = value;
    else if (value && typeof value === "object" && typeof value.enabled === "boolean") {
      enabled = value.enabled;
    } else {
      throw new HttpError(400, `Invalid value for ${key}`, { code: "VALIDATION_ERROR" });
    }
    out[key] = { enabled };
  }
  return out;
}

export async function getGlobalFeaturesView() {
  const settings = await getOrCreatePlatformSettings();
  return {
    catalog: getPlatformFeatureCatalogPublic(),
    global: serializeGlobalFeatureState(settings),
  };
}

export async function previewGlobalModuleChange({ moduleKey, enabled }) {
  if (!getPlatformModule(moduleKey)) {
    throw new HttpError(400, "Unknown module", { code: "UNKNOWN_FEATURE_KEY" });
  }
  if (enabled === false) {
    return countCompaniesAffectedByGlobalModuleDisable(moduleKey);
  }
  const total = await Company.countDocuments({});
  return { totalCompanies: total, affectedCompanies: total };
}

export async function updateGlobalFeatures({ modules, capabilities, confirm, admin, req }) {
  const moduleKeys = new Set(listPlatformModuleKeys());
  const capKeys = new Set(listPlatformCapabilityKeys());

  const settings = await getOrCreatePlatformSettings();
  const nextModules = { ...settings.modules };
  const nextCapabilities = { ...settings.capabilities };
  const changes = [];

  if (modules) {
    const normalized = normalizeBoolMap(modules, moduleKeys);
    for (const [key, val] of Object.entries(normalized)) {
      const prev = settings.modules?.[key]?.enabled;
      if (prev === val.enabled) continue;
      if (val.enabled === false && !confirm) {
        const impact = await countCompaniesAffectedByGlobalModuleDisable(key);
        throw new HttpError(400, "Confirmation is required to disable a global module", {
          code: "CONFIRMATION_REQUIRED",
          moduleKey: key,
          impact,
        });
      }
      nextModules[key] = { enabled: val.enabled };
      changes.push({ type: "module", key, from: prev, to: val.enabled });
    }
  }

  if (capabilities) {
    const normalized = normalizeBoolMap(capabilities, capKeys);
    for (const [key, val] of Object.entries(normalized)) {
      const prev = settings.capabilities?.[key]?.enabled;
      if (prev === val.enabled) continue;
      if (val.enabled === false && !confirm) {
        throw new HttpError(400, "Confirmation is required to disable a global capability", {
          code: "CONFIRMATION_REQUIRED",
          capabilityKey: key,
        });
      }
      nextCapabilities[key] = { enabled: val.enabled };
      changes.push({ type: "capability", key, from: prev, to: val.enabled });
    }
  }

  if (!changes.length) {
    return { global: serializeGlobalFeatureState(settings), unchanged: true };
  }

  settings.modules = nextModules;
  settings.capabilities = nextCapabilities;
  settings.updatedByPlatformAdminId = admin?._id || null;
  settings.updatedByEmail = admin?.email || "";
  await settings.save();

  // Global feature flips affect every tenant entitlement resolution; drop stale company metadata.
  clearCompanyMetadataCache();

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.FEATURE_GLOBAL_UPDATED,
    targetType: "PlatformSettings",
    targetId: settings._id,
    outcome: "SUCCESS",
    metadata: { changes },
    req,
  });

  return { global: serializeGlobalFeatureState(settings), unchanged: false, changes };
}

export async function getCompanyFeatureAccess(companyId) {
  const company = await Company.findById(companyId)
    .select(
      "companyName slug status subscription.plan config.featureAccess config.timezone"
    )
    .lean();
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const { settings, planRecord, effective } = await getEffectiveEntitlementsForCompany(company);
  const global = serializeGlobalFeatureState(settings);

  const modules = PLATFORM_FEATURE_MODULES_SAFE().map((m) => {
    const eff = effective.modules[m.key] || { allowed: false, reason: "INVALID_CONFIGURATION" };
    const companyFlag = effective.companyOverrides.modules[m.key];
    const globalMod = global.modules.find((g) => g.key === m.key);
    return {
      key: m.key,
      label: m.label,
      effective: Boolean(eff.allowed),
      reason: eff.allowed ? null : eff.reason,
      reasonLabel: eff.allowed ? null : reasonLabel(eff.reason),
      layer: eff.layer || null,
      globalEnabled: Boolean(globalMod?.enabled),
      planEntitled: planAllowsModuleFromRecord(planRecord, m.key),
      companyOverride:
        companyFlag === undefined || companyFlag === null
          ? null
          : Boolean(typeof companyFlag === "boolean" ? companyFlag : companyFlag?.enabled),
      capabilities: m.capabilities.map((c) => {
        const cEff = effective.capabilities[c.key] || {
          allowed: false,
          reason: "INVALID_CONFIGURATION",
        };
        const cOverride = effective.companyOverrides.capabilities[c.key];
        const globalCap = globalMod?.capabilities?.find((x) => x.key === c.key);
        return {
          key: c.key,
          label: c.label,
          effective: Boolean(cEff.allowed),
          reason: cEff.allowed ? null : cEff.reason,
          reasonLabel: cEff.allowed ? null : reasonLabel(cEff.reason),
          layer: cEff.layer || null,
          globalEnabled: Boolean(globalCap?.enabled),
          companyOverride:
            cOverride === undefined || cOverride === null
              ? null
              : Boolean(typeof cOverride === "boolean" ? cOverride : cOverride?.enabled),
        };
      }),
    };
  });

  return {
    company: {
      id: String(company._id),
      companyName: company.companyName,
      slug: company.slug,
      status: company.status,
      plan: company.subscription?.plan || "TRIAL",
    },
    modules,
  };
}

function PLATFORM_FEATURE_MODULES_SAFE() {
  return getPlatformFeatureCatalogPublic().modules;
}

export async function updateCompanyFeatureAccess({
  companyId,
  modules,
  capabilities,
  confirm,
  admin,
  req,
}) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  const moduleKeys = new Set(listPlatformModuleKeys());
  const capKeys = new Set(listPlatformCapabilityKeys());
  if (!company.config) company.config = {};
  if (!company.config.featureAccess) {
    company.config.featureAccess = { modules: {}, capabilities: {} };
  }

  const nextModules = { ...(company.config.featureAccess.modules || {}) };
  const nextCapabilities = { ...(company.config.featureAccess.capabilities || {}) };
  const changes = [];
  const settings = await getOrCreatePlatformSettings();

  if (modules) {
    const normalized = normalizeBoolMap(modules, moduleKeys);
    for (const [key, val] of Object.entries(normalized)) {
      // Cannot enable if globally disabled
      if (val.enabled === true) {
        const globalFlag = settings.modules?.[key]?.enabled;
        if (globalFlag !== true) {
          throw new HttpError(
            400,
            "Cannot enable a module that is disabled globally",
            { code: "GLOBAL_RESTRICTION", moduleKey: key }
          );
        }
      }
      if (val.enabled === false && !confirm) {
        throw new HttpError(400, "Confirmation is required to disable a company module", {
          code: "CONFIRMATION_REQUIRED",
          moduleKey: key,
        });
      }
      const prev = nextModules[key];
      nextModules[key] = val.enabled;
      changes.push({ type: "module", key, from: prev, to: val.enabled });
    }
  }

  if (capabilities) {
    const normalized = normalizeBoolMap(capabilities, capKeys);
    for (const [key, val] of Object.entries(normalized)) {
      if (val.enabled === true) {
        const globalFlag = settings.capabilities?.[key]?.enabled;
        if (globalFlag !== true) {
          throw new HttpError(
            400,
            "Cannot enable a capability that is disabled globally",
            { code: "GLOBAL_RESTRICTION", capabilityKey: key }
          );
        }
        const cap = getPlatformCapability(key);
        if (cap) {
          const modGlobal = settings.modules?.[cap.moduleKey]?.enabled;
          if (modGlobal !== true) {
            throw new HttpError(
              400,
              "Cannot enable a capability whose module is disabled globally",
              { code: "GLOBAL_RESTRICTION", capabilityKey: key }
            );
          }
        }
      }
      if (val.enabled === false && !confirm) {
        throw new HttpError(400, "Confirmation is required to disable a company capability", {
          code: "CONFIRMATION_REQUIRED",
          capabilityKey: key,
        });
      }
      const prev = nextCapabilities[key];
      nextCapabilities[key] = val.enabled;
      changes.push({ type: "capability", key, from: prev, to: val.enabled });
    }
  }

  if (!changes.length) {
    return getCompanyFeatureAccess(companyId);
  }

  company.config.featureAccess = {
    modules: nextModules,
    capabilities: nextCapabilities,
  };
  company.markModified("config.featureAccess");
  await company.save();

  invalidateCompanyMetadataCache(company._id);

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.FEATURE_COMPANY_UPDATED,
    targetType: "Company",
    targetId: company._id,
    outcome: "SUCCESS",
    metadata: { changes },
    req,
  });

  return getCompanyFeatureAccess(companyId);
}

export async function listFeatureChangeHistory({ limit = 50 } = {}) {
  const PlatformAuditLog = (await import("../models/PlatformAuditLog.js")).default;
  const { PLATFORM_AUDIT_ACTIONS: ACTIONS } = await import("../models/PlatformAuditLog.js");
  return PlatformAuditLog.find({
    action: {
      $in: [ACTIONS.FEATURE_GLOBAL_UPDATED, ACTIONS.FEATURE_COMPANY_UPDATED],
    },
  })
    .sort({ timestamp: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();
}

// re-export for tests
export { getEffectiveEntitlementsForCompany };

import Company from "../models/Company.js";
import PlatformSettings from "../models/PlatformSettings.js";
import { HttpError } from "../utils/httpError.js";
import {
  getPlatformCapability,
  getPlatformModule,
  listPlatformCapabilityKeys,
  listPlatformModuleKeys,
  moduleKeyForHrPermission,
  PLATFORM_FEATURE_MODULES,
} from "../constants/platformFeatureCatalog.js";
import {
  planAllowsCapabilityFromRecord,
  planAllowsModuleFromRecord,
  resolvePlanRecordForCompany,
} from "./platformPlanService.js";
import {
  getCachedPlatformSettings,
  setCachedPlatformSettings,
} from "../utils/platformEntitlementCache.js";

const DENY_REASONS = Object.freeze({
  GLOBAL_MODULE: "GLOBAL_MODULE_DISABLED",
  GLOBAL_CAPABILITY: "GLOBAL_CAPABILITY_DISABLED",
  COMPANY_MODULE: "COMPANY_MODULE_DISABLED",
  COMPANY_CAPABILITY: "COMPANY_CAPABILITY_DISABLED",
  PLAN_MODULE: "PLAN_MODULE_NOT_ENTITLED",
  DEPENDENCY: "DEPENDENCY_DISABLED",
  UNKNOWN_MODULE: "UNKNOWN_MODULE",
  UNKNOWN_CAPABILITY: "UNKNOWN_CAPABILITY",
  INVALID_CONFIG: "INVALID_CONFIGURATION",
});

function asEnabledMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

function readEnabledFlag(map, key) {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null; // inherit / unset
  const val = map[key];
  if (val && typeof val === "object" && !Array.isArray(val)) {
    if (typeof val.enabled === "boolean") return val.enabled;
    return null;
  }
  if (typeof val === "boolean") return val;
  return null; // invalid → caller fail-closed
}

function seedEnabledMaps() {
  const modules = {};
  const capabilities = {};
  for (const key of listPlatformModuleKeys()) {
    modules[key] = { enabled: true };
  }
  for (const key of listPlatformCapabilityKeys()) {
    capabilities[key] = { enabled: true };
  }
  return { modules, capabilities };
}

/**
 * Load or seed singleton PlatformSettings.
 * Seed enables all catalog modules (preserves existing HRMS). After seed, missing keys fail closed.
 *
 * @param {{ lean?: boolean, bypassCache?: boolean }} [options]
 * - Writers (Platform Admin updates) must use the default mongoose document path
 *   (`lean: false`) so mutations are never applied to a cached snapshot.
 * - Entitlement hot path uses `{ lean: true }` with NEW-B02 short-TTL cache.
 */
export async function getOrCreatePlatformSettings(options = {}) {
  const lean = Boolean(options.lean);
  const bypassCache = Boolean(options.bypassCache);

  if (lean && !bypassCache) {
    const cached = getCachedPlatformSettings();
    if (cached) return cached;
  }

  let doc = await PlatformSettings.findOne({ singletonKey: "default" });
  if (!doc) {
    const seeded = seedEnabledMaps();
    try {
      doc = await PlatformSettings.create({
        singletonKey: "default",
        modules: seeded.modules,
        capabilities: seeded.capabilities,
      });
    } catch (err) {
      if (err?.code === 11000) {
        doc = await PlatformSettings.findOne({ singletonKey: "default" });
      } else {
        throw err;
      }
    }
  }

  if (!doc) {
    // Fail closed: missing settings must never imply "all entitled".
    return null;
  }

  if (lean) {
    const snapshot = typeof doc.toObject === "function" ? doc.toObject() : doc;
    if (!bypassCache) setCachedPlatformSettings(snapshot);
    return snapshot;
  }
  return doc;
}

export function serializeGlobalFeatureState(settingsDoc) {
  const moduleMap = asEnabledMap(settingsDoc?.modules);
  const capMap = asEnabledMap(settingsDoc?.capabilities);
  return {
    modules: PLATFORM_FEATURE_MODULES.map((m) => {
      const flag = readEnabledFlag(moduleMap, m.key);
      return {
        key: m.key,
        label: m.label,
        enabled: flag === true,
        configured: flag !== null,
        dependsOn: [...(m.dependsOn || [])],
        capabilities: m.capabilities.map((c) => {
          const cFlag = readEnabledFlag(capMap, c.key);
          return {
            key: c.key,
            label: c.label,
            enabled: cFlag === true,
            configured: cFlag !== null,
            dependsOn: [...(c.dependsOn || [])],
            hrPermission: c.hrPermission || null,
          };
        }),
      };
    }),
    updatedAt: settingsDoc?.updatedAt || null,
    updatedByEmail: settingsDoc?.updatedByEmail || "",
  };
}

function evaluateModule({ moduleKey, globalModules, companyModules, planRecord }) {
  const mod = getPlatformModule(moduleKey);
  if (!mod) {
    return { allowed: false, reason: DENY_REASONS.UNKNOWN_MODULE, layer: "catalog" };
  }

  const globalFlag = readEnabledFlag(globalModules, moduleKey);
  if (globalFlag === null) {
    return { allowed: false, reason: DENY_REASONS.INVALID_CONFIG, layer: "global" };
  }
  if (globalFlag === false) {
    return { allowed: false, reason: DENY_REASONS.GLOBAL_MODULE, layer: "global" };
  }

  // Missing plan record fails closed.
  if (!planAllowsModuleFromRecord(planRecord, moduleKey)) {
    return { allowed: false, reason: DENY_REASONS.PLAN_MODULE, layer: "plan" };
  }

  const companyFlag = readEnabledFlag(companyModules, moduleKey);
  if (companyFlag === false) {
    return { allowed: false, reason: DENY_REASONS.COMPANY_MODULE, layer: "company" };
  }

  for (const dep of mod.dependsOn || []) {
    const depEval = evaluateModule({
      moduleKey: dep,
      globalModules,
      companyModules,
      planRecord,
    });
    if (!depEval.allowed) {
      return {
        allowed: false,
        reason: DENY_REASONS.DEPENDENCY,
        layer: "dependency",
        dependency: dep,
        dependencyReason: depEval.reason,
      };
    }
  }

  return { allowed: true, reason: null, layer: null };
}

function evaluateCapability({
  capabilityKey,
  globalModules,
  globalCapabilities,
  companyModules,
  companyCapabilities,
  planRecord,
}) {
  const cap = getPlatformCapability(capabilityKey);
  if (!cap) {
    return { allowed: false, reason: DENY_REASONS.UNKNOWN_CAPABILITY, layer: "catalog" };
  }

  const moduleEval = evaluateModule({
    moduleKey: cap.moduleKey,
    globalModules,
    companyModules,
    planRecord,
  });
  if (!moduleEval.allowed) return moduleEval;

  if (!planAllowsCapabilityFromRecord(planRecord, capabilityKey, cap.moduleKey)) {
    return { allowed: false, reason: DENY_REASONS.PLAN_MODULE, layer: "plan" };
  }

  const globalFlag = readEnabledFlag(globalCapabilities, capabilityKey);
  if (globalFlag === null) {
    return { allowed: false, reason: DENY_REASONS.INVALID_CONFIG, layer: "global" };
  }
  if (globalFlag === false) {
    return { allowed: false, reason: DENY_REASONS.GLOBAL_CAPABILITY, layer: "global" };
  }

  const companyFlag = readEnabledFlag(companyCapabilities, capabilityKey);
  if (companyFlag === false) {
    return { allowed: false, reason: DENY_REASONS.COMPANY_CAPABILITY, layer: "company" };
  }

  for (const dep of cap.dependsOn || []) {
    if (getPlatformModule(dep)) {
      const depEval = evaluateModule({
        moduleKey: dep,
        globalModules,
        companyModules,
        planRecord,
      });
      if (!depEval.allowed) {
        return {
          allowed: false,
          reason: DENY_REASONS.DEPENDENCY,
          layer: "dependency",
          dependency: dep,
        };
      }
    } else if (getPlatformCapability(dep)) {
      const depEval = evaluateCapability({
        capabilityKey: dep,
        globalModules,
        globalCapabilities,
        companyModules,
        companyCapabilities,
        planRecord,
      });
      if (!depEval.allowed) {
        return {
          allowed: false,
          reason: DENY_REASONS.DEPENDENCY,
          layer: "dependency",
          dependency: dep,
        };
      }
    }
  }

  return { allowed: true, reason: null, layer: null };
}

function companyPlanCode(company) {
  return String(company?.subscription?.plan || "TRIAL").toUpperCase();
}

function companyFeatureMaps(company) {
  const fa = company?.config?.featureAccess || company?.featureAccess || {};
  // Support both nested under config (schema) and accidental top-level
  const fromConfig = company?.config?.featureAccess || {};
  return {
    modules: asEnabledMap(fromConfig.modules || fa.modules),
    capabilities: asEnabledMap(fromConfig.capabilities || fa.capabilities),
  };
}

/**
 * Resolve effective availability for a company + global settings + plan record.
 * @param {object} planRecord - PlatformPlan lean doc (null fails closed for plan layer)
 */
export function resolveEffectiveEntitlements({ company, settings, planRecord = null }) {
  const globalModules = asEnabledMap(settings?.modules);
  const globalCapabilities = asEnabledMap(settings?.capabilities);
  const { modules: companyModules, capabilities: companyCapabilities } = companyFeatureMaps(company);
  const plan = planRecord?.code || companyPlanCode(company);

  const modules = {};
  for (const key of listPlatformModuleKeys()) {
    modules[key] = evaluateModule({
      moduleKey: key,
      globalModules,
      companyModules,
      planRecord,
    });
  }
  const capabilities = {};
  for (const key of listPlatformCapabilityKeys()) {
    capabilities[key] = evaluateCapability({
      capabilityKey: key,
      globalModules,
      globalCapabilities,
      companyModules,
      companyCapabilities,
      planRecord,
    });
  }

  return {
    plan,
    planId: planRecord?._id ? String(planRecord._id) : null,
    modules,
    capabilities,
    companyOverrides: {
      modules: companyModules,
      capabilities: companyCapabilities,
    },
  };
}

/**
 * Merge a fresh DB snapshot of subscription + featureAccess onto the request company.
 * Required on multi-instance hosts (e.g. Vercel): company metadata cache is per-isolate,
 * so a Platform Admin disable on isolate A must not leave isolate B entitled until TTL.
 *
 * @returns {object|null} company for evaluation, or null if the company no longer exists
 */
async function loadAuthoritativeCompanyForEntitlements(company) {
  const companyId = company?._id || company?.id;
  if (!companyId) return company || null;

  const fresh = await Company.findById(companyId)
    .select("subscription config.featureAccess companyName slug status")
    .lean();
  if (!fresh) return null;

  return {
    ...company,
    subscription: fresh.subscription,
    status: fresh.status ?? company.status,
    config: {
      ...(company.config || {}),
      ...(fresh.config || {}),
      featureAccess: fresh.config?.featureAccess || {
        modules: {},
        capabilities: {},
      },
    },
  };
}

/**
 * Resolve effective entitlements for a company.
 *
 * Authorization-sensitive callers should keep the default `{ authoritative: true }`
 * so disables apply immediately across serverless isolates (bypass settings cache +
 * re-read company featureAccess from Mongo).
 *
 * @param {object} company
 * @param {{ authoritative?: boolean }} [options]
 */
export async function getEffectiveEntitlementsForCompany(company, options = {}) {
  const authoritative = options.authoritative !== false;

  let companyForEval = company;
  if (authoritative) {
    companyForEval = await loadAuthoritativeCompanyForEntitlements(company);
    if (!companyForEval) {
      const empty = resolveEffectiveEntitlements({
        company: { subscription: {}, config: { featureAccess: { modules: {}, capabilities: {} } } },
        settings: { modules: {}, capabilities: {} },
        planRecord: null,
      });
      return { settings: null, planRecord: null, effective: empty };
    }
  }

  const [settings, planRecord] = await Promise.all([
    getOrCreatePlatformSettings({
      lean: true,
      // Authoritative path must not grant access from another isolate's cached "all on".
      bypassCache: authoritative,
    }),
    resolvePlanRecordForCompany(companyForEval),
  ]);
  // Fail closed if central settings could not be loaded.
  if (!settings) {
    const empty = resolveEffectiveEntitlements({
      company: companyForEval,
      settings: { modules: {}, capabilities: {} },
      planRecord: null,
    });
    return { settings: null, planRecord: null, effective: empty };
  }
  return {
    settings,
    planRecord,
    effective: resolveEffectiveEntitlements({
      company: companyForEval,
      settings,
      planRecord,
    }),
  };
}

/** Compact snapshot for /auth/me — module/capability booleans only. */
export function entitlementsPublicSnapshot(effective) {
  const modules = {};
  const capabilities = {};
  for (const [key, val] of Object.entries(effective.modules || {})) {
    modules[key] = Boolean(val?.allowed);
  }
  for (const [key, val] of Object.entries(effective.capabilities || {})) {
    capabilities[key] = Boolean(val?.allowed);
  }
  return { plan: effective.plan, modules, capabilities };
}

export async function assertModuleEntitled(company, moduleKey) {
  const { effective } = await getEffectiveEntitlementsForCompany(company, {
    authoritative: true,
  });
  const result = effective.modules[moduleKey];
  if (!result?.allowed) {
    throw new HttpError(403, "This module is not available for your company.", {
      code: "PLATFORM_MODULE_DISABLED",
      moduleKey,
      reason: result?.reason || DENY_REASONS.INVALID_CONFIG,
      layer: result?.layer || "unknown",
    });
  }
  return result;
}

export async function assertCapabilityEntitled(company, capabilityKey) {
  const { effective } = await getEffectiveEntitlementsForCompany(company, {
    authoritative: true,
  });
  const result = effective.capabilities[capabilityKey];
  if (!result?.allowed) {
    throw new HttpError(403, "This feature is not available for your company.", {
      code: "PLATFORM_FEATURE_DISABLED",
      capabilityKey,
      reason: result?.reason || DENY_REASONS.INVALID_CONFIG,
      layer: result?.layer || "unknown",
    });
  }
  return result;
}

export async function assertHrPermissionEntitled(company, hrPermissionKey) {
  const moduleKey = moduleKeyForHrPermission(hrPermissionKey);
  if (!moduleKey) return; // permissions outside platform catalog are not gated here
  await assertModuleEntitled(company, moduleKey);
  // If a matching capability exists with same key, also enforce it
  if (getPlatformCapability(hrPermissionKey)) {
    await assertCapabilityEntitled(company, hrPermissionKey);
  }
}

export function reasonLabel(reason) {
  switch (reason) {
    case DENY_REASONS.GLOBAL_MODULE:
    case DENY_REASONS.GLOBAL_CAPABILITY:
      return "Disabled globally by Platform Admin";
    case DENY_REASONS.COMPANY_MODULE:
    case DENY_REASONS.COMPANY_CAPABILITY:
      return "Disabled for this company";
    case DENY_REASONS.PLAN_MODULE:
      return "Not included in the company subscription plan";
    case DENY_REASONS.DEPENDENCY:
      return "Blocked because a required module or capability is unavailable";
    case DENY_REASONS.UNKNOWN_MODULE:
    case DENY_REASONS.UNKNOWN_CAPABILITY:
      return "Unknown feature (fail closed)";
    case DENY_REASONS.INVALID_CONFIG:
      return "Entitlement configuration is missing or invalid (fail closed)";
    default:
      return "Unavailable";
  }
}

export async function countCompaniesAffectedByGlobalModuleDisable(moduleKey) {
  const companies = await Company.find({})
    .select("subscription config.featureAccess")
    .lean();
  let affected = 0;
  for (const c of companies) {
    const planRecord = await resolvePlanRecordForCompany(c);
    if (!planAllowsModuleFromRecord(planRecord, moduleKey)) continue;
    const { modules } = companyFeatureMaps(c);
    const flag = readEnabledFlag(modules, moduleKey);
    if (flag === false) continue;
    affected += 1;
  }
  return { totalCompanies: companies.length, affectedCompanies: affected };
}

export { DENY_REASONS };

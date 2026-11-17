/**
 * NEW-B02 — Short-TTL in-process cache for PlatformSettings + PlatformPlan entitlement reads.
 *
 * Process-local only (per Node / Vercel isolate). Other instances may serve stale
 * entitlements for up to TTL after a Platform Admin write until their cache expires
 * or they receive traffic that misses. Writers must call invalidate* after saves.
 *
 * Never caches company-specific overrides — only central settings/plans.
 */

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** @type {{ value: object, expiresAt: number } | null} */
let settingsEntry = null;

/** @type {Map<string, { value: object, expiresAt: number }>} */
const planById = new Map();
/** @type {Map<string, { value: object, expiresAt: number }>} */
const planByCode = new Map();

let stats = {
  settingsHits: 0,
  settingsMisses: 0,
  planHits: 0,
  planMisses: 0,
  invalidations: 0,
};

export function getPlatformEntitlementCacheConfig() {
  const raw = parsePositiveInt(process.env.PLATFORM_ENTITLEMENT_CACHE_TTL_MS, 30_000);
  const minTtl = process.env.NODE_ENV === "test" ? 20 : 5_000;
  const maxTtl = 60_000;
  return {
    ttlMs: Math.min(maxTtl, Math.max(minTtl, raw)),
    maxPlanEntries: Math.max(8, parsePositiveInt(process.env.PLATFORM_ENTITLEMENT_PLAN_CACHE_MAX, 64)),
  };
}

function cloneLean(value) {
  if (!value || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function readEntry(entry) {
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return cloneLean(entry.value);
}

export function getCachedPlatformSettings() {
  const value = readEntry(settingsEntry);
  if (!value) {
    if (settingsEntry) settingsEntry = null;
    stats.settingsMisses += 1;
    return null;
  }
  stats.settingsHits += 1;
  return value;
}

export function setCachedPlatformSettings(settingsDoc) {
  if (!settingsDoc) return;
  const { ttlMs } = getPlatformEntitlementCacheConfig();
  settingsEntry = {
    value: cloneLean(settingsDoc),
    expiresAt: Date.now() + ttlMs,
  };
}

export function getCachedPlatformPlanById(planId) {
  if (planId == null) {
    stats.planMisses += 1;
    return null;
  }
  const key = String(planId);
  const value = readEntry(planById.get(key));
  if (!value) {
    planById.delete(key);
    stats.planMisses += 1;
    return null;
  }
  stats.planHits += 1;
  return value;
}

export function getCachedPlatformPlanByCode(code) {
  const key = String(code || "")
    .trim()
    .toUpperCase();
  if (!key) {
    stats.planMisses += 1;
    return null;
  }
  const value = readEntry(planByCode.get(key));
  if (!value) {
    planByCode.delete(key);
    stats.planMisses += 1;
    return null;
  }
  stats.planHits += 1;
  return value;
}

function evictPlansIfNeeded(maxEntries) {
  while (planById.size + planByCode.size >= maxEntries) {
    const idKey = planById.keys().next().value;
    if (idKey != null) planById.delete(idKey);
    else {
      const codeKey = planByCode.keys().next().value;
      if (codeKey == null) break;
      planByCode.delete(codeKey);
    }
  }
}

export function setCachedPlatformPlan(planDoc) {
  if (!planDoc) return;
  const { ttlMs, maxPlanEntries } = getPlatformEntitlementCacheConfig();
  const lean = cloneLean(planDoc);
  const expiresAt = Date.now() + ttlMs;
  if (lean._id != null) {
    const idKey = String(lean._id);
    if (!planById.has(idKey)) evictPlansIfNeeded(maxPlanEntries);
    planById.set(idKey, { value: lean, expiresAt });
  }
  if (lean.code) {
    const codeKey = String(lean.code).toUpperCase();
    if (!planByCode.has(codeKey)) evictPlansIfNeeded(maxPlanEntries);
    planByCode.set(codeKey, { value: lean, expiresAt });
  }
}

/** Drop settings snapshot after Platform Admin feature/settings writes. */
export function invalidatePlatformSettingsCache() {
  settingsEntry = null;
  stats.invalidations += 1;
}

/** Drop one plan (and its code key) after create/update. */
export function invalidatePlatformPlanCache(planIdOrCode) {
  if (planIdOrCode == null || planIdOrCode === "") {
    planById.clear();
    planByCode.clear();
  } else {
    const key = String(planIdOrCode);
    planById.delete(key);
    planByCode.delete(key.toUpperCase());
    // Also drop by matching cached code if id was provided
    for (const [code, entry] of planByCode.entries()) {
      if (entry?.value?._id != null && String(entry.value._id) === key) {
        planByCode.delete(code);
      }
    }
    for (const [id, entry] of planById.entries()) {
      if (entry?.value?.code && String(entry.value.code).toUpperCase() === key.toUpperCase()) {
        planById.delete(id);
      }
    }
  }
  stats.invalidations += 1;
}

/** Invalidate settings + all plans (safe after global entitlement-changing writes). */
export function invalidatePlatformEntitlementCaches() {
  settingsEntry = null;
  planById.clear();
  planByCode.clear();
  stats.invalidations += 1;
}

export function clearPlatformEntitlementCache() {
  invalidatePlatformEntitlementCaches();
}

export function getPlatformEntitlementCacheStats() {
  const { ttlMs, maxPlanEntries } = getPlatformEntitlementCacheConfig();
  return {
    ttlMs,
    maxPlanEntries,
    settingsCached: Boolean(settingsEntry && Date.now() < settingsEntry.expiresAt),
    planByIdSize: planById.size,
    planByCodeSize: planByCode.size,
    ...stats,
  };
}

/** Test helper — reset counters without clearing entries. */
export function resetPlatformEntitlementCacheStats() {
  stats = {
    settingsHits: 0,
    settingsMisses: 0,
    planHits: 0,
    planMisses: 0,
    invalidations: 0,
  };
}

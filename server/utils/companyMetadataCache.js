/**
 * F49 — Bounded, short-lived in-process cache of company docs for auth/tenant resolution.
 * Per Node process only — never shared across tenants as a cross-tenant store
 * (each entry is keyed by a single company id).
 */

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** @type {Map<string, { value: object, expiresAt: number, lastUsedAt: number }>} */
const cache = new Map();

export function getCompanyMetadataCacheConfig() {
  const raw = parsePositiveInt(process.env.COMPANY_METADATA_CACHE_TTL_MS, 45_000);
  // Production window 30–60s; tests may set a shorter TTL via env.
  const minTtl = process.env.NODE_ENV === "test" ? 20 : 30_000;
  const maxTtl = 60_000;
  return {
    ttlMs: Math.min(maxTtl, Math.max(minTtl, raw)),
    maxEntries: Math.max(1, parsePositiveInt(process.env.COMPANY_METADATA_CACHE_MAX, 256)),
  };
}

function normalizeIds(node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.toHexString === "function") {
    return node.toHexString();
  }
  if (Array.isArray(node)) {
    return node.map((item) => normalizeIds(item));
  }
  const out = {};
  for (const [key, val] of Object.entries(node)) {
    out[key] = normalizeIds(val);
  }
  return out;
}

function cloneCompany(value) {
  if (!value || typeof value !== "object") return value;
  // Prefer JSON round-trip so ObjectId/Date become strings/ISO — avoids structuredClone
  // corrupting BSON ObjectId into non-castable { i0, i1, i2, i3 } shapes.
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return normalizeIds(value);
  }
}

function evictIfNeeded(maxEntries) {
  while (cache.size >= maxEntries) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, entry] of cache.entries()) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey == null) break;
    cache.delete(oldestKey);
  }
}

/**
 * Read a cached company snapshot if present and unexpired.
 * @returns {object|null}
 */
export function getCachedCompanyMetadata(companyId) {
  if (companyId == null) return null;
  const key = String(companyId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  entry.lastUsedAt = Date.now();
  return cloneCompany(entry.value);
}

/**
 * Store a lean company snapshot for auth/tenant resolution.
 * Callers should pass a plain object (not a Mongoose document).
 */
export function setCachedCompanyMetadata(companyId, companyDoc) {
  if (companyId == null || !companyDoc) return;
  const { ttlMs, maxEntries } = getCompanyMetadataCacheConfig();
  const key = String(companyId);
  if (!cache.has(key)) {
    evictIfNeeded(maxEntries);
  }
  const now = Date.now();
  cache.set(key, {
    value: cloneCompany(companyDoc),
    expiresAt: now + ttlMs,
    lastUsedAt: now,
  });
}

export function invalidateCompanyMetadataCache(companyId) {
  if (companyId == null) return;
  cache.delete(String(companyId));
}

export function clearCompanyMetadataCache() {
  cache.clear();
}

/** Test/ops snapshot — does not expose company payloads. */
export function getCompanyMetadataCacheStats() {
  const { ttlMs, maxEntries } = getCompanyMetadataCacheConfig();
  return {
    size: cache.size,
    ttlMs,
    maxEntries,
  };
}

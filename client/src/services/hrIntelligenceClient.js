import api from "./api";

/**
 * Shared in-memory session cache for HR Intelligence insights.
 * Never writes sensitive employee or company data to localStorage or sessionStorage.
 */
let memoryCache = {
  data: null,
  timestamp: null,
  inFlightPromise: null,
};

/**
 * Synchronous accessor for initial React state.
 */
export function getCachedIntelligence() {
  return memoryCache.data;
}

/**
 * Resets the in-memory cache (e.g. on user logout or session switch).
 */
export function clearCachedIntelligence() {
  memoryCache.data = null;
  memoryCache.timestamp = null;
  memoryCache.inFlightPromise = null;
}

/**
 * Manually updates the in-memory cache.
 */
export function setCachedIntelligence(data) {
  memoryCache.data = data;
  memoryCache.timestamp = Date.now();
}

/**
 * Fetches HR intelligence from backend with in-memory caching and request deduplication.
 * - On first visit: fetches from network and caches in memory.
 * - On revisits: returns cached data immediately without any network request.
 * - On React Strict Mode double-invoke: returns the existing in-flight Promise.
 * - On manual refresh (forceRefresh = true): bypasses cache, calls backend with ?refresh=true,
 *   and updates the memory cache with fresh data.
 */
export async function fetchHrIntelligence({ forceRefresh = false } = {}) {
  // 1. Return cached result on revisits unless manual refresh was explicitly requested
  if (!forceRefresh && memoryCache.data) {
    return memoryCache.data;
  }

  // 2. Deduplicate simultaneous requests (e.g. React Strict Mode or rapid navigation)
  if (memoryCache.inFlightPromise) {
    return memoryCache.inFlightPromise;
  }

  // 3. Initiate request
  const requestPromise = (async () => {
    try {
      const params = forceRefresh ? { refresh: "true", _t: Date.now() } : {};
      const response = await api.get("/admin/intelligence", { params });

      if (response.data && response.data.success) {
        memoryCache.data = response.data;
        memoryCache.timestamp = Date.now();
        return response.data;
      }

      throw new Error(response.data?.message || "Failed to load HR intelligence data.");
    } finally {
      memoryCache.inFlightPromise = null;
    }
  })();

  memoryCache.inFlightPromise = requestPromise;
  return requestPromise;
}

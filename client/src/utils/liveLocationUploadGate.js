/** F54 — Throttle live tracking GPS uploads (mirror of server/utils/liveLocationUploadGate.js). */

export const LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS = 15_000;
export const LIVE_LOCATION_CLIENT_MIN_DISTANCE_M = 75;

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const r = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createLiveLocationUploadGate(options = {}) {
  const minIntervalMs =
    Number.isFinite(options.minIntervalMs) && options.minIntervalMs > 0
      ? Number(options.minIntervalMs)
      : LIVE_LOCATION_CLIENT_MIN_INTERVAL_MS;
  const minDistanceMeters =
    Number.isFinite(options.minDistanceMeters) && options.minDistanceMeters > 0
      ? Number(options.minDistanceMeters)
      : LIVE_LOCATION_CLIENT_MIN_DISTANCE_M;

  let lastSentAt = 0;
  let lastLat = null;
  let lastLng = null;

  return {
    shouldUpload(location, now = Date.now()) {
      const lat = Number(location?.latitude);
      const lng = Number(location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (!lastSentAt) return true;
      if (now - lastSentAt >= minIntervalMs) return true;
      if (lastLat != null && lastLng != null) {
        if (haversineMeters(lastLat, lastLng, lat, lng) >= minDistanceMeters) return true;
      }
      return false;
    },
    markSent(location, now = Date.now()) {
      const lat = Number(location?.latitude);
      const lng = Number(location?.longitude);
      lastSentAt = now;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        lastLat = lat;
        lastLng = lng;
      }
    },
    reset() {
      lastSentAt = 0;
      lastLat = null;
      lastLng = null;
    },
  };
}

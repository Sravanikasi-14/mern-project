/**
 * Geographic helpers for attendance geofencing (WGS84 / Haversine).
 */

const EARTH_RADIUS_METERS = 6371e3;

export function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c);
}

/**
 * Returns whether a point is inside a circular geofence.
 * Accuracy (meters) is optionally added to distance before comparing radius
 * so poorer GPS does not silently pass when clearly outside.
 */
export function isInsideGeofence({
  latitude,
  longitude,
  centerLatitude,
  centerLongitude,
  radiusMeters,
  accuracyMeters = null,
}) {
  const lat = toFiniteNumber(latitude);
  const lon = toFiniteNumber(longitude);
  const cLat = toFiniteNumber(centerLatitude);
  const cLon = toFiniteNumber(centerLongitude);
  const radius = toFiniteNumber(radiusMeters);
  if (lat == null || lon == null || cLat == null || cLon == null || radius == null || radius < 0) {
    return { ok: false, distanceMeters: null, reason: "INVALID_GEOFENCE_INPUT" };
  }
  const distanceMeters = haversineDistanceMeters(cLat, cLon, lat, lon);
  const accuracy = toFiniteNumber(accuracyMeters);
  const effectiveDistance =
    accuracy != null && accuracy > 0 ? Math.max(0, distanceMeters - accuracy) : distanceMeters;
  const inside = effectiveDistance <= radius;
  return {
    ok: inside,
    distanceMeters,
    effectiveDistanceMeters: effectiveDistance,
    radiusMeters: radius,
    reason: inside ? "INSIDE" : "OUTSIDE_RADIUS",
  };
}

export function formatWorkingHours(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}

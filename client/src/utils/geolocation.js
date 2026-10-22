/**
 * Browser Geolocation & Permission Management Utility
 *
 * Adheres to browser standards, provides friendly error messages,
 * supports the Permissions API where available, and enforces accuracy checks.
 */

export const GEOLOCATION_STATUS = Object.freeze({
  IDLE: "IDLE",
  CHECKING_PERMISSION: "CHECKING_PERMISSION",
  PROMPT: "PROMPT",
  GRANTED: "GRANTED",
  DENIED: "DENIED",
  ACQUIRING: "ACQUIRING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
  UNSUPPORTED: "UNSUPPORTED",
});

export const DEFAULT_GEOLOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15000, // 15 seconds
  maximumAge: 0,   // fresh coordinates only
});

export const MAX_ACCEPTABLE_ACCURACY_METERS = 500; // 500 meters threshold

/**
 * Checks if geolocation is supported in the current browser.
 */
export function isGeolocationSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.geolocation);
}

/**
 * Queries the browser Permissions API for geolocation permission status if supported.
 * Returns: "granted" | "denied" | "prompt" | "unsupported"
 */
export async function queryGeolocationPermission() {
  if (!isGeolocationSupported()) {
    return "unsupported";
  }

  if (typeof navigator.permissions?.query === "function") {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      // Permissions API query not supported or restricted for geolocation
      return "prompt";
    }
  }

  return "prompt";
}

/**
 * Maps a GeolocationPositionError to a clear, actionable user message.
 */
export function parseGeolocationError(error) {
  if (!error) {
    return {
      code: "UNKNOWN",
      message: "An unknown location error occurred.",
      action: "Please retry in a moment.",
    };
  }

  switch (error.code) {
    case 1: // PERMISSION_DENIED
      return {
        code: "PERMISSION_DENIED",
        message: "Location access was denied.",
        action:
          "Please enable location permission in your browser address bar (click the lock/tune icon) and refresh or retry.",
      };
    case 2: // POSITION_UNAVAILABLE
      return {
        code: "POSITION_UNAVAILABLE",
        message: "Your location is temporarily unavailable.",
        action:
          "Ensure your device GPS/location services are turned on and you have a stable network connection.",
      };
    case 3: // TIMEOUT
      return {
        code: "TIMEOUT",
        message: "Location request timed out.",
        action: "The device took too long to acquire a GPS lock. Please retry.",
      };
    default:
      return {
        code: "FAILED",
        message: error.message || "Failed to acquire location.",
        action: "Please verify device location settings and try again.",
      };
  }
}

/**
 * Obtains a single fresh location fix from navigator.geolocation.getCurrentPosition.
 *
 * @param {Object} options Override default geolocation options
 * @param {number} maxAccuracyMeters Maximum acceptable reported accuracy in meters
 * @returns {Promise<{ latitude: number, longitude: number, accuracy: number, capturedAt: string }>}
 */
export function acquireCurrentLocation(options = {}, maxAccuracyMeters = MAX_ACCEPTABLE_ACCURACY_METERS) {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      const err = new Error("Geolocation is not supported by your browser or environment.");
      err.code = "UNSUPPORTED";
      return reject(err);
    }

    const geoOptions = {
      ...DEFAULT_GEOLOCATION_OPTIONS,
      ...options,
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const capturedAt = new Date(position.timestamp || Date.now()).toISOString();

        // Validate coordinates
        if (
          typeof latitude !== "number" ||
          !Number.isFinite(latitude) ||
          latitude < -90 ||
          latitude > 90 ||
          typeof longitude !== "number" ||
          !Number.isFinite(longitude) ||
          longitude < -180 ||
          longitude > 180
        ) {
          const err = new Error("Browser returned invalid geographical coordinates.");
          err.code = "INVALID_COORDINATES";
          return reject(err);
        }

        // Check reported accuracy threshold if configured
        if (maxAccuracyMeters && typeof accuracy === "number" && accuracy > maxAccuracyMeters) {
          const err = new Error(
            `Location accuracy is too low (reported ±${Math.round(accuracy)}m; requires within ±${maxAccuracyMeters}m). Please move closer to an open area or window and retry.`
          );
          err.code = "INSUFFICIENT_ACCURACY";
          err.accuracy = accuracy;
          return reject(err);
        }

        resolve({
          latitude: Number(latitude.toFixed(6)),
          longitude: Number(longitude.toFixed(6)),
          accuracy: typeof accuracy === "number" ? Number(accuracy.toFixed(1)) : null,
          capturedAt,
        });
      },
      (error) => {
        const parsed = parseGeolocationError(error);
        const err = new Error(parsed.message);
        err.code = parsed.code;
        err.action = parsed.action;
        reject(err);
      },
      geoOptions
    );
  });
}

/**
 * Watches continuous location changes for live tracking.
 * Returns an unwatch function that calls navigator.geolocation.clearWatch.
 *
 * @param {Function} onUpdate Callback when new coordinates are received
 * @param {Function} onError Callback when a location error occurs
 * @param {Object} options Override default geolocation options
 * @returns {Function} Stop watch cleanup function
 */
export function watchLiveLocation(onUpdate, onError, options = {}) {
  if (!isGeolocationSupported()) {
    if (onError) {
      const err = new Error("Geolocation is not supported in this browser.");
      err.code = "UNSUPPORTED";
      onError(err);
    }
    return () => {};
  }

  const geoOptions = {
    ...DEFAULT_GEOLOCATION_OPTIONS,
    maximumAge: 5000,
    ...options,
  };

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const capturedAt = new Date(position.timestamp || Date.now()).toISOString();

      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        typeof longitude === "number" &&
        Number.isFinite(longitude)
      ) {
        onUpdate({
          latitude: Number(latitude.toFixed(6)),
          longitude: Number(longitude.toFixed(6)),
          accuracy: typeof accuracy === "number" ? Number(accuracy.toFixed(1)) : null,
          capturedAt,
        });
      }
    },
    (error) => {
      if (onError) {
        const parsed = parseGeolocationError(error);
        const err = new Error(parsed.message);
        err.code = parsed.code;
        err.action = parsed.action;
        onError(err);
      }
    },
    geoOptions
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}

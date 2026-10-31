import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

const DEFAULT_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

function geoLog(event, detail = {}) {
  // Safe diagnostics only — never log coordinates, tokens, or credentials.
  try {
    console.info("[HRMS:geo]", event, {
      platform: Capacitor.getPlatform?.() || "unknown",
      native: Capacitor.isNativePlatform?.() || false,
      ...detail,
    });
  } catch {
    // ignore logging failures
  }
}

function isNative() {
  // Capacitor Android WebView must report native; if this is false inside the APK,
  // the JS is falling through to browser geolocation (no Android permission dialog).
  return Capacitor.isNativePlatform();
}

function unsupportedError() {
  const err = new Error("Location is not available on this device.");
  err.code = "UNSUPPORTED";
  err.action = "Use a device that supports GPS, then try again.";
  return err;
}

function deniedError(action) {
  const err = new Error("Location access was denied.");
  err.code = "PERMISSION_DENIED";
  err.action =
    action ||
    (isNative()
      ? "Tap Try again to allow location, or enable it in Android Settings → Apps → HRMS → Permissions."
      : "Open your browser or device settings, allow location for this app, then tap Try again.");
  return err;
}

function gpsDisabledError() {
  const err = new Error("Location services are turned off.");
  err.code = "GPS_DISABLED";
  err.action = "Turn on Location / GPS in system settings, then tap Try again.";
  return err;
}

function parseError(error) {
  if (!error) {
    const err = new Error("Could not read your location.");
    err.code = "UNKNOWN";
    err.action = "Please try again.";
    return err;
  }

  const code = error.code;
  const message = String(error.message || "");

  if (
    code === 1 ||
    code === "PERMISSION_DENIED" ||
    message.includes("OS-PLUG-GLOC-0003") ||
    (message.includes("permission") && /denied/i.test(message))
  ) {
    return deniedError();
  }

  if (
    message.includes("OS-PLUG-GLOC-0007") ||
    message.includes("OS-PLUG-GLOC-0009") ||
    message.includes("OS-PLUG-GLOC-0017") ||
    /location services are not enabled/i.test(message) ||
    /location turned off/i.test(message)
  ) {
    return gpsDisabledError();
  }

  if (code === 2 || code === "POSITION_UNAVAILABLE") {
    const err = new Error("Your location is temporarily unavailable.");
    err.code = "POSITION_UNAVAILABLE";
    err.action = "Turn on GPS and check your network, then try again.";
    return err;
  }

  if (code === 3 || code === "TIMEOUT" || message.includes("OS-PLUG-GLOC-0010")) {
    const err = new Error("Finding your location took too long.");
    err.code = "TIMEOUT";
    err.action = "Move somewhere with a clearer view of the sky, then try again.";
    return err;
  }

  if (message.includes("OS-PLUG-GLOC-0018")) {
    const err = new Error("Location permissions are missing from this app build.");
    err.code = "MANIFEST_MISSING";
    err.action = "Update the app, then try again.";
    return err;
  }

  const err = new Error(error.message || "Could not read your location.");
  err.code = error.code || "FAILED";
  err.action = error.action || "Please try again.";
  return err;
}

function readCoords(position) {
  const { latitude, longitude, accuracy } = position.coords || {};
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
    const err = new Error("The device returned invalid coordinates.");
    err.code = "INVALID_COORDINATES";
    err.action = "Try again without using a mock location app.";
    throw err;
  }
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: typeof accuracy === "number" ? Number(accuracy.toFixed(1)) : null,
    capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
  };
}

function mapNativePermission(status) {
  const fine = status?.location;
  const coarse = status?.coarseLocation;
  if (fine === "granted" || coarse === "granted") return "granted";
  if (fine === "denied" || coarse === "denied") return "denied";
  if (fine === "prompt-with-rationale" || coarse === "prompt-with-rationale") {
    return "prompt";
  }
  return "prompt";
}

export async function checkPermission() {
  if (isNative()) {
    try {
      const status = await Geolocation.checkPermissions();
      const mapped = mapNativePermission(status);
      geoLog("checkPermissions", {
        location: status?.location,
        coarseLocation: status?.coarseLocation,
        mapped,
      });
      return mapped;
    } catch (error) {
      const parsed = parseError(error);
      geoLog("checkPermissions:error", { code: parsed.code, message: parsed.message });
      if (parsed.code === "GPS_DISABLED") {
        const err = parsed;
        err.status = "gps-disabled";
        throw err;
      }
      return "prompt";
    }
  }

  geoLog("checkPermissions:web-fallback");
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "unsupported";
  }
  if (typeof navigator.permissions?.query === "function") {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state;
    } catch {
      return "prompt";
    }
  }
  return "prompt";
}

/**
 * Explicitly request location access.
 * On Android this shows the system permission dialog (requires manifest entries).
 * On web this falls back to a position read, which triggers the browser prompt.
 */
export async function requestPermission() {
  geoLog("requestPermission:start");
  if (isNative()) {
    try {
      // Triggers the Android system dialog when FINE/COARSE are in the manifest.
      const status = await Geolocation.requestPermissions({ permissions: ["location"] });
      const mapped = mapNativePermission(status);
      geoLog("requestPermission:result", {
        location: status?.location,
        coarseLocation: status?.coarseLocation,
        mapped,
      });
      if (mapped === "granted") return "granted";
      throw deniedError();
    } catch (error) {
      const msg = String(error?.message || "");
      geoLog("requestPermission:error", {
        code: error?.code,
        message: msg.slice(0, 160),
      });
      if (error?.code === "PERMISSION_DENIED") throw error;
      if (/not implemented on web/i.test(msg) || error?.code === "UNIMPLEMENTED") {
        const err = new Error("Native location plugin is not active in this build.");
        err.code = "PLUGIN_UNAVAILABLE";
        err.action = "Reinstall the latest HRMS APK (version 1.0.3+), then try again.";
        throw err;
      }
      throw parseError(error);
    }
  }

  geoLog("requestPermission:web-fallback");
  const state = await checkPermission();
  if (state === "granted") return "granted";
  if (state === "unsupported") throw unsupportedError();
  await getCurrentPosition();
  return "granted";
}

export function getCurrentPosition(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (isNative()) {
    return Geolocation.getCurrentPosition(opts)
      .then((position) => readCoords(position))
      .catch((error) => {
        throw parseError(error);
      });
  }

  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(unsupportedError());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(readCoords(position));
        } catch (err) {
          reject(err);
        }
      },
      (error) => reject(parseError(error)),
      opts
    );
  });
}

export function watchPosition(cb, onError, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, maximumAge: 5000, ...options };

  if (isNative()) {
    let watchId = null;
    let cancelled = false;
    Geolocation.watchPosition(opts, (position, err) => {
      if (cancelled) return;
      if (err) {
        onError?.(parseError(err));
        return;
      }
      try {
        cb(readCoords(position));
      } catch (error) {
        onError?.(error);
      }
    })
      .then((id) => {
        watchId = id;
        if (cancelled) {
          Geolocation.clearWatch({ id }).catch(() => {});
        }
      })
      .catch((error) => onError?.(parseError(error)));

    return {
      __capacitor: true,
      clear() {
        cancelled = true;
        if (watchId != null) {
          Geolocation.clearWatch({ id: watchId }).catch(() => {});
        }
      },
    };
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError?.(unsupportedError());
    return null;
  }
  return navigator.geolocation.watchPosition(
    (position) => {
      try {
        cb(readCoords(position));
      } catch (err) {
        onError?.(err);
      }
    },
    (error) => onError?.(parseError(error)),
    opts
  );
}

export function clearWatch(id) {
  if (id == null) return;
  if (typeof id === "object" && id.__capacitor && typeof id.clear === "function") {
    id.clear();
    return;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(id);
}

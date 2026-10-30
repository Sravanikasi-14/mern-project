const DEFAULT_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

function unsupportedError() {
  const err = new Error("Location is not available on this device.");
  err.code = "UNSUPPORTED";
  err.action = "Use a device that supports GPS, then try again.";
  return err;
}

function parseError(error) {
  if (!error) {
    const err = new Error("Could not read your location.");
    err.code = "UNKNOWN";
    err.action = "Please try again.";
    return err;
  }
  if (error.code === 1 || error.code === "PERMISSION_DENIED") {
    const err = new Error("Location access was denied.");
    err.code = "PERMISSION_DENIED";
    err.action =
      "Open your browser or device settings, allow location for this app, then tap Try again.";
    return err;
  }
  if (error.code === 2 || error.code === "POSITION_UNAVAILABLE") {
    const err = new Error("Your location is temporarily unavailable.");
    err.code = "POSITION_UNAVAILABLE";
    err.action = "Turn on GPS and check your network, then try again.";
    return err;
  }
  if (error.code === 3 || error.code === "TIMEOUT") {
    const err = new Error("Finding your location took too long.");
    err.code = "TIMEOUT";
    err.action = "Move somewhere with a clearer view of the sky, then try again.";
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

export async function checkPermission() {
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

export async function requestPermission() {
  const state = await checkPermission();
  if (state === "granted") return "granted";
  if (state === "unsupported") {
    throw unsupportedError();
  }
  await getCurrentPosition();
  return "granted";
}

export function getCurrentPosition(options = {}) {
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
      { ...DEFAULT_OPTIONS, ...options }
    );
  });
}

export function watchPosition(cb, onError, options = {}) {
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
    { ...DEFAULT_OPTIONS, maximumAge: 5000, ...options }
  );
}

export function clearWatch(id) {
  if (id == null || typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(id);
}

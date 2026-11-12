import { Capacitor } from "@capacitor/core";

/**
 * Native Wi-Fi evidence for attendance verification.
 *
 * OS-reported SSID/BSSID only — NOT cryptographic network identity (not 802.1X).
 * Mandatory Wi-Fi requires a server challenge from
 * POST /employees/me/attendance/verification-challenge.
 */

function emptyEvidence(platform, challenge = null, extras = {}) {
  return {
    ssid: "",
    bssid: "",
    capturedAt: new Date().toISOString(),
    platform,
    pluginVersion: "capgo",
    ...(challenge || {}),
    ...extras,
  };
}

function normalizeSsid(value) {
  return String(value || "")
    .replace(/^"|"$/g, "")
    .trim();
}

function isHiddenOrUnavailableSsid(ssid) {
  const s = normalizeSsid(ssid);
  if (!s) return true;
  const lower = s.toLowerCase();
  return (
    lower === "<unknown ssid>" ||
    lower === "unknown ssid" ||
    lower === "0x" ||
    lower === "null"
  );
}

function isUnknownBssid(bssid) {
  const raw = String(bssid || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, ":");
  if (!raw) return true;
  if (raw === "00:00:00:00:00:00" || raw === "02:00:00:00:00:00") return true;
  return !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(raw);
}

/**
 * @returns {Promise<{
 *   supported: boolean,
 *   reason: string,
 *   message: string,
 *   evidence: object|null
 * }>}
 */
export async function readWifiEvidence({ api = null, includeChallenge = true } = {}) {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") {
    return {
      supported: false,
      reason: "WIFI_UNSUPPORTED_ON_CLIENT",
      message:
        "Reliable Wi-Fi verification requires the Android HRMS app. Desktop browsers cannot access connected Wi-Fi details.",
      evidence: null,
    };
  }

  let challenge = null;
  if (includeChallenge && api) {
    try {
      const res = await api.post("/employees/me/attendance/verification-challenge");
      challenge = {
        challengeId: res.data?.challengeId,
        challengeNonce: res.data?.nonce,
      };
      if (!challenge.challengeId || !challenge.challengeNonce) {
        return {
          supported: true,
          reason: "WIFI_CHALLENGE_FAILED",
          message: "Verification challenge response was incomplete.",
          evidence: null,
        };
      }
    } catch (err) {
      return {
        supported: true,
        reason: "WIFI_CHALLENGE_FAILED",
        message: err?.response?.data?.message || "Could not obtain verification challenge.",
        evidence: null,
      };
    }
  }

  let Wifi;
  try {
    const mod = await import("@capgo/capacitor-wifi");
    Wifi = mod.CapacitorWifi || mod.Wifi || mod.default;
  } catch (err) {
    return {
      supported: false,
      reason: "WIFI_PLUGIN_MISSING",
      message: err?.message || "Wi-Fi plugin is not available. Sync Capacitor with @capgo/capacitor-wifi.",
      evidence: null,
    };
  }

  if (!Wifi?.getWifiInfo && !Wifi?.getSsid) {
    return {
      supported: false,
      reason: "WIFI_PLUGIN_MISSING",
      message: "Wi-Fi plugin is not available. Sync Capacitor with @capgo/capacitor-wifi.",
      evidence: null,
    };
  }

  try {
    // Fail closed on Android: if we cannot confirm the Wi-Fi radio is on, do not
    // trust getWifiInfo() — OS may still return the last-connected SSID/BSSID.
    if (platform === "android") {
      if (!Wifi.isEnabled) {
        return {
          supported: true,
          reason: "WIFI_UNAVAILABLE",
          message: "Connect to an authorized company Wi-Fi network.",
          evidence: emptyEvidence(platform, challenge, {
            wifiEnabled: false,
            clientReason: "WIFI_UNAVAILABLE",
          }),
        };
      }
      try {
        const { enabled } = await Wifi.isEnabled();
        if (enabled !== true) {
          return {
            supported: true,
            reason: "WIFI_DISABLED",
            message: "Connect to an authorized company Wi-Fi network.",
            evidence: emptyEvidence(platform, challenge, {
              wifiEnabled: false,
              clientReason: "WIFI_DISABLED",
            }),
          };
        }
      } catch {
        return {
          supported: true,
          reason: "WIFI_UNAVAILABLE",
          message: "Connect to an authorized company Wi-Fi network.",
          evidence: emptyEvidence(platform, challenge, {
            wifiEnabled: false,
            clientReason: "WIFI_UNAVAILABLE",
          }),
        };
      }
    } else if (Wifi.isEnabled) {
      try {
        const { enabled } = await Wifi.isEnabled();
        if (enabled === false) {
          return {
            supported: true,
            reason: "WIFI_DISABLED",
            message: "Connect to an authorized company Wi-Fi network.",
            evidence: emptyEvidence(platform, challenge, {
              wifiEnabled: false,
              clientReason: "WIFI_DISABLED",
            }),
          };
        }
      } catch {
        /* iOS may not support isEnabled on all versions */
      }
    }

    let permissionStatus = null;
    if (Wifi.checkPermissions) {
      try {
        permissionStatus = await Wifi.checkPermissions();
      } catch {
        permissionStatus = null;
      }
    }

    const locationPerm = String(permissionStatus?.location || "").toLowerCase();
    if (locationPerm === "denied" || locationPerm === "prompt") {
      if (Wifi.requestPermissions) {
        try {
          permissionStatus = await Wifi.requestPermissions();
        } catch {
          /* continue to evaluate */
        }
      }
    }

    const locationAfter = String(permissionStatus?.location || locationPerm || "").toLowerCase();
    if (locationAfter === "denied") {
      return {
        supported: true,
        reason: "WIFI_PERMISSION_DENIED",
        message: "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.",
        evidence: emptyEvidence(platform, challenge, {
          permission: "denied",
          clientReason: "WIFI_PERMISSION_DENIED",
        }),
      };
    }

    let info = {};
    try {
      if (Wifi.getWifiInfo) {
        info = await Wifi.getWifiInfo();
      } else {
        const ssidRes = await Wifi.getSsid();
        info = { ssid: ssidRes?.ssid };
      }
    } catch (err) {
      const msg = String(err?.message || err || "").toLowerCase();
      const code = String(err?.code || "").toUpperCase();
      if (code.includes("PERMISSION") || msg.includes("permission")) {
        return {
          supported: true,
          reason: "WIFI_PERMISSION_DENIED",
          message: "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.",
          evidence: emptyEvidence(platform, challenge, { clientReason: "WIFI_PERMISSION_DENIED" }),
        };
      }
      if (code.includes("WIFI_DISABLED") || msg.includes("wifi") && msg.includes("disabled")) {
        return {
          supported: true,
          reason: "WIFI_DISABLED",
          message: "Connect to an authorized company Wi-Fi network.",
          evidence: emptyEvidence(platform, challenge, { clientReason: "WIFI_DISABLED" }),
        };
      }
      if (msg.includes("location") && (msg.includes("off") || msg.includes("disabled") || msg.includes("service"))) {
        return {
          supported: true,
          reason: "WIFI_LOCATION_REQUIRED",
          message: "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.",
          evidence: emptyEvidence(platform, challenge, { clientReason: "WIFI_LOCATION_REQUIRED" }),
        };
      }
      if (msg.includes("unsupported") || code.includes("UNAVAILABLE")) {
        return {
          supported: false,
          reason: "WIFI_UNSUPPORTED_ANDROID_VERSION",
          message: "Wi-Fi verification is not supported on this Android version or device configuration.",
          evidence: emptyEvidence(platform, challenge),
        };
      }
      return {
        supported: true,
        reason: "WIFI_UNAVAILABLE",
        message: err?.message || "Unable to read Wi-Fi information.",
        evidence: emptyEvidence(platform, challenge),
      };
    }

    const ssidRaw = normalizeSsid(info?.ssid);
    const bssidRaw = String(info?.bssid || "").trim();
    const ssidHidden = isHiddenOrUnavailableSsid(ssidRaw);
    const bssidUnknown = isUnknownBssid(bssidRaw);

    const evidence = {
      ssid: ssidHidden ? "" : ssidRaw,
      bssid: bssidUnknown ? "" : bssidRaw.toLowerCase().replace(/-/g, ":"),
      capturedAt: new Date().toISOString(),
      platform,
      pluginVersion: "capgo",
      wifiEnabled: platform === "android" ? true : undefined,
      frequency: info?.frequency ?? null,
      signalStrength: info?.signalStrength ?? info?.rssi ?? null,
      ...(challenge || {}),
    };

    if (ssidHidden && bssidUnknown) {
      return {
        supported: true,
        reason: "WIFI_UNAVAILABLE",
        message: "Connect to an authorized company Wi-Fi network.",
        evidence: { ...evidence, clientReason: "WIFI_UNAVAILABLE" },
      };
    }

    if (ssidHidden && !bssidUnknown) {
      return {
        supported: true,
        reason: "WIFI_SSID_HIDDEN",
        message: "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.",
        evidence,
      };
    }

    if (!ssidHidden && bssidUnknown) {
      return {
        supported: true,
        reason: "WIFI_BSSID_UNKNOWN",
        message: "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.",
        evidence,
      };
    }

    return {
      supported: true,
      reason: "WIFI_READ",
      message: "Wi-Fi details captured from the device (OS-reported; not 802.1X proof).",
      evidence,
    };
  } catch (err) {
    return {
      supported: true,
      reason: "WIFI_UNAVAILABLE",
      message: err?.message || "Unable to read Wi-Fi information.",
      evidence: emptyEvidence(platform, challenge),
    };
  }
}

import { HttpError } from "../utils/httpError.js";

/**
 * Authoritative Wi-Fi verification against HR-configured access points.
 *
 * IMPORTANT LIMITATION:
 * SSID/BSSID values are OS-reported via a native plugin. They are NOT cryptographic
 * proof of corporate network attachment (not 802.1X / certificate binding).
 * Challenge binding reduces replay of stale submissions but cannot stop a rooted
 * device from fabricating OS-reported Wi-Fi fields.
 *
 * Mandatory Wi-Fi requires at least one authorized network with a BSSID (router MAC).
 * SSID-only matching is too weak (default SSIDs like "Samsung-5G" are not unique).
 */

const WIFI_MAX_AGE_SECONDS = 120;

export function normalizeSsid(value) {
  return String(value || "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase();
}

export function normalizeBssid(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, ":");
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(raw)) return "";
  // Android privacy / disconnected placeholders
  if (raw === "00:00:00:00:00:00" || raw === "02:00:00:00:00:00") return "";
  return raw;
}

export function getAuthorizedWifiNetworks(policy) {
  const list = policy?.attendanceVerification?.wifiNetworks || policy?.locationRules?.wifiNetworks || [];
  if (!Array.isArray(list)) return [];
  return list.filter((n) => n && n.active !== false && (n.ssid || n.bssid));
}

function networkMatchesEvidence(net, ssid, bssid) {
  const wantSsid = normalizeSsid(net.ssid);
  const wantBssid = normalizeBssid(net.bssid);
  if (!wantSsid && !wantBssid) return false;

  // Every identifier configured on the authorized entry must be present and match.
  if (wantSsid) {
    if (!ssid || ssid !== wantSsid) return false;
  }
  if (wantBssid) {
    if (!bssid || bssid !== wantBssid) return false;
  }
  return true;
}

function userMessageForReason(reason) {
  switch (reason) {
    case "WIFI_UNAUTHORIZED":
      return "Your connected Wi-Fi network is not authorized.";
    case "WIFI_DISABLED":
    case "WIFI_EVIDENCE_MISSING":
    case "WIFI_UNAVAILABLE":
    case "WIFI_SSID_REQUIRED":
      return "Connect to an authorized company Wi-Fi network.";
    case "WIFI_PERMISSION_DENIED":
    case "WIFI_LOCATION_REQUIRED":
    case "WIFI_BSSID_REQUIRED":
      return "Unable to detect Wi-Fi information. Check your Wi-Fi permissions.";
    case "WIFI_EVIDENCE_STALE":
    case "WIFI_CHALLENGE_REQUIRED":
    case "WIFI_CAPTURED_AT_REQUIRED":
      return "Verification expired. Please try again.";
    case "NO_AUTHORIZED_NETWORKS_CONFIGURED":
    case "WIFI_POLICY_REQUIRES_BSSID":
      return "Wi-Fi verification is not configured correctly. Please contact HR.";
    default:
      return "Connect to an authorized company Wi-Fi network.";
  }
}

export function evaluateWifiEvidence({
  policy,
  wifiEvidence,
  clientPlatform,
  mandatory = false,
  requireChallengeFields = false,
} = {}) {
  const platform = String(clientPlatform || wifiEvidence?.platform || "").toLowerCase();
  const networks = getAuthorizedWifiNetworks(policy);
  const capturedAt = wifiEvidence?.capturedAt ? new Date(wifiEvidence.capturedAt) : null;
  const now = new Date();

  const base = {
    method: "WIFI",
    attempted: true,
    ok: false,
    reason: "",
    ssidMatched: false,
    bssidMatched: false,
    networkRef: null,
    platform,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt.toISOString() : null,
    assurance: "OS_REPORTED_BEST_EFFORT",
  };

  const fail = (reason, message) => ({
    ...base,
    reason,
    message: message || userMessageForReason(reason),
  });

  if (!networks.length) {
    return {
      ...fail("NO_AUTHORIZED_NETWORKS_CONFIGURED"),
      attempted: false,
    };
  }

  // Mandatory Wi-Fi must use BSSID-bound network entries. SSID-only is not unique enough.
  const bssidNetworks = networks.filter((n) => normalizeBssid(n.bssid));
  if (mandatory && !bssidNetworks.length) {
    return fail("WIFI_POLICY_REQUIRES_BSSID");
  }

  if (!wifiEvidence || typeof wifiEvidence !== "object") {
    return fail("WIFI_EVIDENCE_MISSING");
  }

  if (requireChallengeFields || mandatory) {
    if (!wifiEvidence.challengeId || !wifiEvidence.challengeNonce) {
      return fail("WIFI_CHALLENGE_REQUIRED");
    }
  }

  if (mandatory || requireChallengeFields) {
    if (!capturedAt || Number.isNaN(capturedAt.getTime())) {
      return fail("WIFI_CAPTURED_AT_REQUIRED");
    }
  }

  if (capturedAt && !Number.isNaN(capturedAt.getTime())) {
    const ageSec = Math.abs(now.getTime() - capturedAt.getTime()) / 1000;
    if (ageSec > WIFI_MAX_AGE_SECONDS) {
      return fail("WIFI_EVIDENCE_STALE");
    }
  }

  const ssid = normalizeSsid(wifiEvidence.ssid);
  const bssid = normalizeBssid(wifiEvidence.bssid);
  const clientReason = String(wifiEvidence.clientReason || "").toUpperCase();
  const wifiEnabledFlag = wifiEvidence.wifiEnabled;

  // Radio explicitly off (or client reports disabled) — never accept cached SSID/BSSID.
  if (
    wifiEnabledFlag === false ||
    clientReason === "WIFI_DISABLED" ||
    clientReason === "WIFI_RADIO_OFF"
  ) {
    return fail("WIFI_DISABLED");
  }
  if (clientReason === "WIFI_PERMISSION_DENIED") {
    return fail("WIFI_PERMISSION_DENIED");
  }
  if (clientReason === "WIFI_LOCATION_REQUIRED") {
    return fail("WIFI_LOCATION_REQUIRED");
  }
  if (
    clientReason === "WIFI_UNAVAILABLE" ||
    clientReason === "MOBILE_DATA_ONLY" ||
    clientReason === "WIFI_NOT_CONNECTED"
  ) {
    return fail("WIFI_UNAVAILABLE");
  }

  if (!ssid && !bssid) {
    return fail("WIFI_UNAVAILABLE");
  }

  if (mandatory && !bssid) {
    return fail("WIFI_BSSID_REQUIRED");
  }

  const candidates = mandatory ? bssidNetworks : networks;
  for (const net of candidates) {
    if (!networkMatchesEvidence(net, ssid, bssid)) continue;
    const wantSsid = normalizeSsid(net.ssid);
    const wantBssid = normalizeBssid(net.bssid);
    return {
      ...base,
      ok: true,
      reason: "WIFI_AUTHORIZED",
      ssidMatched: Boolean(wantSsid && ssid === wantSsid),
      bssidMatched: Boolean(wantBssid && bssid === wantBssid),
      networkRef: String(net.label || net.ssid || net.bssid || "authorized").slice(0, 80),
      message:
        "Connected network matches an authorized office Wi-Fi entry (OS-reported SSID/BSSID; not 802.1X proof).",
    };
  }

  return fail("WIFI_UNAUTHORIZED");
}

export function assertWifiOrThrow(result, { mandatory }) {
  if (result.ok) return result;
  if (!mandatory) return result;
  throw new HttpError(400, result.message || userMessageForReason(result.reason));
}

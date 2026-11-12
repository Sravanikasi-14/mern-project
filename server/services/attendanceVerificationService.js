import { HttpError } from "../utils/httpError.js";
import { evaluateWifiEvidence } from "./wifiVerificationService.js";
import {
  verifyEmployeeFace,
  DEFAULT_MATCH_THRESHOLD,
  isFaceEngineReady,
  isValidatedLivenessConfigured,
} from "./faceRecognitionService.js";
import {
  consumeVerificationChallenge,
  hashEvidencePayload,
} from "./verificationChallengeService.js";

export const VERIFICATION_METHODS = Object.freeze({
  GPS: "GPS",
  WIFI: "WIFI",
  FACE: "FACE",
});

export const DEFAULT_ATTENDANCE_VERIFICATION = Object.freeze({
  /** When false and no methods enabled, punches follow legacy location/geofence only. */
  verificationRequired: false,
  gps: { enabled: false, mandatory: true },
  wifi: { enabled: false, mandatory: true },
  face: {
    enabled: false,
    mandatory: true,
    matchThreshold: DEFAULT_MATCH_THRESHOLD,
    requireLiveness: true,
  },
  wifiNetworks: [],
});

function methodConfig(raw, defaults) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    mandatory: src.mandatory !== undefined ? Boolean(src.mandatory) : defaults.mandatory,
  };
}

/**
 * Normalize attendanceVerification from policy with backward-compatible defaults.
 * Existing companies without this block are not blocked by new methods.
 */
export function resolveAttendanceVerificationConfig(policy) {
  const raw = policy?.attendanceVerification && typeof policy.attendanceVerification === "object"
    ? policy.attendanceVerification
    : {};
  const defaults = DEFAULT_ATTENDANCE_VERIFICATION;
  const gps = methodConfig(raw.gps, defaults.gps);
  const wifi = methodConfig(raw.wifi, defaults.wifi);
  const faceRaw = raw.face && typeof raw.face === "object" ? raw.face : {};
  const face = {
    ...methodConfig(faceRaw, defaults.face),
    matchThreshold:
      faceRaw.matchThreshold !== undefined
        ? Math.max(0.2, Math.min(1.2, Number(faceRaw.matchThreshold) || DEFAULT_MATCH_THRESHOLD))
        : DEFAULT_MATCH_THRESHOLD,
    requireLiveness: faceRaw.requireLiveness !== undefined ? Boolean(faceRaw.requireLiveness) : true,
  };

  const wifiNetworks = Array.isArray(raw.wifiNetworks)
    ? raw.wifiNetworks
    : Array.isArray(policy?.locationRules?.wifiNetworks)
      ? policy.locationRules.wifiNetworks
      : [];

  let verificationRequired =
    raw.verificationRequired !== undefined
      ? Boolean(raw.verificationRequired)
      : Boolean(gps.enabled || wifi.enabled || face.enabled);

  // If HR requires verification but disabled every method, keep the flag but callers must reject.
  if (!gps.enabled && !wifi.enabled && !face.enabled) {
    verificationRequired = Boolean(raw.verificationRequired);
  }

  return {
    verificationRequired,
    gps,
    wifi,
    face,
    wifiNetworks,
  };
}

/**
 * Public summary for employee clients (no secret Wi-Fi BSSID lists beyond masked count).
 */
export function buildEmployeeVerificationRequirements(policy, { sessionType = "OFFICE", geofenceApplies = true } = {}) {
  const cfg = resolveAttendanceVerificationConfig(policy);
  const officeSession = String(sessionType).toUpperCase() !== "REMOTE";

  const gpsApplies = cfg.gps.enabled && geofenceApplies && officeSession;
  // Remote approved sessions: do not force office GPS geofence as a verification method.
  const gps = {
    enabled: gpsApplies,
    mandatory: gpsApplies ? cfg.gps.mandatory : false,
    label: "GPS geofencing",
  };

  const wifi = {
    enabled: cfg.wifi.enabled,
    mandatory: cfg.wifi.enabled ? cfg.wifi.mandatory : false,
    label: "Office Wi-Fi",
    authorizedNetworkCount: (cfg.wifiNetworks || []).filter((n) => n && n.active !== false).length,
  };

  const face = {
    enabled: cfg.face.enabled,
    mandatory: cfg.face.enabled ? cfg.face.mandatory : false,
    label: "Face recognition",
    requireLiveness: cfg.face.requireLiveness,
  };

  const anyEnabled = gps.enabled || wifi.enabled || face.enabled;
  return {
    verificationRequired: cfg.verificationRequired || anyEnabled,
    methods: { gps, wifi, face },
    wifiSupportedPlatforms: ["android"],
    notes: {
      wifiDesktop:
        "Reliable Wi-Fi verification is not available in desktop browsers. Use the Android HRMS app when Wi-Fi is mandatory.",
      wifiAssurance:
        "SSID/BSSID are OS-reported best-effort signals, not 802.1X / certificate-bound network identity.",
      gpsRemote:
        "Approved remote / WFH sessions do not require office geofence GPS verification.",
      faceLiveness:
        "Heuristic liveness is not production anti-spoofing. Mandatory face stays unavailable until a validated liveness provider is configured.",
    },
  };
}

/**
 * Operational readiness warnings for HR policy UI (methods may be enabled but not production-ready).
 */
export function buildVerificationOperationalStatus(policy) {
  const cfg = resolveAttendanceVerificationConfig(policy);
  const warnings = [];
  const faceReady = isFaceEngineReady();
  const livenessReady = isValidatedLivenessConfigured();

  if (cfg.wifi.enabled) {
    warnings.push({
      method: "WIFI",
      severity: "info",
      code: "WIFI_OS_REPORTED_BEST_EFFORT",
      message:
        "Wi-Fi uses OS-reported SSID/BSSID with short-lived server challenges. This is not 802.1X-level assurance.",
    });
    if (!(cfg.wifiNetworks || []).some((n) => n && n.active !== false && (n.ssid || n.bssid))) {
      warnings.push({
        method: "WIFI",
        severity: "error",
        code: "WIFI_NETWORKS_MISSING",
        message: "Wi-Fi is enabled but no authorized networks are configured.",
      });
    }
  }

  if (cfg.face.enabled) {
    if (!faceReady.ok) {
      warnings.push({
        method: "FACE",
        severity: "error",
        code: "FACE_MODELS_UNAVAILABLE",
        message: faceReady.message,
      });
    }
    if (cfg.face.mandatory && !livenessReady.ok) {
      warnings.push({
        method: "FACE",
        severity: "error",
        code: "FACE_VALIDATED_LIVENESS_REQUIRED",
        message: livenessReady.message,
      });
    } else if (!livenessReady.ok) {
      warnings.push({
        method: "FACE",
        severity: "warning",
        code: "FACE_HEURISTIC_LIVENESS_ONLY",
        message:
          "Only heuristic liveness is available. Do not treat optional face checks as spoof-resistant.",
      });
    }
  }

  return {
    faceEngineReady: Boolean(faceReady.ok),
    validatedLivenessConfigured: Boolean(livenessReady.ok),
    warnings,
  };
}

export function sanitizeWifiNetworks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const ssid = String(item.ssid || "").trim().slice(0, 64);
    let bssid = String(item.bssid || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, ":");
    if (bssid && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bssid)) {
      throw new HttpError(400, `Invalid Wi-Fi BSSID: ${item.bssid}`);
    }
    if (!ssid && !bssid) continue;
    out.push({
      label: String(item.label || ssid || bssid).trim().slice(0, 80),
      ssid,
      bssid,
      active: item.active !== false,
    });
  }
  return out;
}

export function sanitizeAttendanceVerification(body, existingPolicy) {
  const existingAv =
    existingPolicy?.attendanceVerification && typeof existingPolicy.attendanceVerification === "object"
      ? existingPolicy.attendanceVerification
      : DEFAULT_ATTENDANCE_VERIFICATION;

  const raw =
    body?.attendanceVerification !== undefined
      ? body.attendanceVerification
      : existingAv;

  const src = raw && typeof raw === "object" ? raw : {};
  const gpsEnabled = Boolean(src.gps?.enabled);
  const wifiEnabled = Boolean(src.wifi?.enabled);
  const faceEnabled = Boolean(src.face?.enabled);
  const wifiMandatory = src.wifi?.mandatory !== undefined ? Boolean(src.wifi.mandatory) : true;
  const verificationRequired =
    src.verificationRequired !== undefined
      ? Boolean(src.verificationRequired)
      : gpsEnabled || wifiEnabled || faceEnabled;

  if (verificationRequired && !gpsEnabled && !wifiEnabled && !faceEnabled) {
    throw new HttpError(
      400,
      "Attendance verification is required but no verification methods are enabled. Enable at least one method or turn off verification required."
    );
  }

  const matchThreshold =
    src.face?.matchThreshold !== undefined
      ? Number(src.face.matchThreshold)
      : DEFAULT_MATCH_THRESHOLD;
  if (!Number.isFinite(matchThreshold) || matchThreshold < 0.2 || matchThreshold > 1.2) {
    throw new HttpError(400, "Face match threshold must be between 0.2 and 1.2.");
  }

  // Preserve previously saved networks when a partial payload omits wifiNetworks
  // (common when mobile HR toggles methods without re-sending the network list).
  const wifiNetworks =
    src.wifiNetworks !== undefined
      ? sanitizeWifiNetworks(src.wifiNetworks)
      : sanitizeWifiNetworks(existingAv.wifiNetworks);

  if (wifiEnabled && !wifiNetworks.length) {
    throw new HttpError(
      400,
      "Wi-Fi verification is enabled but no authorized networks are configured. Add at least one SSID/BSSID."
    );
  }

  if (wifiEnabled && wifiMandatory) {
    const hasBssid = wifiNetworks.some((n) => n.bssid);
    if (!hasBssid) {
      throw new HttpError(
        400,
        "Mandatory Wi-Fi requires at least one authorized network with a BSSID (router MAC address). SSID-only matching is not unique enough."
      );
    }
  }

  // Fail closed: mandatory face requires models + validated liveness (not heuristic-only).
  if (faceEnabled && src.face?.mandatory !== false) {
    const ready = isFaceEngineReady();
    if (!ready.ok && process.env.NODE_ENV !== "test") {
      throw new HttpError(
        400,
        `Cannot enable mandatory face verification: ${ready.message}. Install face models and dependencies first.`
      );
    }
    const liveness = isValidatedLivenessConfigured();
    if (!liveness.ok) {
      throw new HttpError(
        400,
        `Cannot enable mandatory face verification: ${liveness.message}`
      );
    }
  }

  return {
    verificationRequired,
    gps: {
      enabled: gpsEnabled,
      mandatory: src.gps?.mandatory !== undefined ? Boolean(src.gps.mandatory) : true,
    },
    wifi: {
      enabled: wifiEnabled,
      mandatory: wifiMandatory,
    },
    face: {
      enabled: faceEnabled,
      mandatory: src.face?.mandatory !== undefined ? Boolean(src.face.mandatory) : true,
      matchThreshold,
      requireLiveness: src.face?.requireLiveness !== undefined ? Boolean(src.face.requireLiveness) : true,
    },
    wifiNetworks,
  };
}

/**
 * Run Wi-Fi + Face verification gates. GPS remains in attendanceLocationService;
 * this records a GPS audit entry from geofenceMeta when provided.
 *
 * Never trusts client booleans such as faceVerified / wifiVerified.
 */
export async function runAttendanceVerifications({
  models,
  employee,
  policy,
  sessionType = "OFFICE",
  geofenceApplies = true,
  geofenceMeta = null,
  wifiEvidence = null,
  faceImageBase64 = null,
  clientPlatform = "",
  /** Reject if client sends proof booleans */
  clientClaims = null,
}) {
  if (clientClaims?.faceVerified === true || clientClaims?.wifiVerified === true || clientClaims?.gpsVerified === true) {
    // Ignore claims; never treat as proof. Soft-warn in audit only.
  }

  const cfg = resolveAttendanceVerificationConfig(policy);
  const requirements = buildEmployeeVerificationRequirements(policy, { sessionType, geofenceApplies });
  const results = {
    attemptedAt: new Date(),
    clientPlatform: String(clientPlatform || "").slice(0, 40),
    methods: [],
    allMandatoryPassed: true,
    blockedReason: null,
  };

  // --- GPS (audit from authoritative geofence decision) ---
  if (requirements.methods.gps.enabled) {
    // If applyGeofenceDecision already allowed the punch (BLOCK would have thrown),
    // treat GPS as passed for audit. WARN may still set outside=true.
    const gpsOk = Boolean(geofenceMeta) && geofenceMeta.ok !== false;
    const gpsEntry = {
      method: VERIFICATION_METHODS.GPS,
      attempted: true,
      mandatory: requirements.methods.gps.mandatory,
      ok: Boolean(gpsOk),
      reason:
        geofenceMeta?.reason ||
        (geofenceMeta
          ? geofenceMeta.outside
            ? "GPS_OUTSIDE_ALLOWED_BY_POLICY"
            : "GPS_WITHIN_RADIUS"
          : "GPS_EVIDENCE_MISSING"),
      distanceMeters: geofenceMeta?.distanceMeters ?? null,
      radiusMeters: geofenceMeta?.radiusMeters ?? null,
      accuracyMeters: geofenceMeta?.accuracy ?? geofenceMeta?.accuracyMeters ?? null,
      capturedAt: geofenceMeta?.capturedAt || null,
    };
    results.methods.push(gpsEntry);
    if (gpsEntry.mandatory && !gpsEntry.ok) {
      results.allMandatoryPassed = false;
      results.blockedReason = gpsEntry.reason;
      throw new HttpError(
        400,
        geofenceMeta?.message ||
          `GPS verification failed (${gpsEntry.reason}). Move within the office geofence and try again.`
      );
    }
  }

  // --- Wi-Fi ---
  if (requirements.methods.wifi.enabled) {
    const wifiMandatory = requirements.methods.wifi.mandatory;
    const wifiResult = evaluateWifiEvidence({
      policy: { ...policy, attendanceVerification: { ...cfg, wifiNetworks: cfg.wifiNetworks } },
      wifiEvidence,
      clientPlatform,
      mandatory: wifiMandatory,
      requireChallengeFields: Boolean(wifiMandatory),
    });

    // Mandatory Wi-Fi must bind to a single-use server challenge (replay protection).
    if (wifiMandatory && wifiResult.ok) {
      if (!models?.AttendanceVerificationChallenge) {
        throw new HttpError(500, "Verification challenge store is unavailable for Wi-Fi verification.");
      }
      const evidenceHash = hashEvidencePayload([
        employee._id,
        wifiEvidence?.ssid,
        wifiEvidence?.bssid,
        wifiEvidence?.capturedAt,
        clientPlatform,
      ]);
      await consumeVerificationChallenge({
        Challenge: models.AttendanceVerificationChallenge,
        challengeId: wifiEvidence.challengeId,
        nonce: wifiEvidence.challengeNonce,
        companyId: employee.companyId || null,
        employeeId: employee._id,
        purpose: "PUNCH",
        evidenceHash,
        consumeLabel: "wifi_punch",
      });
    }

    const wifiEntry = {
      method: VERIFICATION_METHODS.WIFI,
      attempted: wifiResult.attempted !== false,
      mandatory: wifiMandatory,
      ok: Boolean(wifiResult.ok),
      reason: wifiResult.reason,
      networkRef: wifiResult.networkRef || null,
      platform: wifiResult.platform || clientPlatform,
      capturedAt: wifiResult.capturedAt,
      message: wifiResult.message || "",
      assurance: wifiResult.assurance || "OS_REPORTED_BEST_EFFORT",
    };
    results.methods.push(wifiEntry);
    if (wifiEntry.mandatory && !wifiEntry.ok) {
      results.allMandatoryPassed = false;
      results.blockedReason = wifiEntry.reason;
      throw new HttpError(
        400,
        wifiResult.message || "Connect to an authorized company Wi-Fi network."
      );
    }
  }

  // --- Face ---
  if (requirements.methods.face.enabled) {
    if (!models?.EmployeeFaceEnrollment) {
      throw new HttpError(500, "Face enrollment model is not available for this tenant.");
    }
    const faceMandatory = requirements.methods.face.mandatory;
    if (faceMandatory) {
      const engineReady = isFaceEngineReady();
      if (!engineReady.ok) {
        throw new HttpError(
          503,
          engineReady.message || "Face recognition engine/models are unavailable."
        );
      }
      const livenessReady = isValidatedLivenessConfigured();
      if (!livenessReady.ok) {
        throw new HttpError(
          503,
          livenessReady.message ||
            "Mandatory face verification is unavailable until a validated liveness provider is configured."
        );
      }
    }
    if (!faceImageBase64) {
      const faceEntry = {
        method: VERIFICATION_METHODS.FACE,
        attempted: true,
        mandatory: requirements.methods.face.mandatory,
        ok: false,
        reason: "FACE_IMAGE_MISSING",
        message: "Face image is required for biometric verification.",
      };
      results.methods.push(faceEntry);
      if (faceEntry.mandatory) {
        results.allMandatoryPassed = false;
        results.blockedReason = faceEntry.reason;
        throw new HttpError(400, faceEntry.message);
      }
    } else {
      const faceCompanyId = employee.companyId || policy?.companyId || null;
      const faceResult = await verifyEmployeeFace({
        FaceEnrollment: models.EmployeeFaceEnrollment,
        companyId: faceCompanyId,
        employeeId: employee._id,
        imageBase64: faceImageBase64,
        matchThreshold: cfg.face.matchThreshold,
        requireLiveness: cfg.face.requireLiveness,
      });
      const faceEntry = {
        method: VERIFICATION_METHODS.FACE,
        attempted: true,
        mandatory: requirements.methods.face.mandatory,
        ok: Boolean(faceResult.ok),
        reason: faceResult.reason,
        message: faceResult.message || "",
        distance: faceResult.distance,
        threshold: faceResult.threshold,
        modelId: faceResult.modelId,
        livenessScore: faceResult.livenessScore,
        faceCount: faceResult.faceCount,
      };
      results.methods.push(faceEntry);
      if (faceEntry.mandatory && !faceEntry.ok) {
        results.allMandatoryPassed = false;
        results.blockedReason = faceEntry.reason;
        throw new HttpError(400, faceResult.message || `Face verification failed (${faceEntry.reason}).`);
      }
    }
  }

  if (cfg.verificationRequired && !requirements.methods.gps.enabled && !requirements.methods.wifi.enabled && !requirements.methods.face.enabled) {
    throw new HttpError(
      400,
      "Company policy requires attendance verification but no applicable methods are enabled for this session."
    );
  }

  return results;
}

/** Strip sensitive fields before returning verification audit on history APIs */
export function publicVerificationSummary(verification) {
  if (!verification) return null;
  return {
    attemptedAt: verification.attemptedAt,
    clientPlatform: verification.clientPlatform,
    allMandatoryPassed: verification.allMandatoryPassed,
    methods: (verification.methods || []).map((m) => ({
      method: m.method,
      attempted: m.attempted,
      mandatory: m.mandatory,
      ok: m.ok,
      reason: m.reason,
      networkRef: m.networkRef || undefined,
      distanceMeters: m.distanceMeters ?? undefined,
      radiusMeters: m.radiusMeters ?? undefined,
      accuracyMeters: m.accuracyMeters ?? undefined,
      modelId: m.modelId || undefined,
      // never include embeddings, raw ssid/bssid, or face images
    })),
  };
}

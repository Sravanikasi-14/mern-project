/**
 * Strict face liveness / PAD provider registry.
 *
 * Mandatory face verification may unlock ONLY when:
 * 1. FACE_LIVENESS_PROVIDER names a registered provider, AND
 * 2. that provider is marked as a validated PAD implementation, AND
 * 3. it is implemented, AND
 * 4. isReady() succeeds (models loaded / initialized).
 *
 * Heuristic landmark checks are registered but never qualify as validated PAD.
 * MiniFASNet is reserved for Phase 2 and is not ready until models are integrated.
 *
 * Never trust arbitrary env strings such as "vendor:foo" or "challenge-response".
 */

export const LIVENESS_PROVIDER_IDS = Object.freeze({
  HEURISTIC: "heuristic",
  MINIFASNET: "minifasnet",
  /** NODE_ENV=test only — never use in production */
  TEST_HARNESS: "test-harness",
});

/**
 * @typedef {object} LivenessProviderEntry
 * @property {string} id
 * @property {boolean} implemented
 * @property {boolean} qualifiesAsValidatedPad
 * @property {string} license
 * @property {string} description
 * @property {() => { ok: boolean, message?: string, detail?: object }} isReady
 */

/** @type {Record<string, LivenessProviderEntry>} */
const PROVIDERS = Object.freeze({
  [LIVENESS_PROVIDER_IDS.HEURISTIC]: Object.freeze({
    id: LIVENESS_PROVIDER_IDS.HEURISTIC,
    implemented: true,
    qualifiesAsValidatedPad: false,
    license: "n/a (HRMS heuristic, not a PAD model)",
    description:
      "Single-frame landmark variance + detection score. Not presentation-attack detection.",
    isReady() {
      return { ok: true, message: "Heuristic checks available (not validated PAD)." };
    },
  }),

  [LIVENESS_PROVIDER_IDS.MINIFASNET]: Object.freeze({
    id: LIVENESS_PROVIDER_IDS.MINIFASNET,
    // Code path not wired in Phase 1 — treated as unimplemented until Phase 2 ships inference + weights.
    implemented: false,
    qualifiesAsValidatedPad: true,
    license: "Apache-2.0 (minivision-ai/Silent-Face-Anti-Spoofing)",
    description:
      "Reserved Phase 2 provider: MiniVision MiniFASNet silent face anti-spoofing (PAD). Not integrated yet; PAD weights are not loaded.",
    isReady() {
      return {
        ok: false,
        message:
          "MiniFASNet PAD is not implemented yet (Phase 2) and PAD models are not installed. " +
          "Mandatory face verification remains unavailable. Do not set FACE_LIVENESS_PROVIDER=minifasnet in production.",
        detail: { modelsPresent: false, initialized: false },
      };
    },
  }),

  [LIVENESS_PROVIDER_IDS.TEST_HARNESS]: Object.freeze({
    id: LIVENESS_PROVIDER_IDS.TEST_HARNESS,
    implemented: true,
    qualifiesAsValidatedPad: true,
    license: "n/a (automated tests only)",
    description: "Test-only unlock for mandatory-face integration tests. Forbidden outside NODE_ENV=test.",
    isReady() {
      if (process.env.NODE_ENV !== "test") {
        return {
          ok: false,
          message: "test-harness liveness provider is only allowed when NODE_ENV=test.",
        };
      }
      return { ok: true, message: "Test harness PAD unlock active." };
    },
  }),
});

export function listLivenessProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    implemented: p.implemented,
    qualifiesAsValidatedPad: p.qualifiesAsValidatedPad,
    license: p.license,
    description: p.description,
  }));
}

export function getLivenessProvider(providerId) {
  const id = String(providerId || "")
    .trim()
    .toLowerCase();
  if (!id) return null;
  return PROVIDERS[id] || null;
}

/**
 * Normalize FACE_LIVENESS_PROVIDER env (or explicit override).
 * Empty / none / off → heuristic.
 */
export function resolveConfiguredLivenessProviderId(rawEnv = process.env.FACE_LIVENESS_PROVIDER) {
  const raw = String(rawEnv ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "none" || raw === "off") {
    return LIVENESS_PROVIDER_IDS.HEURISTIC;
  }
  return raw;
}

/**
 * Whether a validated PAD provider is configured AND ready.
 * Used to gate mandatory face in policy sanitize and punch enforcement.
 */
export function isValidatedLivenessConfigured() {
  const providerId = resolveConfiguredLivenessProviderId();
  const entry = getLivenessProvider(providerId);

  if (!entry) {
    return {
      ok: false,
      provider: providerId,
      reason: "UNKNOWN_PROVIDER",
      message:
        `Unknown FACE_LIVENESS_PROVIDER "${providerId}". ` +
        `Allowed ids: ${Object.keys(PROVIDERS).join(", ")}. ` +
        "Arbitrary strings cannot unlock mandatory face verification.",
    };
  }

  if (!entry.qualifiesAsValidatedPad) {
    return {
      ok: false,
      provider: entry.id,
      reason: "NOT_VALIDATED_PAD",
      message:
        "Mandatory face verification requires a validated presentation-attack detection (PAD) provider. " +
        "Heuristic landmark checks are not production anti-spoofing. " +
        "Keep face optional, or wait for Phase 2 MiniFASNet integration.",
    };
  }

  if (!entry.implemented) {
    return {
      ok: false,
      provider: entry.id,
      reason: "NOT_IMPLEMENTED",
      message:
        entry.description ||
        `Liveness provider "${entry.id}" is registered but not implemented yet.`,
    };
  }

  const ready = entry.isReady();
  if (!ready?.ok) {
    return {
      ok: false,
      provider: entry.id,
      reason: "NOT_READY",
      message:
        ready?.message ||
        `Liveness provider "${entry.id}" is not initialized or PAD models are missing.`,
      detail: ready?.detail,
    };
  }

  return {
    ok: true,
    provider: entry.id,
    source: "registry",
    reason: "PAD_READY",
    message: ready.message || `Liveness provider "${entry.id}" is ready.`,
  };
}

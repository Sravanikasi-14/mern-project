/**
 * Platform Admin MFA enforcement controls.
 *
 * TEMPORARY (current release): mandatory MFA is paused by default.
 * Set PLATFORM_ADMIN_MFA_ENFORCEMENT=on to restore enrollment + OTP requirements
 * without redeploying MFA infrastructure.
 *
 * Development convenience: NODE_ENV=development also bypasses MFA when enforcement
 * is on (unchanged local DX). Never weakens tenant (company/HR/employee) auth.
 */

function normalizeEnv(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Explicit development-only safeguard (NODE_ENV === "development" only).
 * Always false in production / test / staging.
 */
export function isPlatformAdminDevMfaBypassEnabled() {
  const env = normalizeEnv(process.env.NODE_ENV);
  if (env === "production") return false;
  return env === "development";
}

/**
 * Temporary release pause of mandatory Platform Admin MFA.
 *
 * - Default (unset): paused (`off`) for this release.
 * - `off` | `paused` | `false` | `0` | `disabled` | `bypass` → paused
 * - `on` | `enforced` | `true` | `1` | `enabled` | `required` → MFA required again
 */
export function isPlatformAdminMfaEnforcementPaused() {
  const raw = normalizeEnv(process.env.PLATFORM_ADMIN_MFA_ENFORCEMENT);
  if (!raw) return true; // temporary default: paused
  if (["on", "enforced", "true", "1", "enabled", "required"].includes(raw)) {
    return false;
  }
  if (["off", "paused", "false", "0", "disabled", "bypass"].includes(raw)) {
    return true;
  }
  // Unknown values fail closed toward pause for this temporary release only.
  return true;
}

/**
 * True when password-only Platform Admin sessions are allowed
 * (temporary pause and/or development bypass).
 */
export function isPlatformAdminMfaBypassEnabled() {
  return isPlatformAdminMfaEnforcementPaused() || isPlatformAdminDevMfaBypassEnabled();
}

/** Audit / diagnostics label for which bypass path applied. */
export function platformAdminMfaBypassReason() {
  if (isPlatformAdminMfaEnforcementPaused()) return "mfa_enforcement_paused";
  if (isPlatformAdminDevMfaBypassEnabled()) return "dev_mfa_bypass";
  return null;
}

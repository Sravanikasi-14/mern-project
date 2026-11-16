/**
 * Explicit development-only safeguard for Platform Admin MFA bypass.
 *
 * Enabled only when NODE_ENV is exactly "development".
 * Always disabled when NODE_ENV is "production" (and for test/staging/unset).
 *
 * Does not affect tenant (company/employee/HR) authentication.
 */
export function isPlatformAdminDevMfaBypassEnabled() {
  const env = String(process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (env === "production") return false;
  return env === "development";
}

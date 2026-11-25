/**
 * Permanent platform entitlement denials from the API interceptor / gates.
 * Used to stop chat unread polling without treating other 403s as fatal.
 */
export function isPermanentPlatformEntitlementError(error) {
  if (error?.response?.status !== 403) return false;
  const code = error?.response?.data?.code;
  return code === "PLATFORM_MODULE_DISABLED" || code === "PLATFORM_FEATURE_DISABLED";
}

import { HttpError } from "./httpError.js";

/**
 * Subscription lifecycle policy (Batch 4):
 * - Company.status and subscription.status are independent.
 * - Company SUSPENDED/CANCELLED continues to block via LOGIN_ALLOWED_STATUSES.
 * - Subscription SUSPENDED | EXPIRED | CANCELLED blocks tenant login and API auth.
 * - Subscription TRIAL | ACTIVE allow access (subject to company status + entitlements).
 * - Suspension never deletes company or tenant data.
 */
export const SUBSCRIPTION_LOGIN_BLOCKED = new Set(["SUSPENDED", "EXPIRED", "CANCELLED"]);

export function getSubscriptionStatus(company) {
  return String(company?.subscription?.status || "TRIAL").toUpperCase();
}

export function isSubscriptionLoginAllowed(company) {
  return !SUBSCRIPTION_LOGIN_BLOCKED.has(getSubscriptionStatus(company));
}

export function assertSubscriptionAllowsAccess(company) {
  if (isSubscriptionLoginAllowed(company)) return;
  const status = getSubscriptionStatus(company);
  throw new HttpError(
    403,
    status === "SUSPENDED"
      ? "This company's subscription is suspended. Contact your platform administrator."
      : "This company's subscription is not active.",
    {
      code: "SUBSCRIPTION_INACTIVE",
      subscriptionStatus: status,
    }
  );
}

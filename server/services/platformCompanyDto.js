import { COMPANY_STATUSES } from "../models/Company.js";

/** Approved metadata projection — never includes databaseName, secrets, or blobs. */
export const PLATFORM_COMPANY_LIST_SELECT = [
  "_id",
  "companyName",
  "slug",
  "status",
  "subscription.plan",
  "subscription.planId",
  "subscription.maxEmployeeSeats",
  "subscription.startDate",
  "subscription.endDate",
  "subscription.trialEndsAt",
  "subscription.renewalDate",
  "subscription.status",
  "subscription.billingStatus",
  "subscription.billingCycle",
  "subscription.amount",
  "subscription.currency",
  "config.timezone",
  "config.currencyCode",
  "primaryContact.fullName",
  "primaryContact.email",
  "primaryContact.phoneNumber",
  "branding.displayName",
  "branding.primaryColor",
  "tenantIndexSchemaVersion",
  "tenantIndexProvisionedAt",
  "platformProvisioning",
  "lifecycleHistory",
  "createdAt",
  "updatedAt",
].join(" ");

export function toPlatformCompanyDto(company) {
  if (!company) return null;
  const sub = company.subscription || {};
  const cfg = company.config || {};
  const contact = company.primaryContact || {};
  const branding = company.branding || {};
  const prov = company.platformProvisioning || {};

  return {
    id: String(company._id),
    companyName: company.companyName,
    slug: company.slug,
    status: company.status,
    subscription: {
      plan: sub.plan || "TRIAL",
      planId: sub.planId ? String(sub.planId) : null,
      maxEmployeeSeats: sub.maxEmployeeSeats ?? null,
      startDate: sub.startDate || null,
      endDate: sub.endDate || null,
      trialEndsAt: sub.trialEndsAt || null,
      renewalDate: sub.renewalDate || null,
      status: sub.status || "TRIAL",
      billingStatus: sub.billingStatus || "NONE",
      billingCycle: sub.billingCycle || "NONE",
      amount: sub.amount ?? 0,
      currency: sub.currency || "INR",
    },
    config: {
      timezone: cfg.timezone || null,
      currencyCode: cfg.currencyCode || null,
    },
    primaryContact: {
      fullName: contact.fullName || "",
      email: contact.email || "",
      phoneNumber: contact.phoneNumber || "",
    },
    branding: {
      displayName: branding.displayName || "",
      primaryColor: branding.primaryColor || "",
      hasLogo: Boolean(branding.logoUrl),
    },
    provisioning: {
      tenantIndexSchemaVersion: company.tenantIndexSchemaVersion ?? null,
      tenantIndexProvisionedAt: company.tenantIndexProvisionedAt || null,
      lastAttemptAt: prov.lastAttemptAt || null,
      lastStatus: prov.lastStatus || (company.tenantIndexSchemaVersion != null ? "SUCCESS" : "UNKNOWN"),
      lastMessage: prov.lastMessage || "",
      fullyProvisioned: Boolean(prov.fullyProvisioned ?? company.tenantIndexSchemaVersion != null),
    },
    lifecycleHistory: Array.isArray(company.lifecycleHistory)
      ? company.lifecycleHistory.slice(-20).map((row) => ({
          action: row.action,
          at: row.at,
          note: row.note || "",
          byPlatformAdminId: row.byPlatformAdminId
            ? String(row.byPlatformAdminId)
            : "",
        }))
      : [],
    createdAt: company.createdAt || null,
    updatedAt: company.updatedAt || null,
    // Explicitly never expose:
    // databaseName, emailSettings secrets, letterhead.signatureData, branding.logoData
  };
}

export function isAllowedLifecycleStatus(status) {
  return status === COMPANY_STATUSES.ACTIVE || status === COMPANY_STATUSES.SUSPENDED;
}

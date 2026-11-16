import mongoose from "mongoose";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { getCentralDbName } from "../config/db.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { invalidateCompanyMetadataCache } from "../utils/companyMetadataCache.js";
import { provisionTenantDatabase } from "./tenantProvisioningService.js";
import {
  PLATFORM_AUDIT_ACTIONS,
  listPlatformAuditForTarget,
  recordPlatformAudit,
} from "./platformAuditService.js";
import {
  PLATFORM_COMPANY_LIST_SELECT,
  isAllowedLifecycleStatus,
  toPlatformCompanyDto,
} from "./platformCompanyDto.js";

function slugify(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function databaseNameForSlug(slug) {
  const safe = String(slug).replace(/-/g, "_");
  return `company_${safe}`;
}

function pushLifecycle(company, action, admin, note = "") {
  if (!Array.isArray(company.lifecycleHistory)) company.lifecycleHistory = [];
  company.lifecycleHistory.push({
    action,
    at: new Date(),
    byPlatformAdminId: admin?._id || null,
    note: String(note || "").slice(0, 200),
  });
  if (company.lifecycleHistory.length > 50) {
    company.lifecycleHistory = company.lifecycleHistory.slice(-50);
  }
}

function applyProvisioningOutcome(company, outcome, ok) {
  company.platformProvisioning = {
    lastAttemptAt: new Date(),
    lastStatus: ok ? "SUCCESS" : "FAILED",
    lastMessage: String(outcome?.message || (ok ? "Provisioned" : "Provisioning failed")).slice(0, 300),
    fullyProvisioned: Boolean(ok && outcome?.fullyProvisioned),
  };
}

/**
 * Interactive Platform Admin company ops.
 * Never calls getCompanyModels. Provisioning uses tenantProvisioningService only.
 */
export async function listPlatformCompanies({
  search = "",
  status = "",
  page = 1,
  limit = 20,
} = {}) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const filter = {};

  if (status && Object.values(COMPANY_STATUSES).includes(status)) {
    filter.status = status;
  }

  const term = String(search || "").trim();
  if (term) {
    const rx = new RegExp(term.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), "i");
    filter.$or = [
      { companyName: rx },
      { slug: rx },
      { "primaryContact.email": rx },
    ];
  }

  const [total, rows] = await Promise.all([
    Company.countDocuments(filter),
    Company.find(filter)
      .select(PLATFORM_COMPANY_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  return {
    companies: rows.map(toPlatformCompanyDto),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

export async function getPlatformCompany(companyId) {
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId)
    .select(PLATFORM_COMPANY_LIST_SELECT)
    .lean();
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const history = await listPlatformAuditForTarget({
    targetType: "Company",
    targetId: company._id,
    limit: 40,
  });
  return {
    company: toPlatformCompanyDto(company),
    auditHistory: history.map((row) => ({
      id: String(row._id),
      action: row.action,
      outcome: row.outcome,
      actorEmail: row.actorEmail,
      metadata: row.metadata || {},
      timestamp: row.timestamp,
    })),
  };
}

export async function createPlatformCompany({ payload, admin, req }) {
  const companyName = String(payload?.companyName || "").trim();
  const slug = slugify(payload?.slug || payload?.companyCode || companyName);
  const timezone = String(payload?.timezone || "Asia/Kolkata").trim() || "Asia/Kolkata";
  const currencyCode = String(payload?.currencyCode || "INR").trim() || "INR";
  const contactName = String(payload?.primaryContact?.fullName || "").trim();
  const contactEmail = normalizeEmail(payload?.primaryContact?.email || "");
  const contactPhone = String(payload?.primaryContact?.phoneNumber || "").trim();
  const plan = String(payload?.subscription?.plan || "TRIAL").trim() || "TRIAL";
  const maxEmployeeSeats = Number.parseInt(payload?.subscription?.maxEmployeeSeats, 10);
  const initialStatus = payload?.status === COMPANY_STATUSES.ACTIVE
    ? COMPANY_STATUSES.ACTIVE
    : COMPANY_STATUSES.TRIAL;

  if (!companyName || companyName.length < 2) {
    throw new HttpError(400, "Company name is required", { code: "VALIDATION_ERROR" });
  }
  if (!slug || slug.length < 2) {
    throw new HttpError(400, "Valid company code (slug) is required", {
      code: "VALIDATION_ERROR",
    });
  }
  if (!contactEmail || !isValidEmail(contactEmail)) {
    throw new HttpError(
      400,
      "Primary contact email is required so initial admin setup cannot be claimed by an arbitrary email",
      { code: "VALIDATION_ERROR" }
    );
  }

  const databaseName = databaseNameForSlug(slug);
  if (databaseName === getCentralDbName()) {
    throw new HttpError(400, "Invalid company code", { code: "VALIDATION_ERROR" });
  }

  const existing = await Company.findOne({
    $or: [{ slug }, { databaseName }],
  })
    .select("_id")
    .lean();
  if (existing) {
    throw new HttpError(409, "A company with this code already exists", {
      code: "COMPANY_EXISTS",
    });
  }

  const { ensureDefaultPlansSeeded } = await import("./platformPlanService.js");
  const PlatformPlan = (await import("../models/PlatformPlan.js")).default;
  await ensureDefaultPlansSeeded();
  const planDoc = await PlatformPlan.findOne({
    code: String(plan).toUpperCase(),
    isActive: true,
  }).lean();
  const planCode = planDoc?.code || String(plan).toUpperCase() || "TRIAL";
  const seats =
    Number.isFinite(maxEmployeeSeats) && maxEmployeeSeats > 0
      ? maxEmployeeSeats
      : planDoc?.maxEmployeeSeats || 10;

  const company = new Company({
    companyName,
    slug,
    databaseName,
    status: initialStatus,
    branding: {
      displayName: companyName,
      primaryColor: "#155a37",
    },
    config: {
      timezone,
      currencyCode,
      enabledModules: [],
    },
    primaryContact: {
      fullName: contactName,
      email: contactEmail,
      phoneNumber: contactPhone,
    },
    subscription: {
      plan: planCode,
      planId: planDoc?._id || null,
      maxEmployeeSeats: seats,
      status: initialStatus === "ACTIVE" ? "ACTIVE" : "TRIAL",
      startDate: new Date(),
      endDate: null,
      trialEndsAt:
        planDoc?.trialDays > 0
          ? new Date(Date.now() + planDoc.trialDays * 24 * 60 * 60 * 1000)
          : null,
      billingCycle: planDoc?.billingCycle || "NONE",
      amount: planDoc?.amount || 0,
      currency: planDoc?.currency || "INR",
      billingStatus: "NONE",
      history: [],
    },
    platformProvisioning: {
      lastAttemptAt: null,
      lastStatus: "PENDING",
      lastMessage: "Awaiting provisioning",
      fullyProvisioned: false,
    },
    lifecycleHistory: [],
  });

  pushLifecycle(company, "CREATED", admin, "Registered via Platform Admin");
  await company.save();

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.COMPANY_CREATED,
    targetType: "Company",
    targetId: company._id,
    outcome: "SUCCESS",
    metadata: { slug, status: company.status, plan },
    req,
  });

  try {
    const provisionOutcome = await provisionTenantDatabase(company);
    const hardFail = Boolean(provisionOutcome?.indexFailures?.length);
    const provisionOk = !hardFail;
    applyProvisioningOutcome(company, provisionOutcome, provisionOk);
    pushLifecycle(
      company,
      provisionOk ? "PROVISIONED" : "PROVISION_FAILED",
      admin,
      company.platformProvisioning.lastMessage
    );
    await company.save();
    await recordPlatformAudit({
      actor: admin,
      action: provisionOk
        ? PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISIONED
        : PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISION_FAILED,
      targetType: "Company",
      targetId: company._id,
      outcome: provisionOk ? "SUCCESS" : "FAILURE",
      metadata: {
        fullyProvisioned: Boolean(provisionOutcome?.fullyProvisioned),
        collectionsCreated: provisionOutcome?.collectionsCreated?.length || 0,
        indexFailureCount: provisionOutcome?.indexFailures?.length || 0,
      },
      req,
    });
  } catch {
    applyProvisioningOutcome(company, { message: "Provisioning failed" }, false);
    pushLifecycle(company, "PROVISION_FAILED", admin, "Provisioning failed");
    await company.save();
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISION_FAILED,
      targetType: "Company",
      targetId: company._id,
      outcome: "FAILURE",
      metadata: { reason: "provision_exception" },
      req,
    });
  }

  invalidateCompanyMetadataCache(company._id);

  const refreshed = await Company.findById(company._id)
    .select(PLATFORM_COMPANY_LIST_SELECT)
    .lean();

  return {
    company: toPlatformCompanyDto(refreshed),
    provisioning: {
      ok: Boolean(refreshed?.platformProvisioning?.lastStatus === "SUCCESS"),
      status: refreshed?.platformProvisioning?.lastStatus || "UNKNOWN",
      message: refreshed?.platformProvisioning?.lastMessage || "",
    },
  };
}

export async function updatePlatformCompanyMetadata({ companyId, payload, admin, req }) {
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId);
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  const changes = {};
  if (payload?.companyName != null) {
    const name = String(payload.companyName).trim();
    if (name.length < 2) {
      throw new HttpError(400, "Company name is invalid", { code: "VALIDATION_ERROR" });
    }
    if (name !== company.companyName) {
      changes.companyName = { from: company.companyName, to: name };
      company.companyName = name;
      if (company.branding) company.branding.displayName = name;
    }
  }
  if (payload?.timezone != null) {
    const tz = String(payload.timezone).trim();
    if (tz && tz !== company.config?.timezone) {
      changes.timezone = { from: company.config?.timezone, to: tz };
      company.config.timezone = tz;
    }
  }
  if (payload?.currencyCode != null) {
    const cur = String(payload.currencyCode).trim().toUpperCase();
    if (cur && cur !== company.config?.currencyCode) {
      changes.currencyCode = { from: company.config?.currencyCode, to: cur };
      company.config.currencyCode = cur;
    }
  }
  if (payload?.primaryContact) {
    const pc = payload.primaryContact;
    if (pc.fullName != null) company.primaryContact.fullName = String(pc.fullName).trim();
    if (pc.phoneNumber != null) company.primaryContact.phoneNumber = String(pc.phoneNumber).trim();
    if (pc.email != null) {
      const email = normalizeEmail(pc.email);
      if (email && !isValidEmail(email)) {
        throw new HttpError(400, "Primary contact email is invalid", {
          code: "VALIDATION_ERROR",
        });
      }
      company.primaryContact.email = email;
    }
    changes.primaryContact = true;
  }
  if (payload?.subscription) {
    if (
      payload.subscription.plan != null ||
      payload.subscription.planId != null ||
      payload.subscription.planCode != null ||
      payload.subscription.status != null ||
      payload.subscription.maxEmployeeSeats != null
    ) {
      throw new HttpError(
        400,
        "Subscription plan, seats, and status must be changed via PATCH /api/platform/companies/:id/subscription",
        { code: "USE_SUBSCRIPTION_API" }
      );
    }
  }

  if (Object.keys(changes).length === 0) {
    return { company: toPlatformCompanyDto(company.toObject()) };
  }

  pushLifecycle(company, "METADATA_UPDATED", admin, "Metadata updated");
  await company.save();
  invalidateCompanyMetadataCache(company._id);

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.COMPANY_METADATA_UPDATED,
    targetType: "Company",
    targetId: company._id,
    outcome: "SUCCESS",
    metadata: { fields: Object.keys(changes) },
    req,
  });

  return { company: toPlatformCompanyDto(company.toObject()) };
}

export async function setPlatformCompanyStatus({ companyId, status, confirm, admin, req }) {
  if (!confirm) {
    throw new HttpError(400, "Confirmation is required for status changes", {
      code: "CONFIRMATION_REQUIRED",
    });
  }
  if (!isAllowedLifecycleStatus(status)) {
    throw new HttpError(400, "Status must be ACTIVE or SUSPENDED", {
      code: "VALIDATION_ERROR",
    });
  }
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  const company = await Company.findById(companyId);
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  const previous = company.status;
  if (previous === status) {
    return { company: toPlatformCompanyDto(company.toObject()), unchanged: true };
  }

  company.status = status;
  pushLifecycle(
    company,
    status === COMPANY_STATUSES.SUSPENDED ? "SUSPENDED" : "ACTIVATED",
    admin,
    `Status ${previous} → ${status}`
  );
  await company.save();
  invalidateCompanyMetadataCache(company._id);

  await recordPlatformAudit({
    actor: admin,
    action:
      status === COMPANY_STATUSES.SUSPENDED
        ? PLATFORM_AUDIT_ACTIONS.COMPANY_SUSPENDED
        : PLATFORM_AUDIT_ACTIONS.COMPANY_ACTIVATED,
    targetType: "Company",
    targetId: company._id,
    outcome: "SUCCESS",
    metadata: { from: previous, to: status },
    req,
  });

  return { company: toPlatformCompanyDto(company.toObject()), unchanged: false };
}

export async function reprovisionPlatformCompany({ companyId, admin, req }) {
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId);
  if (!company) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }

  try {
    const outcome = await provisionTenantDatabase(company);
    const ok = Boolean(outcome?.fullyProvisioned) || !(outcome?.indexFailures?.length);
    applyProvisioningOutcome(company, outcome, ok);
    pushLifecycle(company, ok ? "PROVISIONED" : "PROVISION_FAILED", admin, company.platformProvisioning.lastMessage);
    await company.save();
    await recordPlatformAudit({
      actor: admin,
      action: ok
        ? PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISIONED
        : PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISION_FAILED,
      targetType: "Company",
      targetId: company._id,
      outcome: ok ? "SUCCESS" : "FAILURE",
      metadata: {
        fullyProvisioned: Boolean(outcome?.fullyProvisioned),
        indexFailureCount: outcome?.indexFailures?.length || 0,
      },
      req,
    });
    return {
      company: toPlatformCompanyDto(company.toObject()),
      provisioning: {
        ok,
        status: company.platformProvisioning.lastStatus,
        message: company.platformProvisioning.lastMessage,
      },
    };
  } catch {
    applyProvisioningOutcome(company, { message: "Provisioning failed" }, false);
    pushLifecycle(company, "PROVISION_FAILED", admin, "Provisioning failed");
    await company.save();
    await recordPlatformAudit({
      actor: admin,
      action: PLATFORM_AUDIT_ACTIONS.COMPANY_PROVISION_FAILED,
      targetType: "Company",
      targetId: company._id,
      outcome: "FAILURE",
      metadata: { reason: "provision_exception" },
      req,
    });
    throw new HttpError(502, "Tenant provisioning failed", {
      code: "PROVISION_FAILED",
    });
  }
}

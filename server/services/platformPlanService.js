import mongoose from "mongoose";
import Company from "../models/Company.js";
import PlatformPlan, { PLAN_BILLING_CYCLES } from "../models/PlatformPlan.js";
import PlatformInvoice, {
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
} from "../models/PlatformInvoice.js";
import {
  listPlatformCapabilityKeys,
  listPlatformModuleKeys,
  PLATFORM_PLAN_ENTITLEMENTS,
} from "../constants/platformFeatureCatalog.js";
import { HttpError } from "../utils/httpError.js";
import {
  PLATFORM_AUDIT_ACTIONS,
  recordPlatformAudit,
} from "./platformAuditService.js";
import {
  getCachedPlatformPlanByCode,
  getCachedPlatformPlanById,
  invalidatePlatformPlanCache,
  setCachedPlatformPlan,
} from "../utils/platformEntitlementCache.js";

let seedPromise = null;

function allModuleKeys() {
  return listPlatformModuleKeys();
}

/** Seed catalog defaults once — preserves Batch 2 behavior for known codes. */
export async function ensureDefaultPlansSeeded() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const defaults = [
      {
        code: "TRIAL",
        name: "Trial",
        description: "Default trial plan with full module access",
        modulesAll: true,
        includedModules: [],
        maxEmployeeSeats: 10,
        amount: 0,
        billingCycle: PLAN_BILLING_CYCLES.NONE,
        trialDays: 14,
        sortOrder: 10,
        isSystem: true,
      },
      {
        code: "GROWTH",
        name: "Growth",
        description: "Growth plan with full module access",
        modulesAll: true,
        includedModules: [],
        maxEmployeeSeats: 100,
        amount: 0,
        billingCycle: PLAN_BILLING_CYCLES.MONTHLY,
        sortOrder: 20,
        isSystem: true,
      },
      {
        code: "ENTERPRISE",
        name: "Enterprise",
        description: "Enterprise plan with full module access",
        modulesAll: true,
        includedModules: [],
        maxEmployeeSeats: 1000,
        amount: 0,
        billingCycle: PLAN_BILLING_CYCLES.YEARLY,
        sortOrder: 30,
        isSystem: true,
      },
      {
        code: "BASIC",
        name: "Basic",
        description: "Core HR modules only",
        modulesAll: false,
        includedModules: [...PLATFORM_PLAN_ENTITLEMENTS.BASIC.modules],
        maxEmployeeSeats: 25,
        amount: 0,
        billingCycle: PLAN_BILLING_CYCLES.MONTHLY,
        sortOrder: 40,
        isSystem: true,
      },
      {
        code: "RESTRICTED",
        name: "Restricted",
        description: "Minimal modules for constrained tenants",
        modulesAll: false,
        includedModules: [...PLATFORM_PLAN_ENTITLEMENTS.RESTRICTED.modules],
        maxEmployeeSeats: 10,
        amount: 0,
        billingCycle: PLAN_BILLING_CYCLES.NONE,
        sortOrder: 50,
        isSystem: true,
      },
    ];

    for (const row of defaults) {
      await PlatformPlan.updateOne(
        { code: row.code },
        { $setOnInsert: row },
        { upsert: true }
      );
    }
  })().catch((err) => {
    // Allow a later request to retry seeding after a transient DB failure.
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

export function toPlanDto(plan, { companyCount = null } = {}) {
  if (!plan) return null;
  return {
    id: String(plan._id),
    code: plan.code,
    name: plan.name,
    description: plan.description || "",
    isActive: Boolean(plan.isActive),
    modulesAll: Boolean(plan.modulesAll),
    includedModules: plan.modulesAll ? [...allModuleKeys()] : [...(plan.includedModules || [])],
    includedCapabilities: [...(plan.includedCapabilities || [])],
    maxEmployeeSeats: plan.maxEmployeeSeats,
    maxStorageMb: plan.maxStorageMb || 0,
    amount: plan.amount || 0,
    currency: plan.currency || "INR",
    billingCycle: plan.billingCycle || "NONE",
    trialDays: plan.trialDays || 0,
    sortOrder: plan.sortOrder ?? 100,
    isSystem: Boolean(plan.isSystem),
    companyCount,
    createdAt: plan.createdAt || null,
    updatedAt: plan.updatedAt || null,
  };
}

export function planAllowsModuleFromRecord(plan, moduleKey) {
  if (!plan) return false;
  const key = String(moduleKey || "");
  if (!allModuleKeys().includes(key)) return false;
  if (plan.modulesAll) return true;
  return Array.isArray(plan.includedModules) && plan.includedModules.includes(key);
}

export function planAllowsCapabilityFromRecord(plan, capabilityKey, moduleKey) {
  if (!planAllowsModuleFromRecord(plan, moduleKey)) return false;
  if (!Array.isArray(plan.includedCapabilities) || plan.includedCapabilities.length === 0) {
    return true;
  }
  return plan.includedCapabilities.includes(capabilityKey);
}

/**
 * Resolve the PlatformPlan document for a company.
 * Inactive plans remain effective for existing assignments (safe behavior).
 * Missing plan → null (fail closed).
 */
export async function resolvePlanRecordForCompany(company) {
  await ensureDefaultPlansSeeded();
  const planId = company?.subscription?.planId;
  if (planId && mongoose.isValidObjectId(planId)) {
    const cached = getCachedPlatformPlanById(planId);
    if (cached) return cached;
    const byId = await PlatformPlan.findById(planId).lean();
    if (byId) {
      setCachedPlatformPlan(byId);
      return byId;
    }
  }
  const code = String(company?.subscription?.plan || "TRIAL").toUpperCase();
  const cachedCode = getCachedPlatformPlanByCode(code);
  if (cachedCode) return cachedCode;
  const byCode = await PlatformPlan.findOne({ code }).lean();
  if (byCode) setCachedPlatformPlan(byCode);
  return byCode || null;
}

export async function listPlans({ includeInactive = true } = {}) {
  await ensureDefaultPlansSeeded();
  const filter = includeInactive ? {} : { isActive: true };
  const plans = await PlatformPlan.find(filter).sort({ sortOrder: 1, code: 1 }).lean();
  const counts = await Company.aggregate([
    { $group: { _id: "$subscription.planId", count: { $sum: 1 } } },
  ]);
  const countById = new Map(
    counts.filter((c) => c._id).map((c) => [String(c._id), c.count])
  );
  // Also count by plan code for legacy rows without planId
  const codeCounts = await Company.aggregate([
    { $group: { _id: { $toUpper: "$subscription.plan" }, count: { $sum: 1 } } },
  ]);
  const countByCode = new Map(codeCounts.map((c) => [String(c._id || ""), c.count]));

  return plans.map((p) =>
    toPlanDto(p, {
      companyCount: countById.get(String(p._id)) ?? countByCode.get(p.code) ?? 0,
    })
  );
}

export async function getPlan(planId) {
  await ensureDefaultPlansSeeded();
  if (!mongoose.isValidObjectId(planId)) {
    throw new HttpError(404, "Plan not found", { code: "PLAN_NOT_FOUND" });
  }
  const plan = await PlatformPlan.findById(planId).lean();
  if (!plan) throw new HttpError(404, "Plan not found", { code: "PLAN_NOT_FOUND" });
  const companyCount = await Company.countDocuments({
    $or: [{ "subscription.planId": plan._id }, { "subscription.plan": plan.code }],
  });
  const companies = await Company.find({
    $or: [{ "subscription.planId": plan._id }, { "subscription.plan": plan.code }],
  })
    .select("companyName slug status subscription.plan subscription.status")
    .sort({ companyName: 1 })
    .limit(100)
    .lean();
  return {
    plan: toPlanDto(plan, { companyCount }),
    companies: companies.map((c) => ({
      id: String(c._id),
      companyName: c.companyName,
      slug: c.slug,
      status: c.status,
      subscriptionStatus: c.subscription?.status || null,
      planCode: c.subscription?.plan || plan.code,
    })),
  };
}

function validateModuleList(modulesAll, includedModules) {
  if (modulesAll) return [];
  const allowed = new Set(allModuleKeys());
  const list = Array.isArray(includedModules) ? includedModules.map(String) : [];
  for (const key of list) {
    if (!allowed.has(key)) {
      throw new HttpError(400, `Unknown module in plan: ${key}`, {
        code: "UNKNOWN_FEATURE_KEY",
      });
    }
  }
  return list;
}

function validateCapabilityList(includedCapabilities) {
  if (!includedCapabilities?.length) return [];
  const allowed = new Set(listPlatformCapabilityKeys());
  for (const key of includedCapabilities) {
    if (!allowed.has(String(key))) {
      throw new HttpError(400, `Unknown capability in plan: ${key}`, {
        code: "UNKNOWN_FEATURE_KEY",
      });
    }
  }
  return includedCapabilities.map(String);
}

export async function createPlan({ payload, admin, req }) {
  await ensureDefaultPlansSeeded();
  const code = String(payload?.code || "").trim().toUpperCase();
  const name = String(payload?.name || "").trim();
  if (!code || code.length < 2) {
    throw new HttpError(400, "Plan code is required", { code: "VALIDATION_ERROR" });
  }
  if (!name) {
    throw new HttpError(400, "Plan name is required", { code: "VALIDATION_ERROR" });
  }
  const modulesAll = Boolean(payload?.modulesAll);
  const includedModules = validateModuleList(modulesAll, payload?.includedModules);
  const includedCapabilities = validateCapabilityList(payload?.includedCapabilities);

  const plan = await PlatformPlan.create({
    code,
    name,
    description: String(payload?.description || "").trim(),
    isActive: payload?.isActive !== false,
    modulesAll,
    includedModules,
    includedCapabilities,
    maxEmployeeSeats: Math.max(1, Number.parseInt(payload?.maxEmployeeSeats, 10) || 10),
    maxStorageMb: Math.max(0, Number.parseInt(payload?.maxStorageMb, 10) || 0),
    amount: Math.max(0, Number(payload?.amount) || 0),
    currency: String(payload?.currency || "INR").toUpperCase(),
    billingCycle: Object.values(PLAN_BILLING_CYCLES).includes(payload?.billingCycle)
      ? payload.billingCycle
      : PLAN_BILLING_CYCLES.NONE,
    trialDays: Math.max(0, Number.parseInt(payload?.trialDays, 10) || 0),
    sortOrder: Number.parseInt(payload?.sortOrder, 10) || 100,
    isSystem: false,
  });

  invalidatePlatformPlanCache(plan._id);
  invalidatePlatformPlanCache(plan.code);

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.PLAN_CREATED,
    targetType: "PlatformPlan",
    targetId: plan._id,
    outcome: "SUCCESS",
    metadata: { code: plan.code, modulesAll: plan.modulesAll },
    req,
  });

  return { plan: toPlanDto(plan, { companyCount: 0 }) };
}

export async function updatePlan({ planId, payload, admin, req }) {
  await ensureDefaultPlansSeeded();
  if (!mongoose.isValidObjectId(planId)) {
    throw new HttpError(404, "Plan not found", { code: "PLAN_NOT_FOUND" });
  }
  const plan = await PlatformPlan.findById(planId);
  if (!plan) throw new HttpError(404, "Plan not found", { code: "PLAN_NOT_FOUND" });

  const changes = {};
  if (payload?.name != null) {
    const name = String(payload.name).trim();
    if (!name) throw new HttpError(400, "Plan name is required", { code: "VALIDATION_ERROR" });
    if (name !== plan.name) {
      changes.name = { from: plan.name, to: name };
      plan.name = name;
    }
  }
  if (payload?.description != null) {
    plan.description = String(payload.description).trim();
    changes.description = true;
  }
  if (payload?.modulesAll != null || payload?.includedModules != null) {
    const modulesAll =
      payload.modulesAll != null ? Boolean(payload.modulesAll) : plan.modulesAll;
    const includedModules = validateModuleList(
      modulesAll,
      payload.includedModules != null ? payload.includedModules : plan.includedModules
    );
    plan.modulesAll = modulesAll;
    plan.includedModules = includedModules;
    changes.modules = true;
  }
  if (payload?.includedCapabilities != null) {
    plan.includedCapabilities = validateCapabilityList(payload.includedCapabilities);
    changes.capabilities = true;
  }
  if (payload?.maxEmployeeSeats != null) {
    plan.maxEmployeeSeats = Math.max(1, Number.parseInt(payload.maxEmployeeSeats, 10) || 1);
    changes.maxEmployeeSeats = plan.maxEmployeeSeats;
  }
  if (payload?.maxStorageMb != null) {
    plan.maxStorageMb = Math.max(0, Number.parseInt(payload.maxStorageMb, 10) || 0);
    changes.maxStorageMb = plan.maxStorageMb;
  }
  if (payload?.amount != null) {
    plan.amount = Math.max(0, Number(payload.amount) || 0);
    changes.amount = plan.amount;
  }
  if (payload?.currency != null) {
    plan.currency = String(payload.currency).toUpperCase();
  }
  if (payload?.billingCycle != null && Object.values(PLAN_BILLING_CYCLES).includes(payload.billingCycle)) {
    plan.billingCycle = payload.billingCycle;
  }
  if (payload?.trialDays != null) {
    plan.trialDays = Math.max(0, Number.parseInt(payload.trialDays, 10) || 0);
  }
  if (payload?.sortOrder != null) {
    plan.sortOrder = Number.parseInt(payload.sortOrder, 10) || plan.sortOrder;
  }

  let activationChange = null;
  if (payload?.isActive != null && Boolean(payload.isActive) !== plan.isActive) {
    if (payload.isActive === false && !payload.confirm && !payload?.confirmDeactivate) {
      throw new HttpError(400, "Confirmation is required to deactivate a plan", {
        code: "CONFIRMATION_REQUIRED",
      });
    }
    plan.isActive = Boolean(payload.isActive);
    activationChange = plan.isActive ? "activated" : "deactivated";
  }

  await plan.save();
  invalidatePlatformPlanCache(plan._id);
  invalidatePlatformPlanCache(plan.code);

  await recordPlatformAudit({
    actor: admin,
    action:
      activationChange === "deactivated"
        ? PLATFORM_AUDIT_ACTIONS.PLAN_DEACTIVATED
        : activationChange === "activated"
          ? PLATFORM_AUDIT_ACTIONS.PLAN_ACTIVATED
          : PLATFORM_AUDIT_ACTIONS.PLAN_UPDATED,
    targetType: "PlatformPlan",
    targetId: plan._id,
    outcome: "SUCCESS",
    metadata: { code: plan.code, changes, activationChange },
    req,
  });

  const companyCount = await Company.countDocuments({
    $or: [{ "subscription.planId": plan._id }, { "subscription.plan": plan.code }],
  });
  return { plan: toPlanDto(plan, { companyCount }) };
}

function pushSubscriptionHistory(company, entry) {
  if (!company.subscription) company.subscription = {};
  if (!Array.isArray(company.subscription.history)) company.subscription.history = [];
  company.subscription.history.push({
    ...entry,
    at: new Date(),
  });
  if (company.subscription.history.length > 100) {
    company.subscription.history = company.subscription.history.slice(-100);
  }
}

export async function getCompanySubscription(companyId) {
  await ensureDefaultPlansSeeded();
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId)
    .select("companyName slug status subscription")
    .lean();
  if (!company) throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });

  const plan = await resolvePlanRecordForCompany(company);
  const invoices = await PlatformInvoice.find({ companyId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return {
    company: {
      id: String(company._id),
      companyName: company.companyName,
      slug: company.slug,
      status: company.status,
    },
    subscription: serializeSubscription(company.subscription, plan),
    plan: toPlanDto(plan),
    history: Array.isArray(company.subscription?.history)
      ? [...company.subscription.history].reverse().slice(0, 40)
      : [],
    invoices: invoices.map(toInvoiceDto),
  };
}

function serializeSubscription(sub = {}, plan = null) {
  return {
    planCode: sub.plan || plan?.code || "TRIAL",
    planId: sub.planId ? String(sub.planId) : plan?._id ? String(plan._id) : null,
    status: sub.status || "TRIAL",
    maxEmployeeSeats: sub.maxEmployeeSeats ?? plan?.maxEmployeeSeats ?? null,
    seatUsage: sub.seatUsage ?? 0,
    maxStorageMb: plan?.maxStorageMb ?? 0,
    storageUsageAvailable: false,
    storageUsageNote:
      "Exact storage usage is measured at upload time when GridFS is available; it is not pre-aggregated here.",
    startDate: sub.startDate || null,
    endDate: sub.endDate || null,
    trialEndsAt: sub.trialEndsAt || null,
    renewalDate: sub.renewalDate || null,
    billingStatus: sub.billingStatus || "NONE",
    billingCycle: sub.billingCycle || plan?.billingCycle || "NONE",
    amount: sub.amount ?? plan?.amount ?? 0,
    currency: sub.currency || plan?.currency || "INR",
  };
}

export async function updateCompanySubscription({
  companyId,
  payload,
  confirm,
  admin,
  req,
}) {
  await ensureDefaultPlansSeeded();
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId);
  if (!company) throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  if (!company.subscription) company.subscription = {};

  const previous = {
    plan: company.subscription.plan,
    planId: company.subscription.planId,
    status: company.subscription.status,
  };

  let plan = null;
  if (payload?.planId || payload?.planCode) {
    if (payload.planId) {
      if (!mongoose.isValidObjectId(payload.planId)) {
        throw new HttpError(400, "Invalid plan id", { code: "VALIDATION_ERROR" });
      }
      plan = await PlatformPlan.findById(payload.planId);
    } else {
      plan = await PlatformPlan.findOne({
        code: String(payload.planCode).trim().toUpperCase(),
      });
    }
    if (!plan) throw new HttpError(404, "Plan not found", { code: "PLAN_NOT_FOUND" });
    // Deactivated plans cannot be newly assigned
    const alreadyOnPlan =
      String(company.subscription.planId || "") === String(plan._id) ||
      String(company.subscription.plan || "").toUpperCase() === plan.code;
    if (!plan.isActive && !alreadyOnPlan) {
      throw new HttpError(400, "Cannot assign a deactivated plan", {
        code: "PLAN_INACTIVE",
      });
    }
    if (
      !alreadyOnPlan &&
      !confirm &&
      (previous.plan !== plan.code || String(previous.planId || "") !== String(plan._id))
    ) {
      throw new HttpError(400, "Confirmation is required to change subscription plan", {
        code: "CONFIRMATION_REQUIRED",
        from: previous.plan,
        to: plan.code,
      });
    }
    company.subscription.planId = plan._id;
    company.subscription.plan = plan.code;
    company.subscription.maxEmployeeSeats =
      payload.maxEmployeeSeats != null
        ? Math.max(1, Number.parseInt(payload.maxEmployeeSeats, 10) || 1)
        : plan.maxEmployeeSeats;
    company.subscription.amount =
      payload.amount != null ? Math.max(0, Number(payload.amount) || 0) : plan.amount;
    company.subscription.currency = payload.currency || plan.currency;
    company.subscription.billingCycle = payload.billingCycle || plan.billingCycle;
  }

  if (payload?.status != null) {
    const allowed = ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"];
    if (!allowed.includes(payload.status)) {
      throw new HttpError(400, "Invalid subscription status", { code: "VALIDATION_ERROR" });
    }
    if (
      (payload.status === "SUSPENDED" || payload.status === "CANCELLED") &&
      !confirm
    ) {
      throw new HttpError(400, "Confirmation is required for this subscription status change", {
        code: "CONFIRMATION_REQUIRED",
      });
    }
    company.subscription.status = payload.status;
  }

  if (payload?.startDate !== undefined) {
    company.subscription.startDate = payload.startDate ? new Date(payload.startDate) : null;
  }
  if (payload?.endDate !== undefined) {
    company.subscription.endDate = payload.endDate ? new Date(payload.endDate) : null;
  }
  if (payload?.trialEndsAt !== undefined) {
    company.subscription.trialEndsAt = payload.trialEndsAt
      ? new Date(payload.trialEndsAt)
      : null;
  }
  if (payload?.renewalDate !== undefined) {
    company.subscription.renewalDate = payload.renewalDate
      ? new Date(payload.renewalDate)
      : null;
  }
  if (payload?.billingStatus != null) {
    company.subscription.billingStatus = payload.billingStatus;
  }
  if (payload?.maxEmployeeSeats != null && !plan) {
    company.subscription.maxEmployeeSeats = Math.max(
      1,
      Number.parseInt(payload.maxEmployeeSeats, 10) || 1
    );
  }

  const historyAction =
    company.subscription.status === "SUSPENDED" && previous.status !== "SUSPENDED"
      ? "SUSPENDED"
      : company.subscription.status === "ACTIVE" && previous.status === "SUSPENDED"
        ? "REACTIVATED"
        : "CHANGED";

  pushSubscriptionHistory(company, {
    action: historyAction,
    from: previous,
    to: {
      plan: company.subscription.plan,
      planId: company.subscription.planId,
      status: company.subscription.status,
    },
    byPlatformAdminId: admin?._id || null,
    byEmail: admin?.email || "",
    note: String(payload?.note || "").slice(0, 200),
  });

  await company.save();

  try {
    const { invalidateCompanyMetadataCache } = await import("../config/db.js");
    invalidateCompanyMetadataCache(company._id);
  } catch {
    /* cache invalidation is best-effort */
  }

  await recordPlatformAudit({
    actor: admin,
    action:
      historyAction === "SUSPENDED"
        ? PLATFORM_AUDIT_ACTIONS.SUBSCRIPTION_SUSPENDED
        : historyAction === "REACTIVATED"
          ? PLATFORM_AUDIT_ACTIONS.SUBSCRIPTION_REACTIVATED
          : PLATFORM_AUDIT_ACTIONS.SUBSCRIPTION_CHANGED,
    targetType: "Company",
    targetId: company._id,
    outcome: "SUCCESS",
    metadata: {
      from: previous,
      to: {
        plan: company.subscription.plan,
        status: company.subscription.status,
      },
    },
    req,
  });

  return getCompanySubscription(companyId);
}

function toInvoiceDto(inv) {
  if (!inv) return null;
  return {
    id: String(inv._id),
    companyId: String(inv.companyId),
    planId: inv.planId ? String(inv.planId) : null,
    planCode: inv.planCode || "",
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    paymentStatus: inv.paymentStatus,
    amount: inv.amount,
    currency: inv.currency,
    billingCycle: inv.billingCycle,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    dueDate: inv.dueDate,
    paidAt: inv.paidAt,
    notes: inv.notes || "",
    payment: {
      method: inv.payment?.method || "",
      reference: inv.payment?.reference || "",
      recordedByEmail: inv.payment?.recordedByEmail || "",
      recordedAt: inv.payment?.recordedAt || null,
      note: inv.payment?.note || "",
      // Never expose as gateway-confirmed
      gatewayConfirmed: false,
    },
    createdAt: inv.createdAt,
  };
}

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const PlatformInvoiceCounter = (await import("../models/PlatformInvoiceCounter.js")).default;
  const counter = await PlatformInvoiceCounter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  return `INV-${year}-${String(counter.seq).padStart(5, "0")}`;
}

export async function createInvoice({ companyId, payload, admin, req }) {
  if (!mongoose.isValidObjectId(companyId)) {
    throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });
  }
  const company = await Company.findById(companyId).select("subscription").lean();
  if (!company) throw new HttpError(404, "Company not found", { code: "COMPANY_NOT_FOUND" });

  const amount = Number(payload?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new HttpError(400, "Valid amount is required", { code: "VALIDATION_ERROR" });
  }

  const invoice = await PlatformInvoice.create({
    companyId,
    planId: company.subscription?.planId || null,
    planCode: company.subscription?.plan || "",
    invoiceNumber: await nextInvoiceNumber(),
    status: INVOICE_STATUSES.DUE,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    amount,
    currency: String(payload?.currency || company.subscription?.currency || "INR").toUpperCase(),
    billingCycle: payload?.billingCycle || company.subscription?.billingCycle || "NONE",
    periodStart: payload?.periodStart ? new Date(payload.periodStart) : null,
    periodEnd: payload?.periodEnd ? new Date(payload.periodEnd) : null,
    dueDate: payload?.dueDate ? new Date(payload.dueDate) : null,
    notes: String(payload?.notes || "").slice(0, 500),
    createdByPlatformAdminId: admin?._id || null,
  });

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.INVOICE_CREATED,
    targetType: "PlatformInvoice",
    targetId: invoice._id,
    outcome: "SUCCESS",
    metadata: {
      companyId: String(companyId),
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      currency: invoice.currency,
    },
    req,
  });

  return { invoice: toInvoiceDto(invoice) };
}

/**
 * Manual payment recording only — does not claim payment-provider confirmation.
 */
export async function recordInvoicePayment({ invoiceId, payload, admin, req }) {
  if (!mongoose.isValidObjectId(invoiceId)) {
    throw new HttpError(404, "Invoice not found", { code: "INVOICE_NOT_FOUND" });
  }
  if (!payload?.confirm) {
    throw new HttpError(400, "Confirmation is required to record a manual payment", {
      code: "CONFIRMATION_REQUIRED",
    });
  }

  const payment = {
    method: String(payload?.method || "MANUAL").slice(0, 80),
    reference: String(payload?.reference || "").slice(0, 120),
    recordedByPlatformAdminId: admin?._id || null,
    recordedByEmail: admin?.email || "",
    recordedAt: new Date(),
    note: String(payload?.note || "").slice(0, 300),
  };

  const invoice = await PlatformInvoice.findOneAndUpdate(
    {
      _id: invoiceId,
      status: { $nin: [INVOICE_STATUSES.VOID, INVOICE_STATUSES.CANCELLED, INVOICE_STATUSES.PAID] },
      paymentStatus: PAYMENT_STATUSES.UNPAID,
    },
    {
      $set: {
        status: INVOICE_STATUSES.PAID,
        paymentStatus: PAYMENT_STATUSES.MANUAL_RECORDED,
        paidAt: new Date(),
        payment,
      },
    },
    { returnDocument: "after" }
  );

  if (!invoice) {
    const existing = await PlatformInvoice.findById(invoiceId).lean();
    if (!existing) throw new HttpError(404, "Invoice not found", { code: "INVOICE_NOT_FOUND" });
    if (existing.status === INVOICE_STATUSES.PAID) {
      throw new HttpError(409, "Invoice payment already recorded", {
        code: "INVOICE_ALREADY_PAID",
      });
    }
    throw new HttpError(400, "Cannot record payment on a void/cancelled invoice", {
      code: "INVOICE_NOT_PAYABLE",
    });
  }

  await Company.updateOne(
    { _id: invoice.companyId },
    { $set: { "subscription.billingStatus": "CURRENT" } }
  );

  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.INVOICE_PAYMENT_RECORDED,
    targetType: "PlatformInvoice",
    targetId: invoice._id,
    outcome: "SUCCESS",
    metadata: {
      companyId: String(invoice.companyId),
      invoiceNumber: invoice.invoiceNumber,
      paymentStatus: invoice.paymentStatus,
      gatewayConfirmed: false,
    },
    req,
  });

  return { invoice: toInvoiceDto(invoice) };
}

export async function voidInvoice({ invoiceId, confirm, admin, req }) {
  if (!confirm) {
    throw new HttpError(400, "Confirmation is required to void an invoice", {
      code: "CONFIRMATION_REQUIRED",
    });
  }
  if (!mongoose.isValidObjectId(invoiceId)) {
    throw new HttpError(404, "Invoice not found", { code: "INVOICE_NOT_FOUND" });
  }
  const invoice = await PlatformInvoice.findOneAndUpdate(
    {
      _id: invoiceId,
      status: { $nin: [INVOICE_STATUSES.PAID, INVOICE_STATUSES.VOID, INVOICE_STATUSES.CANCELLED] },
    },
    { $set: { status: INVOICE_STATUSES.VOID } },
    { returnDocument: "after" }
  );
  if (!invoice) {
    const existing = await PlatformInvoice.findById(invoiceId).lean();
    if (!existing) throw new HttpError(404, "Invoice not found", { code: "INVOICE_NOT_FOUND" });
    if (existing.status === INVOICE_STATUSES.PAID) {
      throw new HttpError(400, "Paid invoices cannot be voided", { code: "INVOICE_PAID" });
    }
    throw new HttpError(400, "Invoice cannot be voided", { code: "INVOICE_NOT_VOIDABLE" });
  }
  await recordPlatformAudit({
    actor: admin,
    action: PLATFORM_AUDIT_ACTIONS.INVOICE_VOIDED,
    targetType: "PlatformInvoice",
    targetId: invoice._id,
    outcome: "SUCCESS",
    metadata: { invoiceNumber: invoice.invoiceNumber },
    req,
  });
  return { invoice: toInvoiceDto(invoice) };
}

export async function getPlansComparison() {
  const plans = await listPlans({ includeInactive: false });
  const moduleKeys = allModuleKeys();
  return {
    modules: moduleKeys,
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      amount: p.amount,
      currency: p.currency,
      billingCycle: p.billingCycle,
      maxEmployeeSeats: p.maxEmployeeSeats,
      maxStorageMb: p.maxStorageMb,
      modules: Object.fromEntries(
        moduleKeys.map((key) => [
          key,
          p.modulesAll || (p.includedModules || []).includes(key),
        ])
      ),
    })),
  };
}

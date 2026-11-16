import mongoose from "mongoose";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import PlatformInvoice from "../models/PlatformInvoice.js";
import PlatformPlan from "../models/PlatformPlan.js";
import PlatformAuditLog from "../models/PlatformAuditLog.js";
import PlatformSettings from "../models/PlatformSettings.js";
import { ensureDefaultPlansSeeded } from "./platformPlanService.js";

function fillDailySeries(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r.count]));
  const series = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: map.get(key) || 0 });
  }
  return series;
}

/**
 * Platform Insights — central metadata and safe aggregates only.
 * Never opens tenant databases for dashboard rendering.
 */
export async function getPlatformInsights() {
  await ensureDefaultPlansSeeded();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [
    totalCompanies,
    companiesByStatus,
    registrations,
    planGroups,
    subscriptionByStatus,
    upcomingRenewals,
    subscriptionChanges,
    invoiceByPayment,
    invoiceAmountByPayment,
    seatAgg,
    featureOverrides,
    recentFailures,
    settings,
    plans,
  ] = await Promise.all([
    Company.countDocuments({}),
    Company.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Company.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Company.aggregate([
      {
        $group: {
          _id: { $toUpper: { $ifNull: ["$subscription.plan", "UNKNOWN"] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    Company.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$subscription.status", "TRIAL"] },
          count: { $sum: 1 },
        },
      },
    ]),
    Company.find({
      "subscription.renewalDate": { $gte: now, $lte: fourteenDaysAhead },
    })
      .select("companyName slug subscription.plan subscription.renewalDate subscription.status")
      .sort({ "subscription.renewalDate": 1 })
      .limit(25)
      .lean(),
    PlatformAuditLog.aggregate([
      {
        $match: {
          action: {
            $in: [
              "SUBSCRIPTION_CHANGED",
              "SUBSCRIPTION_SUSPENDED",
              "SUBSCRIPTION_REACTIVATED",
            ],
          },
          timestamp: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PlatformInvoice.aggregate([
      { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
    ]),
    PlatformInvoice.aggregate([
      {
        $group: {
          _id: "$paymentStatus",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Company.aggregate([
      {
        $group: {
          _id: null,
          totalSeats: { $sum: { $ifNull: ["$subscription.maxEmployeeSeats", 0] } },
          usedSeats: { $sum: { $ifNull: ["$subscription.seatUsage", 0] } },
          companiesWithUsage: {
            $sum: {
              $cond: [{ $gt: [{ $ifNull: ["$subscription.seatUsage", -1] }, -1] }, 1, 0],
            },
          },
        },
      },
    ]),
    Company.aggregate([
      {
        $project: {
          overrideKeys: {
            $objectToArray: { $ifNull: ["$config.featureAccess.modules", {}] },
          },
        },
      },
      { $unwind: { path: "$overrideKeys", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: "$overrideKeys.k",
          companies: { $sum: 1 },
          disabled: {
            $sum: {
              $cond: [{ $eq: ["$overrideKeys.v", false] }, 1, 0],
            },
          },
        },
      },
      { $sort: { companies: -1 } },
      { $limit: 20 },
    ]),
    PlatformAuditLog.find({ outcome: { $in: ["FAILURE", "DENIED"] } })
      .select("action outcome targetType targetId timestamp actorEmail metadata")
      .sort({ timestamp: -1 })
      .limit(15)
      .lean(),
    PlatformSettings.findOne({ singletonKey: "default" }).lean(),
    PlatformPlan.find({}).select("code name isActive maxEmployeeSeats maxStorageMb").lean(),
  ]);

  const statusMap = Object.fromEntries(
    Object.values(COMPANY_STATUSES).map((s) => [s, 0])
  );
  for (const row of companiesByStatus) {
    if (row._id) statusMap[row._id] = row.count;
  }

  const subStatus = {
    TRIAL: 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    EXPIRED: 0,
    CANCELLED: 0,
  };
  for (const row of subscriptionByStatus) {
    const key = row._id && subStatus[row._id] !== undefined ? row._id : null;
    if (key) subStatus[key] = row.count;
  }

  const invoicePayment = {};
  for (const row of invoiceByPayment) {
    invoicePayment[row._id || "UNKNOWN"] = row.count;
  }
  const invoiceTotals = (invoiceAmountByPayment || []).map((row) => ({
    paymentStatus: row._id || "UNKNOWN",
    count: row.count,
    totalAmount: row.totalAmount || 0,
  }));

  const seats = seatAgg[0] || { totalSeats: 0, usedSeats: 0, companiesWithUsage: 0 };

  const unavailableMetrics = [
    {
      key: "employeeCounts",
      reason:
        "Per-tenant employee headcounts require opening tenant databases. Seat utilization uses central subscription.seatUsage instead.",
    },
    {
      key: "storageConsumption",
      reason:
        "Exact storage bytes are not pre-aggregated in the central database. Per-tenant GridFS totals are checked only at upload time when available.",
    },
    {
      key: "apiUsage",
      reason: "API request metering is not implemented; no invented request volumes are shown.",
    },
    {
      key: "apiResponseTimes",
      reason: "No response-time telemetry store exists; metrics are omitted rather than fabricated.",
    },
    {
      key: "cronExecution",
      reason:
        "Cron/scheduler run history is not centralized for platform insights (tenant workforce-scheduler and announcement publish-due remain separate).",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    companies: {
      total: totalCompanies,
      byStatus: statusMap,
      registrationsLast30Days: fillDailySeries(registrations, 30),
      growth: {
        last30Days: registrations.reduce((sum, r) => sum + r.count, 0),
        note: "New company documents created in the central database.",
      },
      byPlan: planGroups.map((r) => ({ plan: r._id || "UNKNOWN", count: r.count })),
    },
    subscriptions: {
      byStatus: subStatus,
      planDistribution: planGroups.map((r) => ({ plan: r._id || "UNKNOWN", count: r.count })),
      upcomingRenewals: upcomingRenewals.map((c) => ({
        id: String(c._id),
        companyName: c.companyName,
        slug: c.slug,
        plan: c.subscription?.plan || null,
        status: c.subscription?.status || null,
        renewalDate: c.subscription?.renewalDate || null,
      })),
      changesLast30Days: fillDailySeries(subscriptionChanges, 30),
      invoiceTotalsByPaymentStatus: invoiceTotals,
      invoiceCountsByPaymentStatus: invoicePayment,
    },
    usage: {
      seatUtilization: {
        available: true,
        allocatedSeats: seats.totalSeats || 0,
        usedSeats: seats.usedSeats || 0,
        companiesReportingUsage: seats.companiesWithUsage || 0,
        note: "Based on central subscription.seatUsage reservations, not live tenant employee scans.",
      },
      storageConsumption: {
        available: false,
        value: null,
        reason: "STORAGE_USAGE_UNAVAILABLE",
      },
      apiUsage: {
        available: false,
        value: null,
        reason: "API_USAGE_UNAVAILABLE",
      },
      moduleAdoption: {
        available: true,
        companyOverrides: featureOverrides.map((r) => ({
          moduleKey: r._id,
          companiesWithOverride: r.companies,
          explicitlyDisabled: r.disabled,
        })),
        note: "Adoption proxy from explicit company feature overrides in central metadata only.",
      },
      plansCatalog: plans.map((p) => ({
        code: p.code,
        name: p.name,
        isActive: p.isActive,
        maxEmployeeSeats: p.maxEmployeeSeats,
        maxStorageMb: p.maxStorageMb,
      })),
    },
    systemHealth: {
      backend: "ok",
      centralDb: mongoose.connection?.readyState === 1 ? "connected" : "degraded",
      maintenanceMode: Boolean(settings?.maintenance?.enabled),
      cronExecution: { available: false, reason: "CRON_STATUS_UNAVAILABLE" },
      backgroundScheduler: { available: false, reason: "SCHEDULER_STATUS_UNAVAILABLE" },
      apiResponseTimes: { available: false, reason: "RESPONSE_TIME_UNAVAILABLE" },
      recentOperationalFailures: recentFailures.map((row) => ({
        action: row.action,
        outcome: row.outcome,
        targetType: row.targetType,
        targetId: row.targetId,
        actorEmail: row.actorEmail,
        timestamp: row.timestamp,
        // metadata already sanitized at write time; still omit deep blobs
        summary: row.metadata?.code || row.metadata?.message || null,
      })),
      timestamp: now.toISOString(),
    },
    unavailableMetrics,
  };
}

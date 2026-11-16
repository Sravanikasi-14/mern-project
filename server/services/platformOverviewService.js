import mongoose from "mongoose";
import Company, { COMPANY_STATUSES } from "../models/Company.js";

/**
 * Overview metrics from the central database only.
 * Does not open tenant databases or invent employee/usage counts.
 */
export async function getPlatformOverview() {
  const [
    total,
    active,
    suspended,
    trial,
    cancelled,
    recent,
    planGroups,
    provisionGroups,
  ] = await Promise.all([
    Company.countDocuments({}),
    Company.countDocuments({ status: COMPANY_STATUSES.ACTIVE }),
    Company.countDocuments({ status: COMPANY_STATUSES.SUSPENDED }),
    Company.countDocuments({ status: COMPANY_STATUSES.TRIAL }),
    Company.countDocuments({ status: COMPANY_STATUSES.CANCELLED }),
    Company.find({})
      .select("companyName slug status subscription.plan platformProvisioning createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    Company.aggregate([
      {
        $group: {
          _id: { $ifNull: ["$subscription.plan", "UNKNOWN"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    Company.aggregate([
      {
        $group: {
          _id: {
            $ifNull: ["$platformProvisioning.lastStatus", "UNKNOWN"],
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const provisionByStatus = {
    SUCCESS: 0,
    FAILED: 0,
    PENDING: 0,
    UNKNOWN: 0,
  };
  for (const row of provisionGroups) {
    const key = row._id && provisionByStatus[row._id] !== undefined ? row._id : "UNKNOWN";
    provisionByStatus[key] = row.count;
  }

  // Also treat stamped tenantIndexSchemaVersion as provisioned when status UNKNOWN
  const stampedProvisioned = await Company.countDocuments({
    tenantIndexSchemaVersion: { $ne: null },
    $or: [
      { "platformProvisioning.lastStatus": { $exists: false } },
      { "platformProvisioning.lastStatus": "UNKNOWN" },
    ],
  });

  return {
    companies: {
      total,
      byStatus: {
        ACTIVE: active,
        SUSPENDED: suspended,
        TRIAL: trial,
        CANCELLED: cancelled,
      },
    },
    subscriptionSummary: {
      byPlan: planGroups.map((row) => ({
        plan: row._id || "UNKNOWN",
        count: row.count,
      })),
      note: "Derived from Company.subscription.plan in the central database only.",
    },
    provisioning: {
      byStatus: provisionByStatus,
      stampedWithoutPlatformStatus: stampedProvisioned,
      note: "Based on central platformProvisioning fields and tenantIndexSchemaVersion stamps. No live tenant DB probes.",
    },
    recentlyRegistered: recent.map((c) => ({
      id: String(c._id),
      companyName: c.companyName,
      slug: c.slug,
      status: c.status,
      plan: c.subscription?.plan || "TRIAL",
      provisioningStatus: c.platformProvisioning?.lastStatus || "UNKNOWN",
      createdAt: c.createdAt,
    })),
    unavailableMetrics: [
      {
        key: "employeeCounts",
        reason: "Employee totals require tenant database access and are deferred to a later insights batch.",
      },
      {
        key: "storageUsage",
        reason: "Storage consumption is not pre-aggregated in the central database.",
      },
      {
        key: "apiUsage",
        reason: "API usage metering is not implemented.",
      },
    ],
    operationalStatus: {
      api: "ok",
      centralDb: mongoose.connection?.readyState === 1 ? "connected" : "degraded",
      timestamp: new Date().toISOString(),
    },
  };
}

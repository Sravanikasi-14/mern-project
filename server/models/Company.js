import mongoose from "mongoose";

export const COMPANY_STATUSES = Object.freeze({
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
});

export const LOGIN_ALLOWED_STATUSES = new Set([
  COMPANY_STATUSES.TRIAL,
  COMPANY_STATUSES.ACTIVE,
]);

const companySchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    databaseName: { type: String, required: true, trim: true },
    migrationVersion: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(COMPANY_STATUSES),
      required: true,
      default: COMPANY_STATUSES.TRIAL,
    },
    subscription: {
      /** Legacy / display code — kept in sync with PlatformPlan.code when assigned. */
      plan: { type: String, default: "TRIAL" },
      /** Reference to centrally managed PlatformPlan. */
      planId: { type: mongoose.Schema.Types.ObjectId, ref: "PlatformPlan", default: null },
      maxEmployeeSeats: { type: Number, default: 10 },
      /**
       * Reserved/used employee seats (central counter for concurrent-safe enforcement).
       * Never decreased by plan downgrade; new provisioning blocked when seatUsage >= maxEmployeeSeats.
       */
      seatUsage: { type: Number, default: 0, min: 0 },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      trialEndsAt: { type: Date, default: null },
      renewalDate: { type: Date, default: null },
      /**
       * Subscription lifecycle (independent of company ACTIVE/SUSPENDED).
       * SUSPENDED subscription does not delete tenant data.
       */
      status: {
        type: String,
        enum: ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "CANCELLED"],
        default: "TRIAL",
      },
      billingStatus: {
        type: String,
        enum: ["NONE", "CURRENT", "PAST_DUE", "MANUAL", "SUSPENDED"],
        default: "NONE",
      },
      billingCycle: {
        type: String,
        enum: ["NONE", "MONTHLY", "YEARLY"],
        default: "NONE",
      },
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
      history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    branding: {
      displayName: { type: String, default: "" },
      /** Opaque storage key / cache-busting token — never a public CDN URL. */
      logoUrl: { type: String, default: "" },
      logoMimeType: { type: String, default: "" },
      /**
       * Persistent logo bytes (required on serverless where /tmp is ephemeral).
       * Excluded from default queries — stream via GET /auth/company-logo only.
       */
      logoData: { type: Buffer, default: undefined, select: false },
      primaryColor: { type: String, default: "#4338ca" },
    },
    config: {
      timezone: { type: String, default: "Asia/Kolkata" },
      currencyCode: { type: String, default: "INR" },
      enabledModules: { type: [String], default: [] },
      /**
       * Platform Admin Batch 2 — company feature overrides.
       * Missing key = inherit global. Explicit false cannot enable a globally disabled module.
       * Shape: { modules: { [moduleKey]: boolean }, capabilities: { [capabilityKey]: boolean } }
       */
      featureAccess: {
        modules: { type: mongoose.Schema.Types.Mixed, default: {} },
        capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
      /**
       * Organization Explorer (employee org chart views).
       * Missing values resolve to defaults at read time — no migration required.
       */
      organizationExplorer: {
        enabledViews: {
          type: [String],
          default: () => ["reporting", "teams", "projects", "departments"],
        },
        defaultView: {
          type: String,
          default: "reporting",
        },
        /** Locked false until a Project lifecycle model exists. */
        allowCompletedProjectsFilter: {
          type: Boolean,
          default: false,
        },
      },
      /**
       * Phase A4 — authorization migration mode for this tenant.
       * Missing → LEGACY. Never accept mode from client request params.
       */
      authorizationMigration: {
        mode: {
          type: String,
          enum: ["LEGACY", "SHADOW", "ENFORCED"],
          default: "LEGACY",
        },
        updatedAt: { type: Date, default: null },
        updatedByUserId: { type: String, default: "" },
        previousMode: { type: String, default: null },
        history: {
          type: [
            {
              from: { type: String },
              to: { type: String },
              at: { type: Date },
              byUserId: { type: String, default: "" },
              reason: { type: String, default: "" },
            },
          ],
          default: [],
        },
      },
      /**
       * CA4-C — HR Admin access enforcement for this tenant.
       * Missing / OFF → legacy unrestricted HR_ADMIN (tenant-wide via requireRole only).
       * ENFORCED → require User.hrAccess permissions + employee scope on HR operational APIs.
       * Never accept mode from non-Company-Admin clients.
       */
      hrAccessEnforcement: {
        mode: {
          type: String,
          enum: ["OFF", "ENFORCED"],
          default: "OFF",
        },
        updatedAt: { type: Date, default: null },
        updatedByUserId: { type: String, default: "" },
        previousMode: { type: String, default: null },
        history: {
          type: [
            {
              from: { type: String },
              to: { type: String },
              at: { type: Date },
              byUserId: { type: String, default: "" },
              reason: { type: String, default: "" },
            },
          ],
          default: [],
        },
      },
      /**
       * Workforce Task Scheduling Engine run lock + last-run telemetry.
       * Feature enablement remains env-driven (WORKFORCE_SCHEDULER_*); this stores
       * concurrency locks only — no separate Mongo collection.
       */
      workforceScheduler: {
        lockUntil: { type: Date, default: null },
        lockToken: { type: String, default: "" },
        lastRunAt: { type: Date, default: null },
        lastRunSummary: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    },
    primaryContact: {
      fullName: { type: String, default: "" },
      email: { type: String, default: "" },
      phoneNumber: { type: String, default: "" },
    },
    /**
     * Offer letter letterhead (authoritative for standard HRMS offer template).
     * Do not reuse geofence officeAddress from HR policy.
     */
    letterhead: {
      address: { type: String, default: "" },
      website: { type: String, default: "" },
      signatoryName: { type: String, default: "" },
      signatoryTitle: { type: String, default: "" },
      /**
       * HR electronic signature embedded on issued offers (required before send).
       * Bytes are excluded from default queries — stream via GET /settings/company/signature only.
       */
      signatureMethod: { type: String, enum: ["", "DRAW", "UPLOAD", "TYPE"], default: "" },
      signatureMimeType: { type: String, default: "" },
      signatureUpdatedAt: { type: Date, default: null },
      signatureTypedText: { type: String, default: "" },
      signatureData: { type: Buffer, default: undefined, select: false },
    },
    /**
     * Outbound mail via Nodemailer (Gmail app password or custom SMTP).
     * App password is stored encrypted — never returned to the client.
     */
    emailSettings: {
      fromName: { type: String, default: "" },
      fromEmail: { type: String, default: "" },
      smtpHost: { type: String, default: "smtp.gmail.com" },
      smtpPort: { type: Number, default: 587 },
      smtpSecure: { type: Boolean, default: false },
      // F84 — never selected by default; email modules must +select explicitly.
      appPasswordEncrypted: { type: String, default: "", select: false },
      isConfigured: { type: Boolean, default: false },
      lastVerifiedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    schemaVersion: { type: Number, default: 1 },
    /**
     * F43 — stamped only after tenant index provision verifies all required indexes
     * for TENANT_INDEX_SCHEMA_VERSION (see tenantIndexInventory.js).
     */
    tenantIndexSchemaVersion: { type: Number, default: null },
    tenantIndexProvisionedAt: { type: Date, default: null },
    /**
     * Platform Admin Batch 1 — operational provisioning status (safe messages only).
     * Does not store tenant HR data.
     */
    platformProvisioning: {
      lastAttemptAt: { type: Date, default: null },
      lastStatus: {
        type: String,
        enum: ["PENDING", "SUCCESS", "FAILED", "UNKNOWN"],
        default: "UNKNOWN",
      },
      lastMessage: { type: String, default: "" },
      fullyProvisioned: { type: Boolean, default: false },
    },
    /** Compact lifecycle trail for Platform Admin company detail (also audited centrally). */
    lifecycleHistory: {
      type: [
        {
          action: { type: String, required: true },
          at: { type: Date, default: Date.now },
          byPlatformAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
          note: { type: String, default: "" },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "companies",
  }
);

companySchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.databaseName;
    if (ret.emailSettings) {
      delete ret.emailSettings.appPasswordEncrypted;
    }
    if (ret.letterhead) {
      delete ret.letterhead.signatureData;
    }
    if (ret.branding) {
      delete ret.branding.logoData;
    }
    return ret;
  },
});

/**
 * F49 — Invalidate auth company metadata cache when company rows change
 * (status, databaseName, config, etc.). Lazy-import avoids circular deps with db.js.
 */
function invalidateCompanyAuthCache(companyId) {
  if (companyId == null) return;
  import("../utils/companyMetadataCache.js")
    .then((mod) => mod.invalidateCompanyMetadataCache(companyId))
    .catch(() => {});
}

companySchema.post("save", function companyCacheInvalidateOnSave(doc) {
  invalidateCompanyAuthCache(doc?._id);
});

companySchema.post(["findOneAndUpdate", "updateOne", "deleteOne"], function companyCacheInvalidateOnQuery() {
  const filter = typeof this.getFilter === "function" ? this.getFilter() : null;
  if (filter?._id) {
    invalidateCompanyAuthCache(filter._id);
  }
});

export default mongoose.models.Company ||
  mongoose.model("Company", companySchema);

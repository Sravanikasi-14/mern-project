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
      plan: { type: String, default: "TRIAL" },
      maxEmployeeSeats: { type: Number, default: 10 },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
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
      appPasswordEncrypted: { type: String, default: "" },
      isConfigured: { type: Boolean, default: false },
      lastVerifiedAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    schemaVersion: { type: Number, default: 1 },
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

export default mongoose.models.Company ||
  mongoose.model("Company", companySchema);

import mongoose from "mongoose";

/**
 * Singleton central platform settings.
 * modules/capabilities maps: { [key]: { enabled: boolean } }
 * Batch 4 adds general / security / maintenance configuration.
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, required: true, default: "default", unique: true },
    modules: { type: mongoose.Schema.Types.Mixed, default: {} },
    capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
    general: {
      platformName: { type: String, default: "HRMS Platform" },
      supportEmail: { type: String, default: "" },
      defaultTimezone: { type: String, default: "Asia/Kolkata" },
      defaultCurrency: { type: String, default: "INR" },
      brandingTagline: { type: String, default: "" },
    },
    security: {
      /** Platform Admin MFA is always mandatory in code; this flag is informational/enforced. */
      platformMfaRequired: { type: Boolean, default: true },
      /** Platform Admin session TTL in hours (applied on new sessions). */
      platformSessionHours: { type: Number, default: 8, min: 1, max: 72 },
      /** Display-only mirrors of limiter defaults — runtime limiters still use env/code. */
      loginRateLimitPerWindow: { type: Number, default: 10, min: 1, max: 1000 },
      loginRateLimitWindowMinutes: { type: Number, default: 15, min: 1, max: 1440 },
      mfaRateLimitPerWindow: { type: Number, default: 20, min: 1, max: 1000 },
    },
    maintenance: {
      enabled: { type: Boolean, default: false },
      message: {
        type: String,
        default: "The platform is undergoing scheduled maintenance. Please try again later.",
      },
      plannedStart: { type: Date, default: null },
      plannedEnd: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
      updatedByEmail: { type: String, default: "" },
    },
    updatedByPlatformAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformAdmin",
      default: null,
    },
    updatedByEmail: { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "platform_settings",
  }
);

export default mongoose.models.PlatformSettings ||
  mongoose.model("PlatformSettings", platformSettingsSchema);

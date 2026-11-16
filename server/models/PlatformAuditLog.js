import mongoose from "mongoose";

export const PLATFORM_AUDIT_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  MFA_CHALLENGE_ISSUED: "MFA_CHALLENGE_ISSUED",
  MFA_VERIFY_SUCCESS: "MFA_VERIFY_SUCCESS",
  MFA_VERIFY_FAILURE: "MFA_VERIFY_FAILURE",
  MFA_SETUP_STARTED: "MFA_SETUP_STARTED",
  MFA_SETUP_COMPLETED: "MFA_SETUP_COMPLETED",
  MFA_RECOVERY_USED: "MFA_RECOVERY_USED",
  SESSION_REVOKED: "SESSION_REVOKED",
  COMPANY_CREATED: "COMPANY_CREATED",
  COMPANY_ACTIVATED: "COMPANY_ACTIVATED",
  COMPANY_SUSPENDED: "COMPANY_SUSPENDED",
  COMPANY_METADATA_UPDATED: "COMPANY_METADATA_UPDATED",
  COMPANY_PROVISIONED: "COMPANY_PROVISIONED",
  COMPANY_PROVISION_FAILED: "COMPANY_PROVISION_FAILED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  FEATURE_GLOBAL_UPDATED: "FEATURE_GLOBAL_UPDATED",
  FEATURE_COMPANY_UPDATED: "FEATURE_COMPANY_UPDATED",
  PLAN_CREATED: "PLAN_CREATED",
  PLAN_UPDATED: "PLAN_UPDATED",
  PLAN_ACTIVATED: "PLAN_ACTIVATED",
  PLAN_DEACTIVATED: "PLAN_DEACTIVATED",
  SUBSCRIPTION_CHANGED: "SUBSCRIPTION_CHANGED",
  SUBSCRIPTION_SUSPENDED: "SUBSCRIPTION_SUSPENDED",
  SUBSCRIPTION_REACTIVATED: "SUBSCRIPTION_REACTIVATED",
  INVOICE_CREATED: "INVOICE_CREATED",
  INVOICE_PAYMENT_RECORDED: "INVOICE_PAYMENT_RECORDED",
  INVOICE_VOIDED: "INVOICE_VOIDED",
});

/**
 * Central append-only platform audit trail.
 * Application APIs must only insert — never update/delete via controllers.
 */
const platformAuditLogSchema = new mongoose.Schema(
  {
    actorPlatformAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformAdmin",
      default: null,
      index: true,
    },
    actorEmail: { type: String, default: "" },
    action: {
      type: String,
      required: true,
      enum: Object.values(PLATFORM_AUDIT_ACTIONS),
      index: true,
    },
    targetType: { type: String, default: "Platform", index: true },
    targetId: { type: String, default: "" },
    outcome: {
      type: String,
      enum: ["SUCCESS", "FAILURE", "DENIED"],
      required: true,
      default: "SUCCESS",
    },
    /** Safe metadata only — no secrets, tokens, or tenant PII. */
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    collection: "platform_audit_logs",
  }
);

platformAuditLogSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"],
  function blockMutations() {
    throw new Error("PlatformAuditLog records are append-only");
  }
);

export default mongoose.models.PlatformAuditLog ||
  mongoose.model("PlatformAuditLog", platformAuditLogSchema);

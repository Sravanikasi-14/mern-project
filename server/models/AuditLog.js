import mongoose from "mongoose";

export const AUDIT_ACTIONS = Object.freeze({
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_UPDATED: "EMPLOYEE_UPDATED",
  EMPLOYEE_SELF_UPDATED: "EMPLOYEE_SELF_UPDATED",
  STATUS_CHANGED: "STATUS_CHANGED",
  COMPENSATION_REVISED: "COMPENSATION_REVISED",
  BANK_DETAILS_UPDATED: "BANK_DETAILS_UPDATED",
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  FNF_PROCESSED: "FNF_PROCESSED",
  INVITATION_SENT: "INVITATION_SENT",
  INVITATION_RESENT: "INVITATION_RESENT",
  ONBOARDING_COMPLETED: "ONBOARDING_COMPLETED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_DOWNLOADED: "DOCUMENT_DOWNLOADED",
  LEAVE_REQUESTED: "LEAVE_REQUESTED",
  LEAVE_APPROVED: "LEAVE_APPROVED",
  LEAVE_REJECTED: "LEAVE_REJECTED",
  LEAVE_TYPE_CHANGED: "LEAVE_TYPE_CHANGED",
  OFFER_LETTER_CREATED: "OFFER_LETTER_CREATED",
  OFFER_LETTER_UPDATED: "OFFER_LETTER_UPDATED",
  OFFER_LETTER_STATUS_CHANGED: "OFFER_LETTER_STATUS_CHANGED",
  OFFER_LETTER_LINKED: "OFFER_LETTER_LINKED",
});

export function createAuditLogSchema() {
  const auditLogSchema = new mongoose.Schema(
    {
      actorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      actorEmail: {
        type: String,
        required: true,
      },
      actorRole: {
        type: String,
        required: true,
      },
      action: {
        type: String,
        enum: Object.values(AUDIT_ACTIONS),
        required: true,
      },
      targetType: {
        type: String,
        default: "Employee",
      },
      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
      changes: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      ipAddress: {
        type: String,
        default: "",
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
    {
      timestamps: true,
      collection: "audit_logs",
    }
  );

  auditLogSchema.index({ targetId: 1, action: 1 });
  auditLogSchema.index({ actorUserId: 1 });
  auditLogSchema.index({ timestamp: -1 });

  return auditLogSchema;
}

export function getAuditLogModel(connection) {
  return (
    connection.models.AuditLog ||
    connection.model("AuditLog", createAuditLogSchema())
  );
}

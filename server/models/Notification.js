import mongoose from "mongoose";

export const NOTIFICATION_TYPES = Object.freeze({
  LEAVE: "LEAVE",
  TASK: "TASK",
  PAYROLL: "PAYROLL",
  SYSTEM: "SYSTEM",
  HANDOVER: "HANDOVER",
  MESSAGE: "MESSAGE",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  ATTENDANCE: "ATTENDANCE",
});

export function createNotificationSchema() {
  const notificationSchema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
      role: {
        // Role broadcast when userId is null (e.g. "HR_ADMIN").
        // When userId is set, role is unused for visibility (often null).
        // userId:null + role:null = intentional company-wide broadcast.
        type: String,
        index: true,
        default: null,
      },
      title: {
        type: String,
        required: true,
        trim: true,
      },
      message: {
        type: String,
        required: true,
        trim: true,
      },
      type: {
        type: String,
        enum: Object.values(NOTIFICATION_TYPES),
        default: NOTIFICATION_TYPES.SYSTEM,
      },
      link: {
        type: String,
        default: "",
        trim: true,
      },
      isRead: {
        type: Boolean,
        default: false,
        index: true,
      },
      readBy: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    {
      timestamps: true,
      collection: "notifications",
    }
  );

  notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
  notificationSchema.index({ role: 1, createdAt: -1 });
  // Personal inbox: equality on userId + sort createdAt (F32)
  notificationSchema.index(
    { userId: 1, createdAt: -1 },
    { name: "notifications_userId_createdAt" }
  );
  // Role / company-wide broadcasts (userId is null)
  notificationSchema.index(
    { userId: 1, role: 1, createdAt: -1 },
    { name: "notifications_userId_role_createdAt" }
  );
  // F42: event-level dedupe lookups (same key may appear on multiple recipient docs)
  notificationSchema.index(
    { "metadata.dedupeKey": 1 },
    { name: "notifications_metadata_dedupeKey", sparse: true }
  );

  return notificationSchema;
}

export function getNotificationModel(connection) {
  return (
    connection.models.Notification ||
    connection.model("Notification", createNotificationSchema())
  );
}

import mongoose from "mongoose";

export const NOTIFICATION_TYPES = Object.freeze({
  LEAVE: "LEAVE",
  TASK: "TASK",
  PAYROLL: "PAYROLL",
  SYSTEM: "SYSTEM",
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
        type: String, // "HR_ADMIN", "EMPLOYEE", or null for all
        index: true,
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

  return notificationSchema;
}

export function getNotificationModel(connection) {
  return (
    connection.models.Notification ||
    connection.model("Notification", createNotificationSchema())
  );
}

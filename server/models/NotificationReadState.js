import mongoose from "mongoose";

/**
 * Per-user notification read markers (tenant DB).
 * Replaces unbounded User.preferences.readNotificationIds growth.
 * notificationKey is the string id used by the notifications API
 * (ObjectId hex, or leave/task underlying id without prefix).
 */
export function createNotificationReadStateSchema() {
  const schema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      notificationKey: {
        type: String,
        required: true,
        trim: true,
        maxlength: 128,
      },
      readAt: {
        type: Date,
        default: Date.now,
        required: true,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "notification_read_states",
    }
  );

  schema.index(
    { userId: 1, notificationKey: 1 },
    { unique: true, name: "uniq_notification_read_user_key" }
  );
  schema.index({ userId: 1, readAt: -1 });

  return schema;
}

export function getNotificationReadStateModel(connection) {
  return (
    connection.models.NotificationReadState ||
    connection.model("NotificationReadState", createNotificationReadStateSchema())
  );
}

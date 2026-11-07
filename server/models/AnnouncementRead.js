import mongoose from "mongoose";

export function createAnnouncementReadSchema() {
  const schema = new mongoose.Schema(
    {
      announcementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Announcement",
        required: true,
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      readAt: {
        type: Date,
        default: Date.now,
      },
    },
    { timestamps: true, collection: "announcementReads" }
  );

  schema.index({ announcementId: 1, userId: 1 }, { unique: true });
  schema.index({ userId: 1, readAt: -1 });

  return schema;
}

export function getAnnouncementReadModel(connection) {
  return (
    connection.models.AnnouncementRead ||
    connection.model("AnnouncementRead", createAnnouncementReadSchema())
  );
}

import mongoose from "mongoose";

export const ANNOUNCEMENT_PRIORITIES = Object.freeze({
  NORMAL: "NORMAL",
  IMPORTANT: "IMPORTANT",
  URGENT: "URGENT",
});

export const ANNOUNCEMENT_AUDIENCES = Object.freeze({
  COMPANY: "COMPANY",
  DEPARTMENTS: "DEPARTMENTS",
});

export const ANNOUNCEMENT_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  WITHDRAWN: "WITHDRAWN",
});

export const ANNOUNCEMENT_TITLE_MAX = 160;
export const ANNOUNCEMENT_BODY_MAX = 8000;

export function createAnnouncementSchema() {
  const schema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
        maxlength: ANNOUNCEMENT_TITLE_MAX,
      },
      body: {
        type: String,
        required: true,
        trim: true,
        maxlength: ANNOUNCEMENT_BODY_MAX,
      },
      priority: {
        type: String,
        enum: Object.values(ANNOUNCEMENT_PRIORITIES),
        required: true,
        default: ANNOUNCEMENT_PRIORITIES.NORMAL,
      },
      audience: {
        type: String,
        enum: Object.values(ANNOUNCEMENT_AUDIENCES),
        required: true,
      },
      departmentIds: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
        default: [],
      },
      publishedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      status: {
        type: String,
        enum: Object.values(ANNOUNCEMENT_STATUSES),
        required: true,
        default: ANNOUNCEMENT_STATUSES.DRAFT,
      },
      scheduledAt: { type: Date, default: null },
      publishedAt: { type: Date, default: null },
      editedAt: { type: Date, default: null },
      withdrawnAt: { type: Date, default: null },
      notifiedAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "announcements" }
  );

  schema.index({ status: 1, publishedAt: -1, createdAt: -1 });
  schema.index({ status: 1, scheduledAt: 1 });
  schema.index({ audience: 1, status: 1, departmentIds: 1 });

  return schema;
}

export function getAnnouncementModel(connection) {
  return connection.models.Announcement || connection.model("Announcement", createAnnouncementSchema());
}

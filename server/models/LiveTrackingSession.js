import mongoose from "mongoose";

export const TRACKING_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  STOPPED: "STOPPED",
  EXPIRED: "EXPIRED",
});

const BreadcrumbSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
    accuracy: {
      type: Number,
      min: 0,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

export function createLiveTrackingSessionSchema() {
  const sessionSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(TRACKING_STATUSES),
        default: TRACKING_STATUSES.ACTIVE,
        required: true,
        index: true,
      },
      startedAt: {
        type: Date,
        default: Date.now,
        required: true,
      },
      expiresAt: {
        type: Date,
        required: true,
        index: true,
      },
      stoppedAt: {
        type: Date,
        default: null,
      },
      lastLocation: {
        type: BreadcrumbSchema,
        default: null,
      },
      breadcrumbs: {
        type: [BreadcrumbSchema],
        default: [],
      },
      deviceInfo: {
        userAgent: { type: String, default: "" },
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "live_tracking_sessions",
    }
  );

  sessionSchema.index({ employeeId: 1, status: 1 });
  sessionSchema.index({ status: 1, expiresAt: 1 });
  sessionSchema.index({ employeeId: 1, createdAt: -1 });

  return sessionSchema;
}

export function getLiveTrackingSessionModel(connection) {
  return (
    connection.models.LiveTrackingSession ||
    connection.model("LiveTrackingSession", createLiveTrackingSessionSchema())
  );
}

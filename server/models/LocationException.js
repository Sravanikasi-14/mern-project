import mongoose from "mongoose";

export const LOCATION_EXCEPTION_TYPES = Object.freeze({
  OUTSIDE_GEOFENCE: "OUTSIDE_GEOFENCE",
  LOW_ACCURACY: "LOW_ACCURACY",
  GPS_UNAVAILABLE: "GPS_UNAVAILABLE",
  RETURNED_INSIDE: "RETURNED_INSIDE",
  PUNCH_OUTSIDE: "PUNCH_OUTSIDE",
});

export const LOCATION_EXCEPTION_STATUSES = Object.freeze({
  OPEN: "OPEN",
  REVIEWED: "REVIEWED",
  REGULARIZED: "REGULARIZED",
  DISMISSED: "DISMISSED",
});

export function createLocationExceptionSchema() {
  const schema = new mongoose.Schema(
    {
      companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        index: true,
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      attendanceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Attendance",
        default: null,
        index: true,
      },
      sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
      },
      workDate: {
        type: String,
        required: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
        index: true,
      },
      sessionType: {
        type: String,
        enum: ["OFFICE", "REMOTE"],
        default: "OFFICE",
      },
      type: {
        type: String,
        enum: Object.values(LOCATION_EXCEPTION_TYPES),
        required: true,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(LOCATION_EXCEPTION_STATUSES),
        default: LOCATION_EXCEPTION_STATUSES.OPEN,
        index: true,
      },
      occurredAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
      returnedAt: {
        type: Date,
        default: null,
      },
      location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        accuracy: { type: Number, default: null },
        address: { type: String, default: "", trim: true },
      },
      permittedLocation: {
        label: { type: String, default: "", trim: true },
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        radiusMeters: { type: Number, default: null },
      },
      distanceMeters: { type: Number, default: null },
      message: { type: String, default: "", trim: true, maxlength: 500 },
      /** Dedup key for continuous out-of-radius streaks. */
      dedupeKey: { type: String, default: "", index: true },
      review: {
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reviewedAt: { type: Date, default: null },
        remarks: { type: String, default: "", trim: true, maxlength: 1000 },
      },
      schemaVersion: { type: Number, default: 1 },
    },
    {
      timestamps: true,
      collection: "location_exceptions",
    }
  );

  schema.index({ employeeId: 1, workDate: 1, type: 1, status: 1 });
  schema.index({ status: 1, createdAt: -1 });

  return schema;
}

export function getLocationExceptionModel(connection) {
  return (
    connection.models.LocationException ||
    connection.model("LocationException", createLocationExceptionSchema())
  );
}

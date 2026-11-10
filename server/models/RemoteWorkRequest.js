import mongoose from "mongoose";

export const REMOTE_WORK_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

export function createRemoteWorkRequestSchema() {
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
      requestedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      /** Company-timezone YYYY-MM-DD the remote session applies to. */
      workDate: {
        type: String,
        required: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
        index: true,
      },
      sessionPeriod: {
        startTime: { type: String, default: "", trim: true }, // HH:mm optional
        endTime: { type: String, default: "", trim: true },
      },
      location: {
        label: { type: String, default: "Home", trim: true, maxlength: 120 },
        address: { type: String, default: "", trim: true, maxlength: 255 },
        latitude: { type: Number, required: true, min: -90, max: 90 },
        longitude: { type: Number, required: true, min: -180, max: 180 },
        radiusMeters: { type: Number, default: 200, min: 25, max: 5000 },
      },
      reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000,
      },
      status: {
        type: String,
        enum: Object.values(REMOTE_WORK_STATUSES),
        default: REMOTE_WORK_STATUSES.PENDING,
        index: true,
      },
      decision: {
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        decidedAt: { type: Date, default: null },
        remarks: { type: String, default: "", trim: true, maxlength: 1000 },
      },
      /**
       * One-time consumption: an APPROVED request may authorize exactly one remote session.
       * Status stays APPROVED for HR audit history; consumedAt gates reuse.
       */
      consumedAt: { type: Date, default: null, index: true },
      consumedBySessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      consumedByAttendanceId: { type: mongoose.Schema.Types.ObjectId, default: null },
      schemaVersion: { type: Number, default: 1 },
    },
    {
      timestamps: true,
      collection: "remote_work_requests",
    }
  );

  schema.index({ employeeId: 1, workDate: 1, status: 1 });
  schema.index({ status: 1, createdAt: -1 });
  // One pending request per employee per date
  schema.index(
    { employeeId: 1, workDate: 1 },
    {
      unique: true,
      partialFilterExpression: { status: REMOTE_WORK_STATUSES.PENDING },
      name: "remote_pending_unique_per_day",
    }
  );

  return schema;
}

export function getRemoteWorkRequestModel(connection) {
  return (
    connection.models.RemoteWorkRequest ||
    connection.model("RemoteWorkRequest", createRemoteWorkRequestSchema())
  );
}

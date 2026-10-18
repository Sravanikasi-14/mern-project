import mongoose from "mongoose";

export const LEAVE_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export function createLeaveRequestSchema() {
  const leaveRequestSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      leaveTypeCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
      },
      fromDate: {
        type: Date,
        required: true,
      },
      toDate: {
        type: Date,
        required: true,
      },
      daysCount: {
        type: Number,
        default: 1,
      },
      reason: {
        type: String,
        default: "",
        trim: true,
      },
      status: {
        type: String,
        enum: Object.values(LEAVE_STATUSES),
        default: LEAVE_STATUSES.PENDING,
        required: true,
        index: true,
      },
      decision: {
        decidedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        decidedAt: {
          type: Date,
          default: null,
        },
        remarks: {
          type: String,
          default: "",
          trim: true,
        },
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "leave_requests",
    }
  );

  leaveRequestSchema.index({ employeeId: 1, status: 1, fromDate: 1 });
  leaveRequestSchema.index({ status: 1, fromDate: 1 });
  leaveRequestSchema.index({ employeeId: 1, fromDate: 1 });
  leaveRequestSchema.index({ status: 1, createdAt: -1 });
  leaveRequestSchema.index({ fromDate: 1, toDate: 1 });

  return leaveRequestSchema;
}

export function getLeaveRequestModel(connection) {
  return (
    connection.models.LeaveRequest ||
    connection.model("LeaveRequest", createLeaveRequestSchema())
  );
}

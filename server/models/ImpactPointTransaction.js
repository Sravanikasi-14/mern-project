import mongoose from "mongoose";

export const TRANSACTION_TYPES = Object.freeze({
  EARNED: "EARNED",
  DEDUCTED: "DEDUCTED",
  REVERSAL: "REVERSAL",
});

export const TRANSACTION_SOURCES = Object.freeze({
  TASK_COMPLETION: "TASK_COMPLETION",
  MANAGER_RECOGNITION: "MANAGER_RECOGNITION",
  AUTOMATIC_EVENT: "AUTOMATIC_EVENT",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  BONUS: "BONUS",
  PENALTY: "PENALTY",
  REVERSAL: "REVERSAL",
});

export function createImpactPointTransactionSchema() {
  const transactionSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: [true, "Employee reference is required"],
      },
      employeeSnapshot: {
        fullName: { type: String, default: "" },
        employeeCode: { type: String, default: "" },
        department: { type: String, default: "" },
      },
      points: {
        type: Number,
        required: [true, "Points value is required"],
        validate: {
          validator: Number.isInteger,
          message: "Points must be a signed integer",
        },
      },
      transactionType: {
        type: String,
        enum: Object.values(TRANSACTION_TYPES),
        required: true,
      },
      source: {
        type: String,
        enum: Object.values(TRANSACTION_SOURCES),
        required: true,
      },
      eventType: {
        type: String,
        required: [true, "Event type is required"],
        trim: true,
      },
      reason: {
        type: String,
        required: [true, "Reason is required"],
        trim: true,
        maxlength: [500, "Reason cannot exceed 500 characters"],
      },
      actorUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      actorEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      actorSnapshot: {
        fullName: { type: String, default: "" },
        email: { type: String, default: "" },
        role: { type: String, default: "" },
      },
      taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Task",
        default: null,
      },
      idempotencyKey: {
        type: String,
        required: [true, "Idempotency key is required"],
        trim: true,
      },
      reversalReferenceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ImpactPointTransaction",
        default: null,
      },
      isReversed: {
        type: Boolean,
        default: false,
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    {
      timestamps: true,
      collection: "impact_point_transactions",
    }
  );

  transactionSchema.index({ idempotencyKey: 1 }, { unique: true });
  transactionSchema.index({ employeeId: 1, createdAt: -1 });
  transactionSchema.index({ createdAt: -1 });
  transactionSchema.index({ employeeId: 1, points: 1 });
  transactionSchema.index({ "employeeSnapshot.department": 1, points: 1 });
  transactionSchema.index({ taskId: 1 });

  return transactionSchema;
}

export function getImpactPointTransactionModel(connection) {
  return (
    connection.models.ImpactPointTransaction ||
    connection.model("ImpactPointTransaction", createImpactPointTransactionSchema())
  );
}

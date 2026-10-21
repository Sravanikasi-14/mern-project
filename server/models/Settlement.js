import mongoose from "mongoose";

export const SETTLEMENT_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  ON_HOLD: "ON_HOLD",
  PAID: "PAID",
  COMPLETED: "COMPLETED",
});

export const VALID_STATUS_TRANSITIONS = Object.freeze({
  [SETTLEMENT_STATUSES.DRAFT]: [
    SETTLEMENT_STATUSES.UNDER_REVIEW,
    SETTLEMENT_STATUSES.ON_HOLD,
  ],
  [SETTLEMENT_STATUSES.UNDER_REVIEW]: [
    SETTLEMENT_STATUSES.APPROVED,
    SETTLEMENT_STATUSES.DRAFT,
    SETTLEMENT_STATUSES.ON_HOLD,
  ],
  [SETTLEMENT_STATUSES.APPROVED]: [
    SETTLEMENT_STATUSES.PAID,
    SETTLEMENT_STATUSES.ON_HOLD,
  ],
  [SETTLEMENT_STATUSES.ON_HOLD]: [
    SETTLEMENT_STATUSES.DRAFT,
    SETTLEMENT_STATUSES.UNDER_REVIEW,
    SETTLEMENT_STATUSES.APPROVED,
  ],
  [SETTLEMENT_STATUSES.PAID]: [SETTLEMENT_STATUSES.COMPLETED],
  [SETTLEMENT_STATUSES.COMPLETED]: [], // Terminal state
});

export function createSettlementSchema() {
  const lineItemSchema = new mongoose.Schema(
    {
      id: { type: String, required: true },
      title: { type: String, required: true },
      category: {
        type: String,
        enum: [
          "SALARY",
          "LEAVE_ENCASHMENT",
          "BONUS",
          "GRATUITY",
          "REIMBURSEMENT",
          "STATUTORY",
          "ADVANCE_RECOVERY",
          "NOTICE_RECOVERY",
          "ASSET_RECOVERY",
          "TAX",
          "OTHER",
        ],
        required: true,
      },
      amount: { type: Number, required: true, min: 0 },
      isSystemCalculated: { type: Boolean, default: false },
      remarks: { type: String, default: "" },
    },
    { _id: false }
  );

  const settlementSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      exitDetails: {
        lastWorkingDay: { type: Date, required: true },
        exitReason: {
          type: String,
          required: true,
          trim: true,
        },
        hrRemarks: { type: String, default: "" },
        initiatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        initiatedAt: { type: Date, default: Date.now },
      },
      status: {
        type: String,
        enum: Object.values(SETTLEMENT_STATUSES),
        default: SETTLEMENT_STATUSES.DRAFT,
        required: true,
        index: true,
      },
      holdReason: { type: String, default: "" },
      statusHistory: {
        type: [
          {
            status: { type: String, required: true },
            changedBy: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            changedAt: { type: Date, default: Date.now },
            remarks: { type: String, default: "" },
          },
        ],
        default: [],
      },
      calculationInputs: {
        monthlyCtc: { type: Number, default: 0 },
        basicSalary: { type: Number, default: 0 },
        hra: { type: Number, default: 0 },
        specialAllowance: { type: Number, default: 0 },
        workingDaysInExitMonth: { type: Number, default: 30 },
        workedDaysInExitMonth: { type: Number, default: 0 },
        dailyRate: { type: Number, default: 0 },
        earnedLeaveBalance: { type: Number, default: 0 },
        leaveEncashmentEligible: { type: Boolean, default: false },
        leaveEncashmentDailyRate: { type: Number, default: 0 },
        missingDataFlags: { type: [String], default: [] },
      },
      financialBreakdown: {
        earnings: { type: [lineItemSchema], default: [] },
        deductions: { type: [lineItemSchema], default: [] },
        totalEarnings: { type: Number, default: 0 },
        totalDeductions: { type: Number, default: 0 },
        netSettlementAmount: { type: Number, default: 0 },
      },
      adjustmentsHistory: {
        type: [
          {
            adjustedAt: { type: Date, default: Date.now },
            adjustedBy: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            previousNet: { type: Number, required: true },
            newNet: { type: Number, required: true },
            remarks: { type: String, default: "" },
          },
        ],
        default: [],
      },
      paymentDetails: {
        paymentDate: { type: Date, default: null },
        paymentMethod: {
          type: String,
          default: "",
          trim: true,
        },
        referenceNumber: { type: String, default: "", trim: true },
        remarks: { type: String, default: "", trim: true },
        recordedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        recordedAt: { type: Date, default: null },
      },
      approvedAt: { type: Date, default: null },
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      completedAt: { type: Date, default: null },
      completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "settlements",
    }
  );

  settlementSchema.index({ employeeId: 1, createdAt: -1 });
  settlementSchema.index({ status: 1, createdAt: -1 });

  return settlementSchema;
}

export function getSettlementModel(connection) {
  return (
    connection.models.Settlement ||
    connection.model("Settlement", createSettlementSchema())
  );
}

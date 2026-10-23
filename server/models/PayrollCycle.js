import mongoose from "mongoose";

export const PAYROLL_CYCLE_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  CALCULATED: "CALCULATED",
  FINALIZED: "FINALIZED",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
});

export const PAYMENT_STATUSES = Object.freeze({
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
});

export function createPayrollCycleSchema() {
  const paymentRecordSchema = new mongoose.Schema(
    {
      paymentDate: { type: Date, required: true },
      paymentMethod: {
        type: String,
        enum: ["BANK_TRANSFER", "NEFT_RTGS", "UPI", "CHEQUE", "DIRECT_DEPOSIT", "CASH", "OTHER"],
        default: "NEFT_RTGS",
      },
      referenceNumber: { type: String, trim: true, default: "" },
      amount: { type: Number, required: true, min: 0 },
      remarks: { type: String, trim: true, default: "" },
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      recordedAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const payrollCycleSchema = new mongoose.Schema(
    {
      periodMonth: {
        type: Number,
        required: true,
        min: 1,
        max: 12,
      },
      periodYear: {
        type: Number,
        required: true,
        min: 2020,
        max: 2100,
      },
      periodStartDate: {
        type: Date,
        required: true,
      },
      periodEndDate: {
        type: Date,
        required: true,
      },
      status: {
        type: String,
        enum: Object.values(PAYROLL_CYCLE_STATUSES),
        default: PAYROLL_CYCLE_STATUSES.DRAFT,
      },
      employeeCount: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalGrossEarnings: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalEmployeeDeductions: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalEmployerContributions: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalNetPayable: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalPaidAmount: {
        type: Number,
        default: 0,
        min: 0,
      },
      paymentStatus: {
        type: String,
        enum: Object.values(PAYMENT_STATUSES),
        default: PAYMENT_STATUSES.UNPAID,
      },
      payments: {
        type: [paymentRecordSchema],
        default: [],
      },
      validationIssues: {
        type: [
          {
            employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
            employeeCode: String,
            fullName: String,
            issue: String,
          },
        ],
        default: [],
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      calculatedAt: {
        type: Date,
        default: null,
      },
      finalizedAt: {
        type: Date,
        default: null,
      },
      finalizedBy: {
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
      collection: "payroll_cycles",
    }
  );

  // Prevent duplicate payroll cycles for the same month & year in this tenant DB
  payrollCycleSchema.index({ periodYear: 1, periodMonth: 1 }, { unique: true });
  payrollCycleSchema.index({ periodYear: -1, periodMonth: -1 });
  payrollCycleSchema.index({ status: 1 });
  payrollCycleSchema.index({ status: 1, periodYear: -1, periodMonth: -1 });

  return payrollCycleSchema;
}

export function getPayrollCycleModel(connection) {
  return (
    connection.models.PayrollCycle ||
    connection.model("PayrollCycle", createPayrollCycleSchema())
  );
}

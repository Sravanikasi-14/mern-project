import mongoose from "mongoose";

export const PAYSLIP_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  FINALIZED: "FINALIZED",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
});

export function createPayslipSchema() {
  const lineItemSchema = new mongoose.Schema(
    {
      name: { type: String, required: true },
      code: { type: String, required: true },
      amount: { type: Number, required: true, min: 0 },
      isTaxable: { type: Boolean, default: true },
    },
    { _id: false }
  );

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

  const payslipSchema = new mongoose.Schema(
    {
      payrollCycleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PayrollCycle",
        required: true,
        index: true,
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      payslipNumber: {
        type: String,
        required: true,
        trim: true,
      },
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
      employeeSnapshot: {
        employeeCode: { type: String, default: "" },
        fullName: { type: String, default: "" },
        email: { type: String, default: "" },
        department: { type: String, default: "General" },
        jobTitle: { type: String, default: "Specialist" },
        bankAccountNumber: { type: String, default: "" },
        bankName: { type: String, default: "" },
        bankIfsc: { type: String, default: "" },
        panNumber: { type: String, default: "" },
      },
      compensationRevisionId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      monthlyCostToCompany: {
        type: Number,
        required: true,
        min: 0,
      },
      // Attendance & Days Breakdown
      daysBreakdown: {
        totalDaysInMonth: { type: Number, required: true },
        workingDays: { type: Number, required: true },
        weekendDays: { type: Number, default: 0 },
        holidayDays: { type: Number, default: 0 },
        presentDays: { type: Number, default: 0 },
        paidLeaveDays: { type: Number, default: 0 },
        lossOfPayDays: { type: Number, default: 0 },
        payableDays: { type: Number, required: true },
      },
      // Financial Breakdown
      earnings: {
        type: [lineItemSchema],
        default: [],
      },
      employeeDeductions: {
        type: [lineItemSchema],
        default: [],
      },
      employerContributions: {
        type: [lineItemSchema],
        default: [],
      },
      grossEarnings: {
        type: Number,
        required: true,
        min: 0,
      },
      totalDeductions: {
        type: Number,
        required: true,
        min: 0,
      },
      totalEmployerContributions: {
        type: Number,
        default: 0,
        min: 0,
      },
      netPayable: {
        type: Number,
        required: true,
        min: 0,
      },
      currency: {
        type: String,
        default: "INR",
      },
      currencySymbol: {
        type: String,
        default: "₹",
      },
      status: {
        type: String,
        enum: Object.values(PAYSLIP_STATUSES),
        default: PAYSLIP_STATUSES.DRAFT,
      },
      paymentStatus: {
        type: String,
        enum: ["UNPAID", "PARTIALLY_PAID", "PAID"],
        default: "UNPAID",
      },
      payments: {
        type: [paymentRecordSchema],
        default: [],
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
      notes: {
        type: String,
        default: "",
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "payroll_payslips",
    }
  );

  // Each employee can only have one payslip record per payroll cycle
  payslipSchema.index({ payrollCycleId: 1, employeeId: 1 }, { unique: true });
  payslipSchema.index({ payrollCycleId: 1, status: 1 });
  payslipSchema.index({ employeeId: 1, periodYear: 1, periodMonth: 1 });
  payslipSchema.index({ employeeId: 1, status: 1 });
  payslipSchema.index({ employeeId: 1, status: 1, periodYear: -1, periodMonth: -1 });
  payslipSchema.index({ status: 1, periodYear: -1, periodMonth: -1 });

  return payslipSchema;
}

export function getPayslipModel(connection) {
  return (
    connection.models.Payslip ||
    connection.model("Payslip", createPayslipSchema())
  );
}

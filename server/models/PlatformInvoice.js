import mongoose from "mongoose";

export const INVOICE_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  DUE: "DUE",
  PAID: "PAID",
  VOID: "VOID",
  CANCELLED: "CANCELLED",
});

export const PAYMENT_STATUSES = Object.freeze({
  UNPAID: "UNPAID",
  MANUAL_RECORDED: "MANUAL_RECORDED",
  FAILED: "FAILED",
});

/**
 * Central billing invoice records for Platform Admin.
 * No live payment-gateway confirmation in Batch 3 — PAID only via manual recording.
 */
const platformInvoiceSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformPlan",
      default: null,
    },
    planCode: { type: String, default: "" },
    invoiceNumber: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: Object.values(INVOICE_STATUSES),
      default: INVOICE_STATUSES.DUE,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.UNPAID,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR", uppercase: true },
    billingCycle: { type: String, default: "NONE" },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    /** Manual payment metadata only — never invents gateway success. */
    payment: {
      method: { type: String, default: "" },
      reference: { type: String, default: "" },
      recordedByPlatformAdminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PlatformAdmin",
        default: null,
      },
      recordedByEmail: { type: String, default: "" },
      recordedAt: { type: Date, default: null },
      note: { type: String, default: "" },
    },
    createdByPlatformAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformAdmin",
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "platform_invoices",
  }
);

platformInvoiceSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.PlatformInvoice ||
  mongoose.model("PlatformInvoice", platformInvoiceSchema);

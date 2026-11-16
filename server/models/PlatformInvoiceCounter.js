import mongoose from "mongoose";

/**
 * Race-safe invoice sequence counters keyed by calendar year.
 * Uses findOneAndUpdate $inc so concurrent invoice creates cannot collide.
 */
const platformInvoiceCounterSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, unique: true },
    seq: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: true,
    collection: "platform_invoice_counters",
  }
);

export default mongoose.models.PlatformInvoiceCounter ||
  mongoose.model("PlatformInvoiceCounter", platformInvoiceCounterSchema);

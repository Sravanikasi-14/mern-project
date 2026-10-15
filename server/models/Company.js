import mongoose from "mongoose";

export const COMPANY_STATUSES = Object.freeze({
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
});

export const LOGIN_ALLOWED_STATUSES = new Set([
  COMPANY_STATUSES.TRIAL,
  COMPANY_STATUSES.ACTIVE,
]);

const companySchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    databaseName: { type: String, required: true, trim: true },
    migrationVersion: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(COMPANY_STATUSES),
      required: true,
      default: COMPANY_STATUSES.TRIAL,
    },
    subscription: {
      plan: { type: String, default: "TRIAL" },
      maxEmployeeSeats: { type: Number, default: 10 },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    branding: {
      displayName: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
      primaryColor: { type: String, default: "#4338ca" },
    },
    config: {
      timezone: { type: String, default: "Asia/Kolkata" },
      currencyCode: { type: String, default: "INR" },
      enabledModules: { type: [String], default: [] },
    },
    primaryContact: {
      fullName: { type: String, default: "" },
      email: { type: String, default: "" },
      phoneNumber: { type: String, default: "" },
    },
    customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    schemaVersion: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    collection: "companies",
  }
);

companySchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.databaseName;
    return ret;
  },
});

export default mongoose.models.Company ||
  mongoose.model("Company", companySchema);

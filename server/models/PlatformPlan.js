import mongoose from "mongoose";
import { listPlatformModuleKeys } from "../constants/platformFeatureCatalog.js";

export const PLAN_BILLING_CYCLES = Object.freeze({
  NONE: "NONE",
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY",
});

/**
 * Centrally managed subscription plans (source of truth for plan entitlements).
 */
const platformPlanSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    /** When true, all catalog modules are included. */
    modulesAll: { type: Boolean, default: false },
    /** Explicit module keys when modulesAll is false. */
    includedModules: { type: [String], default: [] },
    /**
     * Optional capability allow-list. Empty = all capabilities under included modules.
     * Explicit false entries are not used; omit or list allowed capability keys.
     */
    includedCapabilities: { type: [String], default: [] },
    maxEmployeeSeats: { type: Number, default: 10, min: 1 },
    /** Soft limit for future insights; 0 = unlimited / not enforced in Batch 3. */
    maxStorageMb: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    billingCycle: {
      type: String,
      enum: Object.values(PLAN_BILLING_CYCLES),
      default: PLAN_BILLING_CYCLES.NONE,
    },
    trialDays: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 100 },
    isSystem: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "platform_plans",
  }
);

platformPlanSchema.methods.allowsModule = function allowsModule(moduleKey) {
  const key = String(moduleKey || "");
  if (!key || !listPlatformModuleKeys().includes(key)) return false;
  if (this.modulesAll) return true;
  return Array.isArray(this.includedModules) && this.includedModules.includes(key);
};

platformPlanSchema.methods.allowsCapability = function allowsCapability(capabilityKey, moduleKey) {
  if (!this.allowsModule(moduleKey)) return false;
  if (!Array.isArray(this.includedCapabilities) || this.includedCapabilities.length === 0) {
    return true;
  }
  return this.includedCapabilities.includes(capabilityKey);
};

platformPlanSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export default mongoose.models.PlatformPlan ||
  mongoose.model("PlatformPlan", platformPlanSchema);

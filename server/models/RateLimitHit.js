import mongoose from "mongoose";

/**
 * F65 — Shared rate-limit counters for multi-instance / serverless deployments.
 * Stored on the central Mongo connection; TTL purges expired windows.
 */
const rateLimitHitSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    hits: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  {
    collection: "rate_limit_hits",
    versionKey: false,
  }
);

rateLimitHitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });

export function getRateLimitHitModel() {
  return (
    mongoose.models.RateLimitHit ||
    mongoose.model("RateLimitHit", rateLimitHitSchema)
  );
}

export default getRateLimitHitModel;

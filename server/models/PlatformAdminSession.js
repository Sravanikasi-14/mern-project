import mongoose from "mongoose";

const platformAdminSessionSchema = new mongoose.Schema(
  {
    platformAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformAdmin",
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, required: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "platform_admin_sessions",
  }
);

platformAdminSessionSchema.index({ platformAdminId: 1, isActive: 1 });
// F45 — platform sessions are ephemeral; purge at expiresAt.
platformAdminSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "expiresAt_ttl" }
);

export default mongoose.models.PlatformAdminSession ||
  mongoose.model("PlatformAdminSession", platformAdminSessionSchema);

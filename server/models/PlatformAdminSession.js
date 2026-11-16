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
    expiresAt: { type: Date, required: true, index: true },
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

export default mongoose.models.PlatformAdminSession ||
  mongoose.model("PlatformAdminSession", platformAdminSessionSchema);

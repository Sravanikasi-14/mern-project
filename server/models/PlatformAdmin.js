import mongoose from "mongoose";

/**
 * Central singleton Platform Admin identity.
 * Exactly one active document is enforced by a partial unique index on singletonKey.
 */
const platformAdminSchema = new mongoose.Schema(
  {
    /** Constant "default" — unique among active admins to enforce singleton. */
    singletonKey: {
      type: String,
      required: true,
      default: "default",
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    /** AES-GCM ciphertext of TOTP shared secret (base32). Never returned to clients. */
    mfaSecretEncrypted: { type: String, default: "", select: false },
    mfaEnabled: { type: Boolean, default: false },
    mfaVerifiedAt: { type: Date, default: null },
    /** bcrypt hashes of one-time recovery codes; plaintext shown once at enrollment. */
    mfaRecoveryCodeHashes: { type: [String], default: [], select: false },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "platform_admins",
  }
);

platformAdminSchema.index(
  { singletonKey: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: "platform_admin_singleton_active",
  }
);

platformAdminSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.mfaSecretEncrypted;
    delete ret.mfaRecoveryCodeHashes;
    return ret;
  },
});

export default mongoose.models.PlatformAdmin ||
  mongoose.model("PlatformAdmin", platformAdminSchema);

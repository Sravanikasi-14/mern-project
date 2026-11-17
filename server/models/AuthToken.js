import mongoose from "mongoose";

export const TOKEN_TYPES = Object.freeze({
  INVITATION: "INVITATION",
  ONBOARDING: "ONBOARDING",
  PASSWORD_RESET: "PASSWORD_RESET",
});

export function createAuthTokenSchema() {
  const authTokenSchema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true,
      },
      token: {
        type: String,
        required: true,
        unique: true,
      },
      type: {
        type: String,
        enum: Object.values(TOKEN_TYPES),
        default: TOKEN_TYPES.ONBOARDING,
        required: true,
      },
      role: {
        type: String,
        enum: ["HR_ADMIN", "EMPLOYEE"],
        required: true,
      },
      expiresAt: {
        type: Date,
        required: true,
      },
      usedAt: {
        type: Date,
        default: null,
      },
      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },
      createdBy: {
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
      collection: "authTokens",
    }
  );

  // F45 — TTL purge of expired invite/reset tokens (ephemeral only).
  authTokenSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: "expiresAt_ttl" }
  );

  return authTokenSchema;
}

export function getAuthTokenModel(connection) {
  return (
    connection.models.AuthToken ||
    connection.model("AuthToken", createAuthTokenSchema())
  );
}

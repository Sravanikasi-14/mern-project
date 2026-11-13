import mongoose from "mongoose";

export function createAuthSessionSchema() {
  const authSessionSchema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      token: {
        type: String,
        required: true,
        index: true,
      },
      ipAddress: {
        type: String,
        default: "",
      },
      userAgent: {
        type: String,
        default: "",
      },
      /**
       * Server-validated client platform bound at session creation
       * (web | android | ios). Used for allowWebTracking enforcement.
       */
      clientPlatform: {
        type: String,
        enum: ["web", "android", "ios"],
        default: "web",
        index: true,
      },
      expiresAt: {
        type: Date,
        required: true,
        index: true,
      },
      /**
       * SHA-256 of the mobile refresh token. Absent for web sessions.
       * The raw token is never stored.
       */
      refreshTokenHash: {
        type: String,
        index: true,
        sparse: true,
      },
      refreshExpiresAt: {
        type: Date,
      },
      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "authSessions",
    }
  );

  // Revoke-all / password-change: updateMany({ userId, isActive: true })
  authSessionSchema.index({ userId: 1, isActive: 1 });
  // Authenticate hot path: findOne({ token, isActive: true })
  authSessionSchema.index({ token: 1, isActive: 1 });

  return authSessionSchema;
}

export function getAuthSessionModel(connection) {
  return (
    connection.models.AuthSession ||
    connection.model("AuthSession", createAuthSessionSchema())
  );
}

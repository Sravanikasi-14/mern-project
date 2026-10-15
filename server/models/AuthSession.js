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
      expiresAt: {
        type: Date,
        required: true,
        index: true,
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

  return authSessionSchema;
}

export function getAuthSessionModel(connection) {
  return (
    connection.models.AuthSession ||
    connection.model("AuthSession", createAuthSessionSchema())
  );
}

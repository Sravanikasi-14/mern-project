import mongoose from "mongoose";

export const USER_ROLES = Object.freeze({
  HR_ADMIN: "HR_ADMIN",
  EMPLOYEE: "EMPLOYEE",
});

export function createUserSchema() {
  const userSchema = new mongoose.Schema(
    {
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
      },
      passwordHash: { type: String, required: true, select: false },
      role: {
        type: String,
        enum: Object.values(USER_ROLES),
        required: true,
      },
      isActive: { type: Boolean, required: true, default: true },
      lastLoginAt: { type: Date, default: null },
      schemaVersion: { type: Number, default: 1 },
    },
    {
      timestamps: true,
      collection: "users",
    }
  );

  userSchema.set("toJSON", {
    transform(_doc, ret) {
      delete ret.passwordHash;
      delete ret.__v;
      return ret;
    },
  });

  return userSchema;
}

export function getUserModel(connection) {
  return connection.models.User || connection.model("User", createUserSchema());
}

export function serializeUser(user) {
  if (!user) {
    return null;
  }

  const json = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete json.passwordHash;
  return json;
}

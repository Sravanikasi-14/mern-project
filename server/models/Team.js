import mongoose from "mongoose";

/**
 * Tenant-scoped Organization Explorer Team.
 * Membership is canonical on Team — Employee documents are not modified.
 */
export function createTeamSchema() {
  const teamSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Team name is required"],
        trim: true,
        maxlength: [200, "Team name cannot exceed 200 characters"],
      },
      /** Lowercase trimmed name for case-insensitive uniqueness among active teams. */
      nameNormalized: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      department: {
        type: String,
        trim: true,
        default: "",
      },
      leadEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      memberEmployeeIds: {
        type: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
          },
        ],
        default: [],
      },
      isActive: {
        type: Boolean,
        default: true,
        required: true,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "teams",
    }
  );

  teamSchema.pre("validate", function syncNameNormalized() {
    if (typeof this.name === "string") {
      this.nameNormalized = this.name.trim().toLowerCase();
    }
  });

  // Unique active team names (case-insensitive via nameNormalized).
  teamSchema.index(
    { nameNormalized: 1 },
    {
      unique: true,
      partialFilterExpression: { isActive: true },
      name: "teams_active_name_unique",
    }
  );
  teamSchema.index({ isActive: 1, name: 1 });
  teamSchema.index({ memberEmployeeIds: 1 });
  teamSchema.index({ leadEmployeeId: 1 });
  teamSchema.index({ department: 1, isActive: 1 });

  return teamSchema;
}

export function getTeamModel(connection) {
  return connection.models.Team || connection.model("Team", createTeamSchema());
}

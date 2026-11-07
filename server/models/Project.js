import mongoose from "mongoose";

/**
 * Tenant-scoped Project entity (Phase A3).
 * Distinct from Task.projectName (free text) and Employee.job.project embeds.
 */
export const PROJECT_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  ON_HOLD: "ON_HOLD",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
});

/** Existing employee job.project.projectType values — optional on Project. */
export const PROJECT_TYPES = Object.freeze({
  MANDATE: "MANDATE",
  RETAIL: "RETAIL",
  BENCH: "BENCH",
  INTERNAL: "INTERNAL",
});

export function createProjectSchema() {
  const projectSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Project name is required"],
        trim: true,
        maxlength: [200, "Project name cannot exceed 200 characters"],
      },
      normalizedName: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      description: {
        type: String,
        trim: true,
        default: "",
        maxlength: [2000, "Project description cannot exceed 2000 characters"],
      },
      projectCode: {
        type: String,
        trim: true,
        default: "",
        maxlength: [50, "Project code cannot exceed 50 characters"],
      },
      projectType: {
        type: String,
        enum: [...Object.values(PROJECT_TYPES), ""],
        default: "",
      },
      status: {
        type: String,
        enum: Object.values(PROJECT_STATUSES),
        required: true,
        default: PROJECT_STATUSES.ACTIVE,
      },
      startDate: {
        type: Date,
        default: null,
      },
      endDate: {
        type: Date,
        default: null,
      },
      isActive: {
        type: Boolean,
        required: true,
        default: true,
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      updatedBy: {
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
      collection: "projects",
    }
  );

  projectSchema.pre("validate", function syncNormalizedNameAndActive() {
    if (typeof this.name === "string") {
      this.normalizedName = this.name.trim().toLowerCase();
    }
    // Archived / completed projects are not assignable for new scopes.
    if (
      this.status === PROJECT_STATUSES.ARCHIVED ||
      this.status === PROJECT_STATUSES.COMPLETED
    ) {
      this.isActive = false;
    }
  });

  projectSchema.index(
    { normalizedName: 1 },
    { unique: true, name: "projects_normalized_name_unique" }
  );
  projectSchema.index({ isActive: 1, status: 1, name: 1 });
  projectSchema.index({ projectCode: 1 });
  projectSchema.index({ status: 1 });

  return projectSchema;
}

export function getProjectModel(connection) {
  return connection.models.Project || connection.model("Project", createProjectSchema());
}

export function serializeProject(project) {
  if (!project) return null;
  const json = typeof project.toObject === "function" ? project.toObject() : { ...project };
  return {
    id: String(json._id),
    name: json.name,
    description: json.description || "",
    projectCode: json.projectCode || "",
    projectType: json.projectType || "",
    status: json.status,
    startDate: json.startDate || null,
    endDate: json.endDate || null,
    isActive: Boolean(json.isActive),
    createdAt: json.createdAt || null,
    updatedAt: json.updatedAt || null,
  };
}

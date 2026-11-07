import mongoose from "mongoose";

export function createDesignationSchema() {
  const designationSchema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: [true, "Designation title is required"],
        trim: true,
        maxlength: [200, "Designation title cannot exceed 200 characters"],
      },
      normalizedTitle: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
      },
      grade: {
        type: String,
        trim: true,
        default: "",
        maxlength: [80, "Job level cannot exceed 80 characters"],
      },
      description: {
        type: String,
        trim: true,
        default: "",
        maxlength: [1000, "Designation description cannot exceed 1000 characters"],
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
    },
    {
      timestamps: true,
      collection: "designations",
      autoIndex: false,
    }
  );

  designationSchema.pre("validate", function syncNormalizedTitle() {
    if (typeof this.title === "string") {
      this.normalizedTitle = this.title.trim().toLowerCase();
    }
  });

  designationSchema.index(
    { normalizedTitle: 1 },
    { unique: true, name: "designations_normalized_title_unique" }
  );
  designationSchema.index({ isActive: 1, title: 1 });

  return designationSchema;
}

export function getDesignationModel(connection) {
  return (
    connection.models.Designation ||
    connection.model("Designation", createDesignationSchema())
  );
}

export function serializeDesignation(designation, usageCount = 0) {
  if (!designation) return null;
  const json =
    typeof designation.toObject === "function" ? designation.toObject() : { ...designation };
  return {
    id: String(json._id),
    title: json.title,
    grade: json.grade || "",
    description: json.description || "",
    isActive: Boolean(json.isActive),
    usageCount,
    createdAt: json.createdAt || null,
    updatedAt: json.updatedAt || null,
  };
}

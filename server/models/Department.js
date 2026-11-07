import mongoose from "mongoose";

export function createDepartmentSchema() {
  const departmentSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: [true, "Department name is required"],
        trim: true,
        maxlength: [200, "Department name cannot exceed 200 characters"],
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
        maxlength: [1000, "Department description cannot exceed 1000 characters"],
      },
      code: {
        type: String,
        trim: true,
        default: "",
        maxlength: [50, "Department code cannot exceed 50 characters"],
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
      collection: "departments",
    }
  );

  departmentSchema.pre("validate", function syncNormalizedName() {
    if (typeof this.name === "string") {
      this.normalizedName = this.name.trim().toLowerCase();
    }
  });

  departmentSchema.index(
    { normalizedName: 1 },
    { unique: true, name: "departments_normalized_name_unique" }
  );
  departmentSchema.index({ isActive: 1, name: 1 });
  departmentSchema.index({ code: 1 });

  return departmentSchema;
}

export function getDepartmentModel(connection) {
  return (
    connection.models.Department ||
    connection.model("Department", createDepartmentSchema())
  );
}

export function serializeDepartment(department) {
  if (!department) return null;
  const json =
    typeof department.toObject === "function" ? department.toObject() : { ...department };
  return {
    id: String(json._id),
    name: json.name,
    description: json.description || "",
    code: json.code || "",
    isActive: Boolean(json.isActive),
    createdAt: json.createdAt || null,
    updatedAt: json.updatedAt || null,
  };
}

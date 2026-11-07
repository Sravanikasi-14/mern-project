import mongoose from "mongoose";

/**
 * Explicit employee ↔ project membership for authorization (Phase A3).
 *
 * Design decision:
 * - Legacy Employee.job.project is a single embedded primary project (strings).
 * - Auth and multi-employee projects use this collection as source of truth.
 * - Task.projectName is free text and is NOT linked here.
 * - Membership is soft-ended (status ENDED) to preserve history.
 */
export const PROJECT_MEMBERSHIP_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
});

export function createProjectMembershipSchema() {
  const membershipSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(PROJECT_MEMBERSHIP_STATUSES),
        required: true,
        default: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
      },
      isPrimary: {
        type: Boolean,
        default: false,
      },
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      endedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      endedAt: {
        type: Date,
        default: null,
      },
      endReason: {
        type: String,
        trim: true,
        default: "",
        maxlength: [500, "End reason cannot exceed 500 characters"],
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "project_memberships",
    }
  );

  membershipSchema.index(
    { employeeId: 1, projectId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE },
      name: "project_memberships_active_unique",
    }
  );
  membershipSchema.index({ projectId: 1, status: 1 });
  membershipSchema.index({ employeeId: 1, status: 1 });

  return membershipSchema;
}

export function getProjectMembershipModel(connection) {
  return (
    connection.models.ProjectMembership ||
    connection.model("ProjectMembership", createProjectMembershipSchema())
  );
}

export function serializeProjectMembership(membership, { project = null, employee = null } = {}) {
  if (!membership) return null;
  const json =
    typeof membership.toObject === "function" ? membership.toObject() : { ...membership };
  return {
    id: String(json._id),
    employeeId: json.employeeId ? String(json.employeeId) : null,
    projectId: json.projectId ? String(json.projectId) : null,
    status: json.status,
    isPrimary: Boolean(json.isPrimary),
    project: project
      ? {
          id: String(project._id || project.id),
          name: project.name,
          status: project.status,
          isActive: Boolean(project.isActive),
        }
      : undefined,
    employee: employee
      ? {
          id: String(employee._id || employee.id),
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
        }
      : undefined,
    addedBy: json.addedBy ? String(json.addedBy) : null,
    endedBy: json.endedBy ? String(json.endedBy) : null,
    endedAt: json.endedAt || null,
    endReason: json.endReason || "",
    createdAt: json.createdAt || null,
    updatedAt: json.updatedAt || null,
  };
}

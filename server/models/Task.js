import mongoose from "mongoose";

export const TASK_STATUSES = Object.freeze({
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const TASK_PRIORITIES = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

export function createTaskSchema() {
  const taskSchema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: [true, "Task title is required"],
        trim: true,
        maxlength: [200, "Title cannot exceed 200 characters"],
      },
      description: {
        type: String,
        required: [true, "Task description is required"],
        trim: true,
      },
      assigneeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: [true, "Responsible employee is required"],
      },
      assigneeSnapshot: {
        fullName: { type: String, default: "" },
        employeeCode: { type: String, default: "" },
        email: { type: String, default: "" },
        department: { type: String, default: "" },
      },
      assignedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      assignedByEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      assignedBySnapshot: {
        fullName: { type: String, default: "" },
        role: { type: String, default: "" },
        email: { type: String, default: "" },
      },
      department: {
        type: String,
        trim: true,
        default: "",
      },
      projectName: {
        type: String,
        trim: true,
        default: "",
      },
      priority: {
        type: String,
        enum: Object.values(TASK_PRIORITIES),
        default: TASK_PRIORITIES.MEDIUM,
        required: true,
      },
      status: {
        type: String,
        enum: Object.values(TASK_STATUSES),
        default: TASK_STATUSES.ASSIGNED,
        required: true,
      },
      acceptanceCriteria: {
        type: [String],
        default: [],
      },
      startDate: {
        type: Date,
        default: null,
      },
      deadline: {
        type: Date,
        required: [true, "Task deadline is required"],
      },
      deliverables: {
        type: [
          {
            description: { type: String, default: "" },
            links: { type: [String], default: [] },
            documentUrl: { type: String, default: "" },
            fileName: { type: String, default: "" },
            fileSize: { type: Number, default: 0 },
            mimeType: { type: String, default: "" },
            storageKey: { type: String, default: "" },
            submittedAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
      },
      submissionNotes: {
        type: String,
        default: "",
        trim: true,
      },
      submittedAt: {
        type: Date,
        default: null,
      },
      review: {
        reviewedByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        reviewedByEmployeeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
          default: null,
        },
        reviewerSnapshot: {
          fullName: { type: String, default: "" },
          email: { type: String, default: "" },
          role: { type: String, default: "" },
        },
        reviewedAt: {
          type: Date,
          default: null,
        },
        decision: {
          type: String,
          enum: ["APPROVED", "CHANGES_REQUESTED", "REJECTED", null],
          default: null,
        },
        comments: {
          type: String,
          default: "",
          trim: true,
        },
      },
      resubmissionHistory: {
        type: [
          {
            iteration: { type: Number, required: true },
            submittedAt: { type: Date, required: true },
            deliverables: { type: Array, default: [] },
            submissionNotes: { type: String, default: "" },
            reviewedAt: { type: Date, default: null },
            reviewedBySnapshot: { type: Object, default: {} },
            decision: { type: String, default: "" },
            comments: { type: String, default: "" },
          },
        ],
        default: [],
      },
      completedAt: {
        type: Date,
        default: null,
      },
      pointsAwarded: {
        type: Number,
        default: 0,
      },
      pointsTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ImpactPointTransaction",
        default: null,
      },
      auditMetadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },
    {
      timestamps: true,
      collection: "tasks",
    }
  );

  taskSchema.index({ assigneeId: 1, status: 1 });
  taskSchema.index({ assignedByEmployeeId: 1, status: 1 });
  taskSchema.index({ department: 1, status: 1 });
  taskSchema.index({ deadline: 1 });
  taskSchema.index({ status: 1, createdAt: -1 });
  taskSchema.index({ status: 1, completedAt: -1 });
  taskSchema.index({ completedAt: -1 });

  return taskSchema;
}

export function getTaskModel(connection) {
  return connection.models.Task || connection.model("Task", createTaskSchema());
}

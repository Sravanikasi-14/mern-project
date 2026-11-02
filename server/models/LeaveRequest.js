import mongoose from "mongoose";
import {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  DELEGATION_STATUSES,
  DELEGATION_END_REASONS,
} from "../constants/handoverConstants.js";

export const LEAVE_STATUSES = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

/**
 * Compact temporary delegation embedded per handover item.
 * Never overwrites Task.assigneeId — permissions are derived from this record.
 */
function createEmbeddedDelegationSchema() {
  return new mongoose.Schema(
    {
      originalAssigneeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      delegateEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      fromDate: { type: Date, default: null },
      toDate: { type: Date, default: null },
      status: {
        type: String,
        enum: [...Object.values(DELEGATION_STATUSES), null],
        default: null,
      },
      activatedAt: { type: Date, default: null },
      endedAt: { type: Date, default: null },
      endReason: {
        type: String,
        enum: [...Object.values(DELEGATION_END_REASONS), null],
        default: null,
      },
      createdByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      endedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      outcomeNote: { type: String, default: "", trim: true, maxlength: 2000 },
      // Migration traceability (idempotency)
      migratedFromDelegationId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
    },
    { _id: false }
  );
}

function createHandoverItemSchema() {
  return new mongoose.Schema(
    {
      taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Task",
        required: true,
      },
      proposalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeaveBackupProposal",
        default: null,
      },
      backupEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      status: {
        type: String,
        enum: Object.values(HANDOVER_ITEM_STATUSES),
        default: HANDOVER_ITEM_STATUSES.DRAFT,
      },
      coverageFrom: { type: Date, default: null },
      coverageTo: { type: Date, default: null },
      instructions: { type: String, default: "", trim: true, maxlength: 4000 },
      outstandingWork: { type: String, default: "", trim: true, maxlength: 2000 },
      importantDeadlines: { type: String, default: "", trim: true, maxlength: 1000 },
      dependencies: { type: String, default: "", trim: true, maxlength: 2000 },
      documentLinks: {
        type: [
          {
            label: { type: String, trim: true, default: "", maxlength: 120 },
            url: { type: String, trim: true, default: "", maxlength: 500 },
          },
        ],
        default: [],
        validate: {
          validator(v) {
            return !v || v.length <= 10;
          },
          message: "At most 10 document links are allowed per handover item.",
        },
      },
      // Metadata only — never embed file bytes / base64 content
      attachments: {
        type: [
          {
            fileName: { type: String, trim: true, maxlength: 255 },
            fileSize: { type: Number, min: 0, max: 20 * 1024 * 1024 },
            mimeType: { type: String, trim: true, maxlength: 120 },
            storageKey: { type: String, trim: true, maxlength: 512 },
            uploadedByUserId: mongoose.Schema.Types.ObjectId,
            uploadedAt: { type: Date, default: Date.now },
          },
        ],
        default: [],
        validate: {
          validator(v) {
            return !v || v.length <= 20;
          },
          message: "At most 20 attachment metadata entries are allowed per handover item.",
        },
      },
      // Compact snapshot only — avoid duplicating full task documents
      taskSnapshot: {
        title: { type: String, default: "", maxlength: 200 },
        priority: { type: String, default: "", maxlength: 40 },
        deadline: { type: Date, default: null },
        status: { type: String, default: "", maxlength: 40 },
      },
      backupResponse: {
        decision: {
          type: String,
          enum: ["ACKNOWLEDGE", "NEEDS_INFO", "DECLINE", null],
          default: null,
        },
        comment: { type: String, default: "", trim: true, maxlength: 2000 },
        respondedAt: { type: Date, default: null },
        respondedByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
      managerDecision: {
        decision: {
          type: String,
          enum: ["APPROVE", "REVISE", "REJECT", null],
          default: null,
        },
        reason: { type: String, default: "", trim: true, maxlength: 2000 },
        decidedAt: { type: Date, default: null },
        decidedByUserId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
      delegation: {
        type: createEmbeddedDelegationSchema(),
        default: null,
      },
    },
    { _id: true }
  );
}

function createEmbeddedHandoverSchema() {
  return new mongoose.Schema(
    {
      status: {
        type: String,
        enum: Object.values(HANDOVER_STATUSES),
        default: HANDOVER_STATUSES.DRAFT,
      },
      managerEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      generalNotes: { type: String, default: "", trim: true, maxlength: 4000 },
      items: { type: [createHandoverItemSchema()], default: [] },
      createdByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      submittedAt: { type: Date, default: null },
      submittedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      approvedAt: { type: Date, default: null },
      approvedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      activatedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
      cancelReason: { type: String, default: "", trim: true, maxlength: 2000 },
      revisionReason: { type: String, default: "", trim: true, maxlength: 2000 },
      // Migration idempotency marker
      migratedFromHandoverId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      schemaVersion: { type: Number, default: 1 },
    },
    { _id: false }
  );
}

export function createLeaveRequestSchema() {
  const leaveRequestSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      leaveTypeCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
      },
      fromDate: {
        type: Date,
        required: true,
      },
      toDate: {
        type: Date,
        required: true,
      },
      daysCount: {
        type: Number,
        default: 1,
      },
      reason: {
        type: String,
        default: "",
        trim: true,
      },
      status: {
        type: String,
        enum: Object.values(LEAVE_STATUSES),
        default: LEAVE_STATUSES.PENDING,
        required: true,
        index: true,
      },
      decision: {
        decidedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        decidedAt: {
          type: Date,
          default: null,
        },
        remarks: {
          type: String,
          default: "",
          trim: true,
        },
      },
      /**
       * Phase 3: operational handover + temporary delegations.
       * Embedded on the leave request — not a separate collection.
       * Leave approval is never gated on this object.
       */
      handover: {
        type: createEmbeddedHandoverSchema(),
        default: null,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "leave_requests",
    }
  );

  leaveRequestSchema.index({ employeeId: 1, status: 1, fromDate: 1 });
  leaveRequestSchema.index({ status: 1, fromDate: 1 });
  leaveRequestSchema.index({ status: 1, fromDate: 1, toDate: 1 });
  // Overlap / on-leave-today patterns: toDate-led range scans
  leaveRequestSchema.index({ status: 1, toDate: 1, fromDate: 1 });
  leaveRequestSchema.index({ employeeId: 1, status: 1, toDate: 1, fromDate: 1 });
  leaveRequestSchema.index({ employeeId: 1, fromDate: 1 });
  leaveRequestSchema.index({ employeeId: 1, createdAt: -1 });
  leaveRequestSchema.index({ status: 1, createdAt: -1 });
  leaveRequestSchema.index({ leaveTypeCode: 1, status: 1, createdAt: -1 });
  leaveRequestSchema.index({ fromDate: 1, toDate: 1 });

  // Handover / delegation query support (tenant-scoped LeaveRequest queries)
  leaveRequestSchema.index({ "handover.status": 1 });
  leaveRequestSchema.index({ "handover.managerEmployeeId": 1, "handover.status": 1 });
  leaveRequestSchema.index({
    "handover.items.backupEmployeeId": 1,
    "handover.items.status": 1,
  });
  leaveRequestSchema.index({
    "handover.items.delegation.delegateEmployeeId": 1,
    "handover.items.delegation.status": 1,
  });
  leaveRequestSchema.index({
    "handover.items.taskId": 1,
    "handover.items.delegation.status": 1,
  });

  return leaveRequestSchema;
}

export function getLeaveRequestModel(connection) {
  return (
    connection.models.LeaveRequest ||
    connection.model("LeaveRequest", createLeaveRequestSchema())
  );
}

// Re-export constants for callers that previously imported from LeaveHandover model
export {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  DELEGATION_STATUSES,
  DELEGATION_END_REASONS,
};

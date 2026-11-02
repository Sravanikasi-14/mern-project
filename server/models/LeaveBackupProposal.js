import mongoose from "mongoose";

export const BACKUP_PROPOSAL_STATUSES = Object.freeze({
  PROPOSED: "PROPOSED",
  CLEARED: "CLEARED",
});

/**
 * Phase 2: proposed backup arrangements linked to a leave request + task.
 * Does NOT change Task.assigneeId. Phase 3 can promote these into handovers.
 */
export function createLeaveBackupProposalSchema() {
  const schema = new mongoose.Schema(
    {
      leaveRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeaveRequest",
        required: true,
        index: true,
      },
      originalEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Task",
        required: true,
      },
      proposedBackupEmployeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
      },
      proposedByUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      status: {
        type: String,
        enum: Object.values(BACKUP_PROPOSAL_STATUSES),
        default: BACKUP_PROPOSAL_STATUSES.PROPOSED,
      },
      explanationSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "leave_backup_proposals",
    }
  );

  schema.index({ leaveRequestId: 1, taskId: 1 }, { unique: true });
  schema.index({ proposedBackupEmployeeId: 1, status: 1 });

  return schema;
}

export function getLeaveBackupProposalModel(connection) {
  return (
    connection.models.LeaveBackupProposal ||
    connection.model("LeaveBackupProposal", createLeaveBackupProposalSchema())
  );
}

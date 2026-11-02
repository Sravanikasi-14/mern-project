/**
 * Compatibility shim — TaskDelegation is no longer a Mongo collection.
 * Temporary delegations are embedded on LeaveRequest.handover.items[].delegation.
 * @deprecated Import from ../constants/handoverConstants.js
 */
export {
  DELEGATION_STATUSES,
  DELEGATION_END_REASONS,
} from "../constants/handoverConstants.js";

export function createTaskDelegationSchema() {
  throw new Error(
    "TaskDelegation collection was removed. Use LeaveRequest.handover.items[].delegation via taskDelegationService."
  );
}

export function getTaskDelegationModel() {
  throw new Error(
    "TaskDelegation model was removed. Use LeaveRequest.handover.items[].delegation via taskDelegationService."
  );
}

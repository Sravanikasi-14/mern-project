/**
 * Compatibility shim — LeaveHandover is no longer a Mongo collection.
 * Handover data is embedded on LeaveRequest. Constants live in handoverConstants.
 * @deprecated Import from ../constants/handoverConstants.js or ../models/LeaveRequest.js
 */
export {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  HANDOVER_TRANSITIONS,
} from "../constants/handoverConstants.js";

export function createLeaveHandoverSchema() {
  throw new Error(
    "LeaveHandover collection was removed. Use LeaveRequest.handover (embedded) via leaveHandoverService."
  );
}

export function getLeaveHandoverModel() {
  throw new Error(
    "LeaveHandover model was removed. Use LeaveRequest.handover (embedded) via leaveHandoverService."
  );
}

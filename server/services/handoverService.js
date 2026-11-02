/**
 * Compatibility re-exports — prefer leaveHandoverService / taskDelegationService.
 * @deprecated
 */
export {
  createOrGetHandover,
  getHandoverById,
  getHandoverForLeave,
  updateHandoverDraft,
  submitHandover,
  respondToHandoverItem,
  reassignHandoverItemBackup,
  managerDecideHandover,
  coordinateHandoverCoverage,
  cancelHandover,
  listMyHandovers,
  listHandoversForHr,
  extendDelegation,
  onLeaveDecisionSideEffect,
  getActiveDelegationForActor,
  listCoveringTaskIds,
  listCoveringResponsibilitySummaries,
} from "./leaveHandoverService.js";

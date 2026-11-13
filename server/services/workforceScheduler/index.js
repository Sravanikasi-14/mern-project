/**
 * Hybrid Workforce Task Scheduling Engine
 * Isolated Work Management extension — Priority + Weighted Fair + Auto/Approval.
 *
 * Entry points:
 * - runSchedulerForAllCompanies / runCompanyScheduler (cron / manual)
 * - Pure helpers for unit tests (queue, priority, eligibility, workload, fairness, strategy)
 */

export {
  SCHEDULER_WEIGHTS,
  PRIORITY_RANK,
  DEADLINE_URGENCY,
  schedulerEnabled,
  schedulerMode,
  maxActiveTasks,
  autoAssignPriorities,
  lockTtlMs,
  companyConcurrency,
  schedulerBudgetMs,
  maxCompaniesPerInvocation,
} from "./config.js";

export { loadAssignableTaskQueue } from "./taskQueue.js";
export { resolveTaskPriorityScore, sortTasksByPriority } from "./priorityResolver.js";
export {
  loadEligibleEmployees,
  loadOnLeaveEmployeeIds,
  evaluateAssigneeEligibility,
  evaluateAssigneeEligibilitySync,
  assertAssigneeEligibleForTask,
  ELIGIBLE_EMPLOYEE_SELECT,
} from "./eligibility.js";
export { calculateWorkloadByEmployee, applyAssignmentToWorkload } from "./workload.js";
export { scoreEmployeeForTask, pickBestEmployee } from "./fairness.js";
export { decideAssignment, ASSIGNMENT_PATHS } from "./strategy.js";
export {
  recordPendingApproval,
  buildPendingApprovalMetadata,
  clearSchedulerProposal,
  SCHEDULER_PROPOSAL_STATUS,
} from "./approvalHandler.js";
export {
  runCompanyScheduler,
  runSchedulerForAllCompanies,
  acquireCompanySchedulerLock,
  releaseCompanySchedulerLock,
  orderCompaniesForScheduler,
  mapWithBoundedConcurrency,
} from "./executionController.js";
export {
  FLEET_STATE_ID,
  FLEET_COLLECTION,
  FLEET_WAVE_STALE_MS,
  beginOrResumeSchedulerWave,
  clearFleetProgress,
  companyNeedsSchedulerRun,
  loadFleetProgress,
  saveFleetProgress,
} from "./fleetProgress.js";

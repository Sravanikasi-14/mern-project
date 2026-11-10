import {
  autoAssignPriorities,
  maxActiveTasks,
  SCHEDULER_WEIGHTS,
} from "./config.js";
import { loadEligibleEmployees } from "./eligibility.js";
import { pickBestEmployee } from "./fairness.js";

export const ASSIGNMENT_PATHS = {
  AUTO: "AUTO",
  MANAGER_APPROVAL: "MANAGER_APPROVAL",
  NO_ELIGIBLE: "NO_ELIGIBLE",
};

/**
 * Decide assignment path for one prioritized task.
 * AUTO only when priority is in WORKFORCE_SCHEDULER_AUTO_PRIORITIES (default LOW,MEDIUM)
 * and a valid eligible candidate exists. HIGH/CRITICAL (and any non-auto priority) → approval.
 */
export async function decideAssignment(models, task, workloadByEmployee, options = {}) {
  const maxActive = options.maxActive ?? maxActiveTasks();
  const autoPriorities = options.autoPriorities ?? autoAssignPriorities();
  const weights = options.weights ?? SCHEDULER_WEIGHTS;

  const { eligible, rejected } = await loadEligibleEmployees(models, task, {
    maxActive,
    workloadByEmployee,
    company: options.company || null,
    now: options.now,
  });

  if (!eligible.length) {
    return {
      path: ASSIGNMENT_PATHS.NO_ELIGIBLE,
      taskId: String(task._id),
      reason: "no_eligible_employee",
      rejected,
      proposal: null,
    };
  }

  const best = pickBestEmployee(eligible, {
    task,
    workloadByEmployee,
    maxActive,
    weights,
  });

  if (!best) {
    return {
      path: ASSIGNMENT_PATHS.NO_ELIGIBLE,
      taskId: String(task._id),
      reason: "no_scored_candidate",
      rejected,
      proposal: null,
    };
  }

  const priority = String(task.priority || "MEDIUM").toUpperCase();
  const allowsAuto = autoPriorities.has(priority);

  const proposal = {
    taskId: String(task._id),
    employeeId: String(best.employee._id),
    employeeName: best.employee.fullName,
    score: best.score,
    components: best.components,
    taskPriority: task.priority,
  };

  if (!allowsAuto) {
    return {
      path: ASSIGNMENT_PATHS.MANAGER_APPROVAL,
      taskId: String(task._id),
      reason: "priority_requires_approval",
      rejected,
      proposal,
    };
  }

  return {
    path: ASSIGNMENT_PATHS.AUTO,
    taskId: String(task._id),
    reason: "eligible_routine",
    rejected,
    proposal,
  };
}

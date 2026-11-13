import { EMPLOYEE_STATUSES } from "../../models/Employee.js";
import { LEAVE_STATUSES } from "../../models/LeaveRequest.js";
import { getCompanyBusinessDate, resolveCompanyTimezone } from "../../utils/companyTime.js";
import { HttpError } from "../../utils/httpError.js";
import { maxActiveTasks } from "./config.js";
import { calculateWorkloadByEmployee } from "./workload.js";

export async function loadOnLeaveEmployeeIds(models, company, now = new Date()) {
  const { LeaveRequest } = models;
  if (!LeaveRequest) return new Set();
  const timezone = resolveCompanyTimezone(company);
  const todayCivil = getCompanyBusinessDate(now, timezone);
  if (!todayCivil) return new Set();

  const leaves = await LeaveRequest.find({
    status: LEAVE_STATUSES.APPROVED,
    fromDate: { $lte: new Date(`${todayCivil}T23:59:59.999Z`) },
    toDate: { $gte: new Date(`${todayCivil}T00:00:00.000Z`) },
  })
    .select("employeeId")
    .lean();

  return new Set(leaves.map((row) => String(row.employeeId)));
}

/** Lean ACTIVE roster fields needed for eligibility + fairness (F41 once-per-run cache). */
export const ELIGIBLE_EMPLOYEE_SELECT = "_id fullName email employeeCode skills job status";

/**
 * Active employees not on approved leave covering "today" in company timezone.
 * Skills: if task.requiredSkills is non-empty and employee.skills is empty,
 * employee is ineligible (never invent skills).
 *
 * Pass `employees` / `onLeaveIds` to reuse a per-company cache (F41) — scoring rules unchanged.
 */
export async function loadEligibleEmployees(
  models,
  task,
  {
    maxActive,
    workloadByEmployee,
    company = null,
    now = new Date(),
    employees = null,
    onLeaveIds = null,
  } = {}
) {
  const { Employee } = models;

  const roster =
    employees ||
    (await Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE })
      .select(ELIGIBLE_EMPLOYEE_SELECT)
      .lean());

  const leaveSet =
    onLeaveIds instanceof Set
      ? onLeaveIds
      : await loadOnLeaveEmployeeIds(models, company, now);

  const eligible = [];
  const rejected = [];

  for (const emp of roster) {
    const result = evaluateAssigneeEligibilitySync(task, emp, {
      maxActive,
      workloadByEmployee,
      onLeaveIds: leaveSet,
      enforceCapacity: true,
    });
    if (result.ok) {
      eligible.push(emp);
    } else {
      rejected.push({ employeeId: String(emp._id), reason: result.reason, ...result.detail });
    }
  }

  return { eligible, rejected };
}

/**
 * Pure/sync business checks when leave set + workload map are already loaded.
 */
export function evaluateAssigneeEligibilitySync(
  task,
  employee,
  {
    maxActive = maxActiveTasks(),
    workloadByEmployee = null,
    onLeaveIds = null,
    enforceCapacity = true,
  } = {}
) {
  if (!employee) {
    return { ok: false, reason: "employee_missing" };
  }

  if (employee.status && employee.status !== EMPLOYEE_STATUSES.ACTIVE) {
    return { ok: false, reason: "inactive_employee" };
  }

  if (onLeaveIds?.has(String(employee._id))) {
    return { ok: false, reason: "on_approved_leave" };
  }

  if (enforceCapacity) {
    const load = workloadByEmployee?.get(String(employee._id)) || { activeCount: 0 };
    if (load.activeCount >= maxActive) {
      return {
        ok: false,
        reason: "at_capacity",
        detail: { activeCount: load.activeCount, maxActive },
      };
    }
  }

  const required = (task?.requiredSkills || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  if (required.length) {
    const skills = (employee.skills || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    if (!skills.length) {
      return { ok: false, reason: "skills_unavailable" };
    }
    const matched = required.filter((skill) => skills.includes(skill));
    if (matched.length === 0) {
      return { ok: false, reason: "skills_mismatch" };
    }
  }

  return { ok: true };
}

/**
 * Business eligibility for assigning a task to an employee.
 * Does NOT check human authorization (HR/manager) — that remains in canAssignTask.
 */
export async function evaluateAssigneeEligibility(
  models,
  task,
  employee,
  {
    maxActive = maxActiveTasks(),
    workloadByEmployee = null,
    company = null,
    now = new Date(),
    enforceCapacity = true,
  } = {}
) {
  const onLeaveIds = await loadOnLeaveEmployeeIds(models, company, now);
  let loadMap = workloadByEmployee;
  if (enforceCapacity && !loadMap && employee?._id) {
    loadMap = await calculateWorkloadByEmployee(models, [employee._id]);
  }
  return evaluateAssigneeEligibilitySync(task, employee, {
    maxActive,
    workloadByEmployee: loadMap,
    onLeaveIds,
    enforceCapacity,
  });
}

const ELIGIBILITY_MESSAGES = Object.freeze({
  employee_missing: "Assignee employee is required.",
  inactive_employee: "Cannot assign tasks to inactive employees.",
  on_approved_leave: "Cannot assign tasks to an employee on approved leave.",
  at_capacity: "Employee is at maximum active task capacity.",
  skills_unavailable: "Employee has no recorded skills for this task's required skills.",
  skills_mismatch: "Employee skills do not match the task's required skills.",
});

/**
 * Throws HttpError(400) when business eligibility fails.
 */
export async function assertAssigneeEligibleForTask(models, task, employee, options = {}) {
  const result = await evaluateAssigneeEligibility(models, task, employee, options);
  if (result.ok) return result;
  throw new HttpError(400, ELIGIBILITY_MESSAGES[result.reason] || "Assignee is not eligible for this task.", {
    code: "ASSIGNEE_INELIGIBLE",
    reason: result.reason,
    ...(result.detail || {}),
  });
}

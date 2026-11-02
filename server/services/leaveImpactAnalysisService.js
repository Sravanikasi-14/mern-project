import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { TASK_STATUSES, TASK_PRIORITIES } from "../models/Task.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import {
  calculateLeaveDays,
  calculateEmployeeLeaveBalances,
  parseDateOnly,
  toDateString,
} from "./leaveService.js";
import { HttpError } from "../utils/httpError.js";

/** Working days after return used to surface upcoming deadline pressure (not blocking). */
const POST_LEAVE_LOOKAHEAD_DAYS = 7;

const OPEN_TASK_STATUSES = [
  TASK_STATUSES.ASSIGNED,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SUBMITTED,
  TASK_STATUSES.CHANGES_REQUESTED,
];

const COMPLETED_TASK_STATUSES = [TASK_STATUSES.APPROVED];

const PLANNING_CATEGORIES = Object.freeze({
  NONE: "NO_IMMEDIATE_COVERAGE_ACTION",
  SOME: "SOME_COORDINATION_NEEDED",
  CRITICAL: "CRITICAL_COVERAGE_DISCUSSION",
});

function dateOnlyMs(d) {
  const parsed = parseDateOnly(d);
  return parsed ? parsed.getTime() : null;
}

function addUtcDays(dateStr, days) {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

function isHighPriority(priority) {
  return priority === TASK_PRIORITIES.HIGH || priority === TASK_PRIORITIES.CRITICAL;
}

function summarizeTask(task) {
  return {
    _id: task._id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    deadline: toDateString(task.deadline),
    startDate: task.startDate ? toDateString(task.startDate) : null,
    projectName: task.projectName || "",
    department: task.department || "",
  };
}

/**
 * Classify open tasks relative to a leave window.
 * Does not mutate tasks. Does not treat every assignment as impacted.
 */
export function classifyTasksForLeave(tasks, leaveFrom, leaveTo) {
  const fromMs = dateOnlyMs(leaveFrom);
  const toMs = dateOnlyMs(leaveTo);
  const afterLeaveStr = addUtcDays(leaveTo, POST_LEAVE_LOOKAHEAD_DAYS);
  const afterLeaveMs = dateOnlyMs(afterLeaveStr);

  const buckets = {
    requiresAttentionBeforeLeave: [],
    requiresCoverageDuringLeave: [],
    canWaitUntilReturn: [],
    alreadyCompleted: [],
    overdueOpen: [],
    upcomingDependencies: [],
  };

  const missing = [];
  let tasksWithoutUsableDeadline = 0;

  for (const task of tasks || []) {
    const status = task.status;
    if (COMPLETED_TASK_STATUSES.includes(status)) {
      buckets.alreadyCompleted.push(summarizeTask(task));
      continue;
    }
    if (status === TASK_STATUSES.REJECTED) {
      // Closed without delivery — not an active coverage item for this leave window.
      continue;
    }
    if (!OPEN_TASK_STATUSES.includes(status)) {
      continue;
    }

    const deadlineMs = dateOnlyMs(task.deadline);
    if (deadlineMs == null) {
      tasksWithoutUsableDeadline += 1;
      continue;
    }

    const startMs = task.startDate ? dateOnlyMs(task.startDate) : null;
    const overlapsLeave =
      (deadlineMs >= fromMs && deadlineMs <= toMs) ||
      (startMs != null && startMs <= toMs && (deadlineMs >= fromMs || startMs >= fromMs));

    if (deadlineMs < fromMs) {
      buckets.overdueOpen.push(summarizeTask(task));
      buckets.requiresAttentionBeforeLeave.push(summarizeTask(task));
      continue;
    }

    if (deadlineMs >= fromMs && deadlineMs <= toMs) {
      if (isHighPriority(task.priority) || status === TASK_STATUSES.SUBMITTED) {
        buckets.requiresAttentionBeforeLeave.push(summarizeTask(task));
      }
      buckets.requiresCoverageDuringLeave.push(summarizeTask(task));
      continue;
    }

    if (startMs != null && startMs >= fromMs && startMs <= toMs && deadlineMs > toMs) {
      buckets.requiresCoverageDuringLeave.push(summarizeTask(task));
      continue;
    }

    if (deadlineMs > toMs && afterLeaveMs != null && deadlineMs <= afterLeaveMs) {
      buckets.upcomingDependencies.push(summarizeTask(task));
      buckets.canWaitUntilReturn.push(summarizeTask(task));
      continue;
    }

    if (deadlineMs > toMs) {
      buckets.canWaitUntilReturn.push(summarizeTask(task));
      continue;
    }

    if (overlapsLeave) {
      buckets.requiresCoverageDuringLeave.push(summarizeTask(task));
    }
  }

  if (tasksWithoutUsableDeadline > 0) {
    missing.push({
      code: "TASK_DEADLINE_MISSING",
      message: `${tasksWithoutUsableDeadline} open task(s) could not be classified because a usable deadline was missing.`,
    });
  }

  // Deduplicate by id within each bucket (overdue also appears in attention)
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((t) => {
      const key = String(t._id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    requiresAttentionBeforeLeave: dedupe(buckets.requiresAttentionBeforeLeave),
    requiresCoverageDuringLeave: dedupe(buckets.requiresCoverageDuringLeave),
    canWaitUntilReturn: dedupe(buckets.canWaitUntilReturn),
    alreadyCompleted: dedupe(buckets.alreadyCompleted),
    overdueOpen: dedupe(buckets.overdueOpen),
    upcomingDependencies: dedupe(buckets.upcomingDependencies),
    missingInformation: missing,
  };
}

function resolvePlanningCategory(classified) {
  const criticalDuring = (classified.requiresCoverageDuringLeave || []).some(
    (t) => t.priority === TASK_PRIORITIES.CRITICAL
  );
  const highDuring = (classified.requiresCoverageDuringLeave || []).some((t) =>
    isHighPriority(t.priority)
  );
  const coverageCount = classified.requiresCoverageDuringLeave.length;
  const attentionCount = classified.requiresAttentionBeforeLeave.length;

  if (criticalDuring || (highDuring && coverageCount >= 2)) {
    return {
      code: PLANNING_CATEGORIES.CRITICAL,
      label: "Critical responsibilities require a coverage discussion",
      guidance:
        "The reporting manager may wish to review the following dependencies and agree who will cover them while the employee is away.",
    };
  }
  if (coverageCount > 0 || attentionCount > 0 || classified.upcomingDependencies.length > 0) {
    return {
      code: PLANNING_CATEGORIES.SOME,
      label: "Some responsibilities may need coordination",
      guidance:
        "A few responsibilities may need coverage during this period. Consider coordinating the following tasks before the leave begins.",
    };
  }
  return {
    code: PLANNING_CATEGORIES.NONE,
    label: "No immediate coverage action identified",
    guidance:
      "Based on current open work, no urgent coverage actions were identified. These activities can continue after the employee returns where needed.",
  };
}

function buildSuggestedNextSteps(classified, planning, hasManager) {
  const steps = [];
  if (hasManager) {
    steps.push("Discuss coverage with the reporting manager where helpful.");
  } else {
    steps.push("Identify a coordinator for the team while the employee is away (reporting manager is not set).");
  }
  if (classified.requiresAttentionBeforeLeave.length > 0) {
    steps.push("Consider completing or preparing high-priority items before leave begins.");
  }
  if (classified.requiresCoverageDuringLeave.length > 0) {
    steps.push("Coordinate responsibilities with the team for work due during the leave period.");
  }
  if (classified.upcomingDependencies.length > 0) {
    steps.push("Review upcoming deadlines shortly after return so handoffs stay clear.");
  }
  if (classified.overdueOpen.length > 0) {
    steps.push("Review overdue open work separately from this leave entitlement decision.");
  }
  if (planning.code === PLANNING_CATEGORIES.NONE) {
    steps.push("No mandatory handover is required to approve this leave request.");
  } else {
    steps.push("Use this overview for planning only — it does not change leave eligibility or approval rights.");
  }
  return steps;
}

/**
 * Operational leave impact analysis (independent of leave eligibility).
 *
 * @param {object} companyContext - { models, company }
 * @param {string} employeeId
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @param {object} [options]
 * @param {string} [options.leaveRequestId] - exclude this request from pending overlap counts
 */
export async function analyzeLeaveImpact(companyContext, employeeId, startDate, endDate, options = {}) {
  const { models, company } = companyContext || {};
  const { Employee, LeaveRequest, Task, CompanyHrPolicy } = models || {};

  if (!Employee || !LeaveRequest) {
    throw new HttpError(500, "Company context is incomplete for leave impact analysis.");
  }
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new HttpError(400, "Invalid employee id.");
  }

  const fromStr = toDateString(startDate);
  const toStr = toDateString(endDate);
  if (!fromStr || !toStr || parseDateOnly(fromStr) > parseDateOnly(toStr)) {
    throw new HttpError(400, "A valid leave date range is required.");
  }

  const employee = await Employee.findById(employeeId)
    .populate("job.reportingManagerId", "fullName employeeCode job.jobTitle job.department")
    .lean();
  if (!employee) {
    throw new HttpError(404, "Employee not found.");
  }

  const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
  const { workingDays, calendarDays } = calculateLeaveDays(fromStr, toStr, policy);

  const missingInformation = [];
  const department = employee.job?.department || "";
  if (!department) {
    missingInformation.push({
      code: "DEPARTMENT_MISSING",
      message: "Department is not set on the employee record; team availability is limited.",
    });
  }

  const manager = employee.job?.reportingManagerId;
  if (!manager) {
    missingInformation.push({
      code: "REPORTING_MANAGER_MISSING",
      message: "Reporting manager is not set; coverage discussion owner is unclear.",
    });
  }

  // --- Eligibility snapshot (reuse existing balance logic; does not decide approval) ---
  const leaveBalance = await calculateEmployeeLeaveBalances(employee, policy, LeaveRequest);
  const eligibility = {
    leaveBalance,
    workingDaysInRequest: workingDays,
    calendarDaysInRequest: calendarDays,
    note: "Eligibility reflects policy balances and working-day rules. It is separate from operational continuity planning.",
  };

  // --- Tasks (date-filtered; assignee scoped) ---
  let classified = {
    requiresAttentionBeforeLeave: [],
    requiresCoverageDuringLeave: [],
    canWaitUntilReturn: [],
    alreadyCompleted: [],
    overdueOpen: [],
    upcomingDependencies: [],
    missingInformation: [],
  };
  let relevantTaskTotal = 0;

  if (!Task) {
    missingInformation.push({
      code: "TASK_MODULE_UNAVAILABLE",
      message: "Work Management tasks are not available in this workspace; responsibility analysis is incomplete.",
    });
  } else {
    const lookaheadEnd = addUtcDays(toStr, POST_LEAVE_LOOKAHEAD_DAYS);
    const windowStart = parseDateOnly(fromStr);
    // Include overdue open work: deadline before leave start
    const tasks = await Task.find({
      assigneeId: employee._id,
      status: { $in: [...OPEN_TASK_STATUSES, ...COMPLETED_TASK_STATUSES] },
      $or: [
        { deadline: { $lte: parseDateOnly(lookaheadEnd) } },
        {
          startDate: {
            $gte: windowStart,
            $lte: parseDateOnly(toStr),
          },
        },
      ],
    })
      .select("title priority status deadline startDate projectName department")
      .sort({ deadline: 1 })
      .limit(200)
      .lean();

    relevantTaskTotal = tasks.length;
    classified = classifyTasksForLeave(tasks, fromStr, toStr);
    missingInformation.push(...classified.missingInformation);

    // Task dependency graph is not modelled — document limitation clearly.
    missingInformation.push({
      code: "TASK_DEPENDENCIES_NOT_MODELLED",
      message:
        "Cross-task dependency links are not stored in Work Management; upcoming deadlines are used as a proxy for near-term coordination needs.",
    });
  }

  // --- Department availability (neutral staffing overview) ---
  const fromDate = parseDateOnly(fromStr);
  const toDate = parseDateOnly(toStr);
  const deptFilter = department
    ? { "job.department": department, status: EMPLOYEE_STATUSES.ACTIVE }
    : { _id: employee._id }; // fallback: only self if no department

  const departmentEmployees = department
    ? await Employee.find(deptFilter).select("_id fullName employeeCode").lean()
    : [];
  const departmentEmployeeIds = departmentEmployees.map((e) => e._id);
  const totalDepartmentEmployees = department
    ? departmentEmployees.length
    : await Employee.countDocuments({ status: EMPLOYEE_STATUSES.ACTIVE });

  const overlapQueryBase = {
    employeeId: { $in: departmentEmployeeIds.length ? departmentEmployeeIds : [employee._id] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  };

  const [approvedOverlaps, pendingOverlaps] = await Promise.all([
    LeaveRequest.find({ ...overlapQueryBase, status: LEAVE_STATUSES.APPROVED })
      .select("employeeId fromDate toDate leaveTypeCode status")
      .lean(),
    LeaveRequest.find({ ...overlapQueryBase, status: LEAVE_STATUSES.PENDING })
      .select("employeeId fromDate toDate leaveTypeCode status")
      .lean(),
  ]);

  const excludeId = options.leaveRequestId ? String(options.leaveRequestId) : null;
  const excludeEmployeeId = String(employee._id);

  const mapOverlap = (rows, statusLabel) =>
    rows
      .filter((r) => String(r.employeeId) !== excludeEmployeeId)
      .filter((r) => (excludeId ? String(r._id) !== excludeId : true))
      .map((r) => {
        const peer = departmentEmployees.find((e) => String(e._id) === String(r.employeeId));
        return {
          leaveRequestId: r._id,
          employeeCode: peer?.employeeCode || null,
          employeeName: peer?.fullName || "Colleague",
          fromDate: toDateString(r.fromDate),
          toDate: toDateString(r.toDate),
          leaveTypeCode: r.leaveTypeCode,
          status: statusLabel,
          // reason intentionally omitted — privacy
        };
      });

  const approvedAway = mapOverlap(approvedOverlaps, LEAVE_STATUSES.APPROVED);
  const pendingAway = mapOverlap(pendingOverlaps, LEAVE_STATUSES.PENDING);

  // Unique employees on approved leave (not counting requestor)
  const approvedEmployeeIds = new Set(
    approvedOverlaps
      .filter((r) => String(r.employeeId) !== excludeEmployeeId)
      .map((r) => String(r.employeeId))
  );

  const peersExcludingRequestor = Math.max(0, (department ? totalDepartmentEmployees : 1) - 1);
  const employeesAvailableDuringPeriod = Math.max(0, peersExcludingRequestor - approvedEmployeeIds.size);

  const holidaysInRange = (policy?.holidays || [])
    .map((h) => ({ name: h.name, date: toDateString(h.date), type: h.type }))
    .filter((h) => h.date && h.date >= fromStr && h.date <= toStr);

  const planning = resolvePlanningCategory(classified);
  const suggestedNextSteps = buildSuggestedNextSteps(classified, planning, Boolean(manager));

  return {
    analyzedAt: new Date().toISOString(),
    companySlug: company?.slug || null,
    employee: {
      _id: employee._id,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
      department: department || null,
      jobTitle: employee.job?.jobTitle || null,
      reportingManager: manager
        ? {
            _id: manager._id,
            fullName: manager.fullName,
            employeeCode: manager.employeeCode,
            jobTitle: manager.job?.jobTitle || null,
          }
        : null,
    },
    leaveWindow: {
      fromDate: fromStr,
      toDate: toStr,
      workingDays,
      calendarDays,
    },
    eligibility,
    planningCategory: planning,
    responsibilities: {
      totalRelevantTasks: relevantTaskTotal,
      requiresAttentionBeforeLeave: classified.requiresAttentionBeforeLeave,
      requiresCoverageDuringLeave: classified.requiresCoverageDuringLeave,
      canWaitUntilReturn: classified.canWaitUntilReturn,
      alreadyCompleted: classified.alreadyCompleted,
      overdueOpen: classified.overdueOpen,
      upcomingDependencies: classified.upcomingDependencies,
      counts: {
        attentionBeforeLeave: classified.requiresAttentionBeforeLeave.length,
        coverageDuringLeave: classified.requiresCoverageDuringLeave.length,
        canWaitUntilReturn: classified.canWaitUntilReturn.length,
        alreadyCompleted: classified.alreadyCompleted.length,
        overdueOpen: classified.overdueOpen.length,
        upcomingDependencies: classified.upcomingDependencies.length,
      },
    },
    teamAvailability: {
      department: department || null,
      totalDepartmentEmployees: department ? totalDepartmentEmployees : null,
      employeesAvailableDuringPeriod: department ? employeesAvailableDuringPeriod : null,
      employeesOnApprovedLeave: approvedAway,
      pendingOverlappingLeaveRequests: pendingAway,
      note: "Pending leave is not treated as confirmed absence. Colleague leave reasons are not shown.",
      workingDaysInPeriod: workingDays,
      holidaysInPeriod: holidaysInRange,
      weekendRules: policy?.weekendRules || { saturdayOff: true, sundayOff: true },
    },
    suggestedNextSteps,
    missingInformation: missingInformation.filter(
      // keep TASK_DEPENDENCIES note once
      (item, idx, arr) => arr.findIndex((x) => x.code === item.code) === idx
    ),
    // Explicit non-decisions for consumers / future phases
    doesNot: {
      autoApprove: true,
      autoReject: true,
      blockApproval: true,
      requireHandover: true,
      reassignTasks: true,
    },
  };
}

export { PLANNING_CATEGORIES, POST_LEAVE_LOOKAHEAD_DAYS };

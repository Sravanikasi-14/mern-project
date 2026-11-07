import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { LEAVE_STATUSES } from "../models/LeaveRequest.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../models/Task.js";
import { BACKUP_PROPOSAL_STATUSES } from "../models/LeaveBackupProposal.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
} from "../constants/handoverConstants.js";
import { analyzeLeaveImpact } from "./leaveImpactAnalysisService.js";
import { parseDateOnly, toDateString } from "./leaveService.js";
import { HttpError } from "../utils/httpError.js";
import { filterEmployeeListByScope } from "./hrAccessEnforcementService.js";

const HANDOVER_EDITABLE_FOR_PROPOSAL = new Set([
  HANDOVER_STATUSES.DRAFT,
  HANDOVER_STATUSES.NEEDS_REVISION,
]);

/**
 * Sync a Phase-2 proposal onto a matching draft handover item (if any).
 * Does not submit handover, acknowledge, or create delegations.
 */
async function syncProposalToHandoverDraft(LeaveRequest, leaveRequestId, taskId, backupEmployeeId) {
  const leave = await LeaveRequest.findById(leaveRequestId);
  if (!leave?.handover?.status) return { synced: false };
  if (!HANDOVER_EDITABLE_FOR_PROPOSAL.has(leave.handover.status)) {
    return { synced: false, reason: "Handover is past draft — proposal stored only." };
  }

  const item = (leave.handover.items || []).find(
    (it) => String(it.taskId) === String(taskId) && it.status !== HANDOVER_ITEM_STATUSES.CANCELLED
  );
  if (!item) return { synced: false, reason: "No matching handover responsibility." };

  if (backupEmployeeId && String(backupEmployeeId) === String(leave.employeeId)) {
    throw new HttpError(400, "An employee cannot be proposed as their own backup.");
  }

  item.backupEmployeeId = backupEmployeeId || null;
  if (leave.handover.status === HANDOVER_STATUSES.DRAFT) {
    item.status = HANDOVER_ITEM_STATUSES.DRAFT;
  }
  item.backupResponse = {
    decision: null,
    comment: "",
    respondedAt: null,
    respondedByUserId: null,
  };
  leave.markModified("handover");
  await leave.save();
  return { synced: true };
}

/** Configurable scoring weights (normalized when factors are unavailable). */
export const BACKUP_SCORE_WEIGHTS = Object.freeze({
  skill: 0.4,
  availability: 0.25,
  workload: 0.2,
  role: 0.15,
});

const OPEN_TASK_STATUSES = [
  TASK_STATUSES.ASSIGNED,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.SUBMITTED,
  TASK_STATUSES.CHANGES_REQUESTED,
];

const SUITABILITY = Object.freeze({
  SKILL_MATCH_VERIFIED: "SKILL_MATCH_VERIFIED",
  AVAILABILITY_MATCH: "AVAILABILITY_MATCH",
  WORKLOAD_MATCH: "WORKLOAD_MATCH",
  INCOMPLETE_INFORMATION: "INCOMPLETE_INFORMATION",
  // Legacy codes retained for older clients / snapshots
  STRONG: "STRONG_MATCH",
  POSSIBLE: "POSSIBLE_MATCH",
  LIMITED: "LIMITED_MATCH",
});

/**
 * Transparent suitability label from assessed evidence only.
 * Never claims a skill match when skill data is unavailable.
 */
export function buildSuitabilityLabel(parts = {}) {
  const skill = parts.skill || {};
  const availability = parts.availability || {};
  const workload = parts.workload || {};

  if (skill.assessed && skill.score != null && skill.score >= 0.5) {
    return {
      code: SUITABILITY.SKILL_MATCH_VERIFIED,
      label: "Skill match verified",
    };
  }

  if (!skill.assessed) {
    return {
      code: SUITABILITY.INCOMPLETE_INFORMATION,
      label: "Incomplete information",
    };
  }

  if (availability.assessed && availability.available) {
    return {
      code: SUITABILITY.AVAILABILITY_MATCH,
      label: "Availability match",
    };
  }

  if (workload.assessed && workload.score != null && workload.score >= 0.5) {
    return {
      code: SUITABILITY.WORKLOAD_MATCH,
      label: "Workload match",
    };
  }

  return {
    code: SUITABILITY.INCOMPLETE_INFORMATION,
    label: "Incomplete information",
  };
}

function normalizeSkill(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function skillSets(list) {
  return new Set((list || []).map(normalizeSkill).filter(Boolean));
}

/**
 * Skill compatibility. Returns null assessment when data is missing (not a silent match).
 */
export function assessSkillMatch(requiredSkills, candidateSkills) {
  const required = skillSets(requiredSkills);
  const have = skillSets(candidateSkills);

  if (required.size === 0) {
    return {
      assessed: false,
      score: null,
      matched: [],
      missing: [],
      explanation: "Task skill requirements are not recorded; skill matching is unavailable.",
    };
  }
  if (have.size === 0) {
    return {
      assessed: false,
      score: null,
      matched: [],
      missing: [...required],
      explanation: "Candidate has no recorded skills; skill matching is unavailable.",
    };
  }

  const matched = [...required].filter((s) => have.has(s));
  const missing = [...required].filter((s) => !have.has(s));
  const score = matched.length / required.size;

  return {
    assessed: true,
    score,
    matched,
    missing,
    explanation:
      matched.length === required.size
        ? "Recorded skills cover the task requirements."
        : matched.length > 0
          ? `Partial skill overlap (${matched.length}/${required.size} required tags).`
          : "No overlap between recorded skills and task requirements.",
  };
}

/**
 * Role / department relevance without inventing skills.
 */
export function assessRoleRelevance(task, originalEmployee, candidate) {
  const reasons = [];
  let score = 0.35; // baseline for any active peer

  const sameDept =
    Boolean(originalEmployee?.job?.department) &&
    originalEmployee.job.department === candidate.job?.department;
  const taskDept = (task.department || "").trim();
  const candidateDept = (candidate.job?.department || "").trim();

  if (sameDept) {
    score += 0.35;
    reasons.push("Same department as the employee on leave.");
  } else if (taskDept && candidateDept && taskDept === candidateDept) {
    score += 0.3;
    reasons.push("Matches the task department.");
  } else if (candidateDept) {
    reasons.push("Cross-department candidate — useful when skills and permissions allow.");
  }

  const titleA = (originalEmployee?.job?.jobTitle || "").toLowerCase();
  const titleB = (candidate.job?.jobTitle || "").toLowerCase();
  if (titleA && titleB && (titleA === titleB || titleA.includes(titleB) || titleB.includes(titleA))) {
    score += 0.2;
    reasons.push("Similar designation.");
  }

  const project = (task.projectName || "").trim();
  if (project && candidate.job?.project?.projectName === project) {
    score += 0.1;
    reasons.push("Aligned to the same project.");
  }

  return {
    assessed: true,
    score: Math.min(1, score),
    explanation: reasons.join(" ") || "Limited role-context information available.",
  };
}

/**
 * Workload for the coverage window. Completed/rejected tasks excluded.
 */
export function assessWorkload(candidateTasks, coverageFrom, coverageTo) {
  const fromMs = parseDateOnly(coverageFrom)?.getTime();
  const toMs = parseDateOnly(coverageTo)?.getTime();
  let active = 0;
  let highPriority = 0;
  let overdue = 0;
  let overlapping = 0;

  for (const t of candidateTasks || []) {
    if (!OPEN_TASK_STATUSES.includes(t.status)) continue;
    active += 1;
    if (t.priority === TASK_PRIORITIES.HIGH || t.priority === TASK_PRIORITIES.CRITICAL) {
      highPriority += 1;
    }
    const deadlineMs = parseDateOnly(t.deadline)?.getTime();
    if (deadlineMs != null && fromMs != null && deadlineMs < fromMs) overdue += 1;
    if (
      deadlineMs != null &&
      fromMs != null &&
      toMs != null &&
      deadlineMs >= fromMs &&
      deadlineMs <= toMs
    ) {
      overlapping += 1;
    }
  }

  // Higher load → lower score
  let penalty = active * 0.08 + highPriority * 0.1 + overdue * 0.12 + overlapping * 0.1;
  const score = Math.max(0, 1 - Math.min(1, penalty));

  let explanation = "Manageable current workload.";
  if (active === 0) explanation = "No open assigned tasks in the current workload sample.";
  else if (score < 0.45) explanation = "Higher existing workload — coverage may need extra coordination.";
  else if (score < 0.7) explanation = "Moderate existing workload during the coverage period.";

  return {
    assessed: true,
    score,
    activeOpenTasks: active,
    highPriorityOpenTasks: highPriority,
    overdueOpenTasks: overdue,
    overlappingDeadlines: overlapping,
    explanation,
  };
}

/** @deprecated Prefer buildSuitabilityLabel(parts) — kept for score-only callers. */
function suitabilityFromScore(score, incomplete) {
  if (incomplete || score == null) {
    return { code: SUITABILITY.INCOMPLETE_INFORMATION, label: "Incomplete information" };
  }
  if (score >= 0.75) return { code: SUITABILITY.SKILL_MATCH_VERIFIED, label: "Skill match verified" };
  if (score >= 0.55) return { code: SUITABILITY.AVAILABILITY_MATCH, label: "Availability match" };
  return { code: SUITABILITY.WORKLOAD_MATCH, label: "Workload match" };
}

function combineScores(parts) {
  const usable = [];
  if (parts.skill.assessed && parts.skill.score != null) {
    usable.push({ weight: BACKUP_SCORE_WEIGHTS.skill, score: parts.skill.score });
  }
  // Availability is eligibility; when included as assessed available, score = 1
  if (parts.availability.assessed && parts.availability.available) {
    usable.push({ weight: BACKUP_SCORE_WEIGHTS.availability, score: 1 });
  }
  if (parts.workload.assessed && parts.workload.score != null) {
    usable.push({ weight: BACKUP_SCORE_WEIGHTS.workload, score: parts.workload.score });
  }
  if (parts.role.assessed && parts.role.score != null) {
    usable.push({ weight: BACKUP_SCORE_WEIGHTS.role, score: parts.role.score });
  }

  if (usable.length === 0) return { score: null, incomplete: true };

  const weightSum = usable.reduce((s, u) => s + u.weight, 0);
  const score = usable.reduce((s, u) => s + (u.weight / weightSum) * u.score, 0);
  const incomplete = !parts.skill.assessed;
  return { score, incomplete };
}

/**
 * recommendBackupEmployees — task-level candidates for a leave coverage window.
 */
export async function recommendBackupEmployees(
  companyContext,
  employeeId,
  taskId,
  leaveStartDate,
  leaveEndDate,
  options = {}
) {
  const { models } = companyContext || {};
  const { Employee, LeaveRequest, Task, User } = models || {};
  if (!Employee || !Task || !LeaveRequest) {
    throw new HttpError(500, "Company context is incomplete for backup recommendations.");
  }
  if (!mongoose.Types.ObjectId.isValid(employeeId) || !mongoose.Types.ObjectId.isValid(taskId)) {
    throw new HttpError(400, "Invalid employee or task id.");
  }

  const fromStr = toDateString(leaveStartDate);
  const toStr = toDateString(leaveEndDate);
  if (!fromStr || !toStr) throw new HttpError(400, "Valid leave dates are required.");

  const [originalEmployee, task] = await Promise.all([
    Employee.findById(employeeId).lean(),
    Task.findById(taskId).lean(),
  ]);
  if (!originalEmployee) throw new HttpError(404, "Employee not found.");
  if (!task) throw new HttpError(404, "Task not found.");

  const coverageFrom = fromStr;
  const coverageTo = toDateString(task.deadline) && toDateString(task.deadline) < toStr
    ? toDateString(task.deadline)
    : toStr;
  // coverage window: leave start through earlier of leave end / task deadline
  const windowFrom = coverageFrom;
  const windowTo =
    toDateString(task.deadline) && parseDateOnly(toDateString(task.deadline)) <= parseDateOnly(toStr)
      ? toDateString(task.deadline)
      : toStr;

  const fromDate = parseDateOnly(windowFrom);
  const toDate = parseDateOnly(windowTo);

  // Candidate pool: active employees in tenant (exclude leave-taker)
  const candidatePool = await Employee.find({
    _id: { $ne: originalEmployee._id },
    status: EMPLOYEE_STATUSES.ACTIVE,
  })
    .select("fullName employeeCode email job skills userId status")
    .limit(200)
    .lean();
  const candidates = filterEmployeeListByScope(companyContext.hrAccess, candidatePool);

  const candidateIds = candidates.map((c) => c._id);
  const userIds = candidates.map((c) => c.userId).filter(Boolean);

  const [approvedLeaves, pendingLeaves, openTasks, users] = await Promise.all([
    LeaveRequest.find({
      employeeId: { $in: candidateIds },
      status: LEAVE_STATUSES.APPROVED,
      fromDate: { $lte: toDate },
      toDate: { $gte: fromDate },
    })
      .select("employeeId fromDate toDate")
      .lean(),
    LeaveRequest.find({
      employeeId: { $in: candidateIds },
      status: LEAVE_STATUSES.PENDING,
      fromDate: { $lte: toDate },
      toDate: { $gte: fromDate },
    })
      .select("employeeId fromDate toDate")
      .lean(),
    Task.find({
      assigneeId: { $in: candidateIds },
      status: { $in: OPEN_TASK_STATUSES },
    })
      .select("assigneeId status priority deadline")
      .limit(1000)
      .lean(),
    User && userIds.length
      ? User.find({ _id: { $in: userIds } }).select("_id isActive role").lean()
      : Promise.resolve([]),
  ]);

  const userById = new Map((users || []).map((u) => [String(u._id), u]));
  const approvedByEmp = new Map();
  for (const row of approvedLeaves) {
    const key = String(row.employeeId);
    if (!approvedByEmp.has(key)) approvedByEmp.set(key, []);
    approvedByEmp.get(key).push(row);
  }
  const pendingByEmp = new Map();
  for (const row of pendingLeaves) {
    const key = String(row.employeeId);
    if (!pendingByEmp.has(key)) pendingByEmp.set(key, []);
    pendingByEmp.get(key).push(row);
  }
  const tasksByEmp = new Map();
  for (const t of openTasks) {
    const key = String(t.assigneeId);
    if (!tasksByEmp.has(key)) tasksByEmp.set(key, []);
    tasksByEmp.get(key).push(t);
  }

  const recommendations = [];
  const excluded = [];

  const leaveTakerId = String(originalEmployee._id);

  for (const candidate of candidates) {
    const id = String(candidate._id);

    // Critical: never recommend the leave requester as their own backup
    if (id === leaveTakerId) {
      excluded.push({
        employeeId: candidate._id,
        reason: "Leave requester cannot be their own backup.",
      });
      continue;
    }

    if (candidate.status !== EMPLOYEE_STATUSES.ACTIVE) {
      excluded.push({ employeeId: candidate._id, reason: "Employee is not active." });
      continue;
    }

    // Exclude deactivated linked users
    if (candidate.userId) {
      const user = userById.get(String(candidate.userId));
      if (user && user.isActive === false) {
        excluded.push({ employeeId: candidate._id, reason: "Linked user account is inactive." });
        continue;
      }
    }

    const approvedOverlap = approvedByEmp.get(id) || [];
    if (approvedOverlap.length > 0) {
      excluded.push({
        employeeId: candidate._id,
        fullName: candidate.fullName,
        reason: "On approved leave overlapping the coverage period.",
      });
      continue;
    }

    const pendingOverlap = pendingByEmp.get(id) || [];
    const skill = assessSkillMatch(task.requiredSkills, candidate.skills);
    const role = assessRoleRelevance(task, originalEmployee, candidate);
    const workload = assessWorkload(tasksByEmp.get(id) || [], windowFrom, windowTo);
    const availability = {
      assessed: true,
      available: true,
      pendingLeaveOverlaps: pendingOverlap.length,
      explanation:
        pendingOverlap.length > 0
          ? "Available based on approved leave; has pending leave overlapping this period (not treated as confirmed absence)."
          : "Available during the coverage period (no overlapping approved leave).",
    };

    const parts = { skill, availability, workload, role };
    const { score, incomplete } = combineScores(parts);
    if (score == null || score < 0.28) {
      // Keep very weak matches out unless options.includeWeak
      if (!options.includeWeak) continue;
    }

    const suitability = buildSuitabilityLabel(parts);
    recommendations.push({
      employee: {
        _id: candidate._id,
        fullName: candidate.fullName,
        employeeCode: candidate.employeeCode,
        department: candidate.job?.department || null,
        jobTitle: candidate.job?.jobTitle || null,
      },
      suitability,
      score: score == null ? null : Math.round(score * 1000) / 1000,
      incompleteAssessment: Boolean(incomplete),
      factors: {
        skill,
        availability,
        workload,
        role,
      },
      why: [
        skill.explanation,
        availability.explanation,
        workload.explanation,
        role.explanation,
      ].filter(Boolean).slice(0, 4),
    });
  }

  recommendations.sort((a, b) => {
    const sa = a.score == null ? -1 : a.score;
    const sb = b.score == null ? -1 : b.score;
    if (sb !== sa) return sb - sa;
    return a.employee.fullName.localeCompare(b.employee.fullName);
  });

  // Final safety net: never return the leave requester
  const top = recommendations
    .filter((r) => String(r.employee._id) !== leaveTakerId)
    .slice(0, options.limit || 5);

  return {
    task: {
      _id: task._id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      deadline: toDateString(task.deadline),
      requiredSkills: task.requiredSkills || [],
      department: task.department || "",
      projectName: task.projectName || "",
    },
    coverageWindow: { fromDate: windowFrom, toDate: windowTo },
    recommendations: top,
    noSuitableCandidate: top.length === 0,
    message:
      top.length === 0
        ? "No suitable backup identified with the currently available information."
        : null,
    excludedUnavailableCount: excluded.length,
  };
}

/**
 * Build backup suggestions for all Phase-1 coverage responsibilities on a leave request.
 */
export async function recommendBackupsForLeaveRequest(companyContext, leaveRequestId) {
  const { models } = companyContext || {};
  const { LeaveRequest, LeaveBackupProposal } = models || {};
  if (!LeaveRequest) throw new HttpError(500, "Leave models unavailable.");

  const leaveRequest = await LeaveRequest.findById(leaveRequestId).lean();
  if (!leaveRequest) throw new HttpError(404, "Leave request not found");

  const impact = await analyzeLeaveImpact(
    companyContext,
    leaveRequest.employeeId,
    leaveRequest.fromDate,
    leaveRequest.toDate,
    { leaveRequestId: leaveRequest._id }
  );

  const coverageTasks = impact.responsibilities?.requiresCoverageDuringLeave || [];
  const canWait = impact.responsibilities?.canWaitUntilReturn || [];

  const arrangements = [];
  const cumulativeLoad = new Map(); // employeeId -> count of primary recommendations

  for (const taskSummary of coverageTasks) {
    const result = await recommendBackupEmployees(
      companyContext,
      leaveRequest.employeeId,
      taskSummary._id,
      leaveRequest.fromDate,
      leaveRequest.toDate,
      { limit: 5 }
    );

    // Soft-penalize candidates already primary on other tasks (display note only; re-sort lightly)
    const adjusted = result.recommendations.map((rec) => {
      const prior = cumulativeLoad.get(String(rec.employee._id)) || 0;
      const adjustedScore =
        rec.score == null ? null : Math.max(0, rec.score - prior * 0.05);
      return {
        ...rec,
        score: adjustedScore == null ? null : Math.round(adjustedScore * 1000) / 1000,
        alsoRecommendedForOtherResponsibilities: prior,
        why:
          prior > 0
            ? [
                ...rec.why,
                `Also suggested for ${prior} other coverage item(s) — consider distributing load.`,
              ]
            : rec.why,
      };
    });
    adjusted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    if (adjusted[0]) {
      const key = String(adjusted[0].employee._id);
      cumulativeLoad.set(key, (cumulativeLoad.get(key) || 0) + 1);
    }

    let selectedProposal = null;
    if (LeaveBackupProposal) {
      selectedProposal = await LeaveBackupProposal.findOne({
        leaveRequestId: leaveRequest._id,
        taskId: taskSummary._id,
        status: BACKUP_PROPOSAL_STATUSES.PROPOSED,
      })
        .populate("proposedBackupEmployeeId", "fullName employeeCode job.department job.jobTitle")
        .lean();
    }

    arrangements.push({
      responsibility: {
        taskId: taskSummary._id,
        title: taskSummary.title,
        priority: taskSummary.priority,
        deadline: taskSummary.deadline,
        coverageDates: result.coverageWindow,
      },
      recommendations: adjusted,
      noSuitableCandidate: adjusted.length === 0,
      message: adjusted.length === 0 ? result.message : null,
      proposedBackup: selectedProposal?.proposedBackupEmployeeId
        ? {
            proposalId: selectedProposal._id,
            status: "PROPOSED_BACKUP",
            employee: {
              _id: selectedProposal.proposedBackupEmployeeId._id,
              fullName: selectedProposal.proposedBackupEmployeeId.fullName,
              employeeCode: selectedProposal.proposedBackupEmployeeId.employeeCode,
              department: selectedProposal.proposedBackupEmployeeId.job?.department || null,
              jobTitle: selectedProposal.proposedBackupEmployeeId.job?.jobTitle || null,
            },
            note: "Proposed arrangement only — task ownership is unchanged until handover (Phase 3).",
          }
        : null,
    });
  }

  const withRecommendations = arrangements.filter((a) => (a.recommendations || []).length > 0).length;
  const withoutSuitableBackup = arrangements.filter((a) => a.noSuitableCandidate).length;
  const missingInformation = impact.missingInformation || [];
  const incompleteEmployeeInfo = missingInformation.some((m) =>
    ["DEPARTMENT_MISSING", "REPORTING_MANAGER_MISSING", "TASK_DEADLINE_MISSING"].includes(m.code)
  );

  let emptyState = null;
  if (coverageTasks.length === 0) {
    emptyState = {
      code: "NO_COVERAGE_NEEDED",
      message:
        "No backup arrangement is needed for this leave period. The identified responsibilities can wait until the employee returns.",
    };
  } else if (withRecommendations === 0 && withoutSuitableBackup > 0) {
    emptyState = {
      code: "NO_SUITABLE_BACKUP",
      message:
        "Tasks requiring coverage were identified, but no suitable backup could be recommended.",
    };
  } else if (incompleteEmployeeInfo && withRecommendations === 0) {
    emptyState = {
      code: "INCOMPLETE_EMPLOYEE_INFO",
      message:
        "Backup recommendations are limited because some employee skill, role or availability information is missing.",
    };
  }

  return {
    leaveRequestId: leaveRequest._id,
    employeeId: leaveRequest.employeeId,
    leaveWindow: impact.leaveWindow,
    planningCategory: impact.planningCategory,
    arrangements,
    deferredResponsibilities: canWait.map((t) => ({
      taskId: t._id,
      title: t.title,
      note: "Can wait until return — no backup required for Phase 2.",
    })),
    summary: {
      coverageTaskCount: coverageTasks.length,
      deferredTaskCount: canWait.length,
      arrangementCount: arrangements.length,
      withRecommendations,
      withoutSuitableBackup,
      incompleteEmployeeInfo,
      emptyState,
    },
    missingInformation,
    doesNot: {
      autoAssign: true,
      changeTaskOwner: true,
      notifyAssignee: true,
      blockLeaveApproval: true,
      requireBackupSelection: true,
    },
  };
}

/**
 * Upsert proposed backup for a leave+task. Null backupEmployeeId clears the proposal.
 */
export async function upsertLeaveBackupProposal(
  companyContext,
  { leaveRequestId, taskId, backupEmployeeId, proposedByUserId, explanationSnapshot }
) {
  const { models } = companyContext || {};
  const { LeaveRequest, Employee, Task, LeaveBackupProposal } = models || {};
  if (!LeaveBackupProposal) {
    throw new HttpError(500, "Backup proposal storage is not available.");
  }

  const leaveRequest = await LeaveRequest.findById(leaveRequestId).lean();
  if (!leaveRequest) throw new HttpError(404, "Leave request not found");

  const task = await Task.findById(taskId).lean();
  if (!task) throw new HttpError(404, "Task not found");

  if (!backupEmployeeId) {
    await LeaveBackupProposal.findOneAndUpdate(
      { leaveRequestId, taskId },
      {
        $set: {
          proposedBackupEmployeeId: null,
          status: BACKUP_PROPOSAL_STATUSES.CLEARED,
          proposedByUserId: proposedByUserId || null,
          explanationSnapshot: explanationSnapshot || {},
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    const sync = await syncProposalToHandoverDraft(LeaveRequest, leaveRequestId, taskId, null);
    const taskAfterClear = await Task.findById(taskId).select("assigneeId").lean();
    if (String(taskAfterClear.assigneeId) !== String(task.assigneeId)) {
      throw new HttpError(500, "Unexpected task ownership change during proposal clear.");
    }
    return {
      cleared: true,
      taskId,
      leaveRequestId,
      handoverSynced: Boolean(sync.synced),
      note: "Proposal cleared. Task ownership unchanged. Handover was not submitted.",
    };
  }

  if (!mongoose.Types.ObjectId.isValid(backupEmployeeId)) {
    throw new HttpError(400, "Invalid backup employee id.");
  }
  if (String(backupEmployeeId) === String(leaveRequest.employeeId)) {
    throw new HttpError(400, "An employee cannot be proposed as their own backup.");
  }

  const backup = await Employee.findById(backupEmployeeId).lean();
  if (!backup || backup.status !== EMPLOYEE_STATUSES.ACTIVE) {
    throw new HttpError(400, "Proposed backup must be an active employee in this company.");
  }

  // Unique (leaveRequestId, taskId) upsert — replaces any prior proposal for this responsibility
  const doc = await LeaveBackupProposal.findOneAndUpdate(
    { leaveRequestId, taskId },
    {
      $set: {
        originalEmployeeId: leaveRequest.employeeId,
        proposedBackupEmployeeId: backupEmployeeId,
        proposedByUserId: proposedByUserId || null,
        status: BACKUP_PROPOSAL_STATUSES.PROPOSED,
        explanationSnapshot: explanationSnapshot || {},
      },
      $setOnInsert: {
        leaveRequestId,
        taskId,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean();

  const sync = await syncProposalToHandoverDraft(
    LeaveRequest,
    leaveRequestId,
    taskId,
    backupEmployeeId
  );

  // Verify task ownership unchanged — proposal is never an assignment
  const taskAfter = await Task.findById(taskId).select("assigneeId").lean();
  if (String(taskAfter.assigneeId) !== String(task.assigneeId)) {
    throw new HttpError(500, "Unexpected task ownership change during proposal save.");
  }

  return {
    proposal: doc,
    handoverSynced: Boolean(sync.synced),
    note:
      "Saved as PROPOSED BACKUP only. Task.assigneeId was not modified. Handover was not submitted and no temporary delegation was created.",
  };
}

export { SUITABILITY, OPEN_TASK_STATUSES, suitabilityFromScore };

import { PRIORITY_RANK, DEADLINE_URGENCY } from "./config.js";

function deadlineBoost(deadline, now = new Date()) {
  if (!deadline) return DEADLINE_URGENCY.later;
  const ms = new Date(deadline).getTime() - now.getTime();
  const days = ms / 86_400_000;
  if (days < 0) return DEADLINE_URGENCY.overdue;
  if (days <= 1) return DEADLINE_URGENCY.within1Day;
  if (days <= 3) return DEADLINE_URGENCY.within3Days;
  if (days <= 7) return DEADLINE_URGENCY.within7Days;
  return DEADLINE_URGENCY.later;
}

/**
 * Higher score = schedule sooner.
 * Uses existing TASK_PRIORITIES only — no new categories.
 * Creation time breaks ties (older first via higher age contribution).
 */
export function resolveTaskPriorityScore(task, now = new Date()) {
  const base = PRIORITY_RANK[task.priority] || PRIORITY_RANK.MEDIUM;
  const urgency = deadlineBoost(task.deadline, now);
  const createdAt = task.createdAt ? new Date(task.createdAt).getTime() : now.getTime();
  const ageHours = Math.max(0, (now.getTime() - createdAt) / 3_600_000);
  // Cap age contribution so it never outweighs priority bands
  const ageScore = Math.min(50, ageHours / 24);

  return {
    score: base + urgency + ageScore,
    components: { base, urgency, ageScore },
  };
}

export function sortTasksByPriority(tasks, now = new Date()) {
  return [...tasks]
    .map((task) => ({ task, ...resolveTaskPriorityScore(task, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDead = a.task.deadline ? new Date(a.task.deadline).getTime() : Infinity;
      const bDead = b.task.deadline ? new Date(b.task.deadline).getTime() : Infinity;
      if (aDead !== bDead) return aDead - bDead;
      return String(a.task._id).localeCompare(String(b.task._id));
    });
}

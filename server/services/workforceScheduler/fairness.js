import { SCHEDULER_WEIGHTS } from "./config.js";

/**
 * Deterministic weighted fair score. Higher = better candidate.
 * Weights documented in config.js (sum ≈ 1.0).
 */
export function scoreEmployeeForTask({
  employee,
  task,
  workload,
  maxActive,
  weights = SCHEDULER_WEIGHTS,
}) {
  const active = workload?.activeCount || 0;
  const remainingSlots = Math.max(0, maxActive - active);
  const utilization = maxActive > 0 ? active / maxActive : 1;

  const required = (task.requiredSkills || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  const skills = (employee.skills || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);

  let skillFit = 1;
  if (required.length) {
    const matched = required.filter((s) => skills.includes(s)).length;
    skillFit = matched / required.length;
  }

  // Continuity: same department when both recorded; else neutral 0.5 (never invent).
  const taskDept = String(task.department || "").trim().toLowerCase();
  const empDept = String(employee.job?.department || "").trim().toLowerCase();
  let continuity = 0.5;
  if (taskDept && empDept) {
    continuity = taskDept === empDept ? 1 : 0;
  }

  const score =
    weights.remainingCapacity * (remainingSlots / Math.max(1, maxActive)) +
    weights.lowUtilization * (1 - utilization) +
    weights.skillFit * skillFit +
    weights.continuity * continuity;

  return {
    score,
    components: {
      remainingCapacity: remainingSlots,
      utilization,
      skillFit,
      continuity,
    },
  };
}

export function pickBestEmployee(candidates, { task, workloadByEmployee, maxActive, weights }) {
  const ranked = candidates
    .map((employee) => {
      const workload = workloadByEmployee.get(String(employee._id));
      const scored = scoreEmployeeForTask({
        employee,
        task,
        workload,
        maxActive,
        weights,
      });
      return { employee, ...scored };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.components.remainingCapacity !== a.components.remainingCapacity) {
        return b.components.remainingCapacity - a.components.remainingCapacity;
      }
      return String(a.employee._id).localeCompare(String(b.employee._id));
    });

  return ranked[0] || null;
}

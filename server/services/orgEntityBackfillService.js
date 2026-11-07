/**
 * Idempotent backfill of Department / Project entities from legacy Employee strings.
 *
 * Rules:
 * - Preserve all legacy job.department / job.project.* values.
 * - Do not overwrite existing departmentId / projectId.
 * - Do not map Task.projectName.
 * - Create entities by normalized name; link employees when exactly one match.
 * - Report skipped / unmatched / already-linked counts.
 */

import { PROJECT_MEMBERSHIP_STATUSES } from "../models/ProjectMembership.js";
import { PROJECT_STATUSES, PROJECT_TYPES } from "../models/Project.js";

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function displayName(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * @returns {Promise<object>} backfill report
 */
export async function backfillOrgEntitiesFromEmployees(models, { actorUserId = null } = {}) {
  const report = {
    departmentsCreated: 0,
    departmentsReused: 0,
    employeesLinkedToDepartment: 0,
    employeesDepartmentSkippedAlreadyLinked: 0,
    employeesDepartmentUnmatchedEmpty: 0,
    projectsCreated: 0,
    projectsReused: 0,
    employeesLinkedToProject: 0,
    projectMembershipsCreated: 0,
    employeesProjectSkippedAlreadyLinked: 0,
    employeesProjectUnmatchedEmpty: 0,
    ambiguous: [],
    notes: [
      "Task.projectName was not inspected or mapped.",
      "Legacy job.department and job.project strings were preserved.",
      "New IDs are optional; existing profiles remain valid without them.",
    ],
  };

  const employees = await models.Employee.find({})
    .select("_id job.department job.departmentId job.project")
    .lean();

  // --- Departments ---
  const deptNameToId = new Map();
  const existingDepts = await models.Department.find({}).select("_id name normalizedName").lean();
  for (const d of existingDepts) {
    deptNameToId.set(d.normalizedName, d._id);
  }

  for (const emp of employees) {
    const legacy = displayName(emp.job?.department);
    const normalized = normalizeName(legacy);

    if (emp.job?.departmentId) {
      report.employeesDepartmentSkippedAlreadyLinked += 1;
      continue;
    }
    if (!normalized) {
      report.employeesDepartmentUnmatchedEmpty += 1;
      continue;
    }

    let departmentId = deptNameToId.get(normalized);
    if (!departmentId) {
      const created = await models.Department.create({
        name: legacy,
        description: "Backfilled from employee job.department",
        isActive: true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
      departmentId = created._id;
      deptNameToId.set(normalized, departmentId);
      report.departmentsCreated += 1;
    } else {
      report.departmentsReused += 1;
    }

    await models.Employee.updateOne(
      { _id: emp._id, "job.departmentId": null },
      { $set: { "job.departmentId": departmentId } }
    );
    report.employeesLinkedToDepartment += 1;
  }

  // --- Projects (from primary embedded job.project only) ---
  const projectNameToId = new Map();
  const existingProjects = await models.Project.find({}).select("_id name normalizedName").lean();
  for (const p of existingProjects) {
    projectNameToId.set(p.normalizedName, p._id);
  }

  for (const emp of employees) {
    const legacyName = displayName(emp.job?.project?.projectName);
    const normalized = normalizeName(legacyName);
    const legacyType = emp.job?.project?.projectType || "";

    if (emp.job?.project?.projectId) {
      report.employeesProjectSkippedAlreadyLinked += 1;
      continue;
    }
    if (!normalized) {
      report.employeesProjectUnmatchedEmpty += 1;
      continue;
    }

    let projectId = projectNameToId.get(normalized);
    if (!projectId) {
      const projectType = Object.values(PROJECT_TYPES).includes(legacyType) ? legacyType : "";
      const created = await models.Project.create({
        name: legacyName,
        description: "Backfilled from employee job.project.projectName",
        projectType,
        status: PROJECT_STATUSES.ACTIVE,
        isActive: true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
      projectId = created._id;
      projectNameToId.set(normalized, projectId);
      report.projectsCreated += 1;
    } else {
      report.projectsReused += 1;
    }

    await models.Employee.updateOne(
      { _id: emp._id, "job.project.projectId": null },
      { $set: { "job.project.projectId": projectId } }
    );
    report.employeesLinkedToProject += 1;

    const existingMembership = await models.ProjectMembership.findOne({
      employeeId: emp._id,
      projectId,
      status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
    })
      .select("_id")
      .lean();

    if (!existingMembership) {
      await models.ProjectMembership.create({
        employeeId: emp._id,
        projectId,
        status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
        isPrimary: true,
        addedBy: actorUserId,
      });
      report.projectMembershipsCreated += 1;
    }
  }

  return report;
}

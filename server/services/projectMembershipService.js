import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import {
  PROJECT_MEMBERSHIP_STATUSES,
  serializeProjectMembership,
} from "../models/ProjectMembership.js";
import { PROJECT_STATUSES } from "../models/Project.js";
import { isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

/** Matches project membership routes: Company Admin and HR Admin. */
function requireHrPortalOperator(actorUser) {
  if (!isHrPortalOperator(actorUser?.role)) {
    throw new HttpError(403, "You do not have access to this resource");
  }
}

function requireObjectId(value, field) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new HttpError(400, `Invalid ${field}`, { field });
  }
  return new mongoose.Types.ObjectId(value);
}

async function syncPrimaryProjectEmbed(models, employeeId, project) {
  const employee = await models.Employee.findById(employeeId);
  if (!employee) return;
  employee.job = employee.job || {};
  employee.job.project = employee.job.project || {};
  if (project) {
    employee.job.project.projectId = project._id;
    employee.job.project.projectName = project.name;
    if (project.projectType) {
      employee.job.project.projectType = project.projectType;
    }
  }
  employee.markModified("job");
  await employee.save();
}

export async function addEmployeeToProject(models, actorUser, { projectId, employeeId, isPrimary = false } = {}) {
  requireHrPortalOperator(actorUser);
  const projId = requireObjectId(projectId, "projectId");
  const empId = requireObjectId(employeeId, "employeeId");

  const project = await models.Project.findById(projId).lean();
  if (!project || project.isActive !== true || project.status === PROJECT_STATUSES.ARCHIVED) {
    throw new HttpError(400, "projectId must reference an active project", {
      field: "projectId",
    });
  }

  const employee = await models.Employee.findById(empId).lean();
  if (!employee) {
    throw new HttpError(404, "Employee not found");
  }
  if (employee.status !== EMPLOYEE_STATUSES.ACTIVE) {
    throw new HttpError(400, "Cannot add an inactive employee to a project");
  }

  const existing = await models.ProjectMembership.findOne({
    employeeId: empId,
    projectId: projId,
    status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
  })
    .select("_id")
    .lean();
  if (existing) {
    throw new HttpError(409, "Employee is already an active member of this project", {
      code: "CONFLICT",
    });
  }

  if (isPrimary) {
    await models.ProjectMembership.updateMany(
      { employeeId: empId, status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE, isPrimary: true },
      { $set: { isPrimary: false } }
    );
  }

  let membership;
  try {
    membership = await models.ProjectMembership.create({
      employeeId: empId,
      projectId: projId,
      status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
      isPrimary: Boolean(isPrimary),
      addedBy: actorUser._id,
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "Employee is already an active member of this project", {
        code: "CONFLICT",
      });
    }
    throw err;
  }

  if (isPrimary || !employee.job?.project?.projectId) {
    await syncPrimaryProjectEmbed(models, empId, project);
    if (!isPrimary) {
      membership.isPrimary = true;
      await membership.save();
    }
  }

  return serializeProjectMembership(membership, { project, employee });
}

export async function removeEmployeeFromProject(
  models,
  actorUser,
  { projectId, employeeId, reason = "" } = {}
) {
  requireHrPortalOperator(actorUser);
  const projId = requireObjectId(projectId, "projectId");
  const empId = requireObjectId(employeeId, "employeeId");

  const membership = await models.ProjectMembership.findOne({
    employeeId: empId,
    projectId: projId,
    status: PROJECT_MEMBERSHIP_STATUSES.ACTIVE,
  });
  if (!membership) {
    throw new HttpError(404, "Active project membership not found");
  }

  membership.status = PROJECT_MEMBERSHIP_STATUSES.ENDED;
  membership.endedBy = actorUser._id;
  membership.endedAt = new Date();
  membership.endReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  membership.isPrimary = false;
  await membership.save();

  const employee = await models.Employee.findById(empId);
  if (
    employee?.job?.project?.projectId &&
    String(employee.job.project.projectId) === String(projId)
  ) {
    // Clear stable id; preserve legacy display strings.
    employee.job.project.projectId = null;
    employee.markModified("job");
    await employee.save();
  }

  const project = await models.Project.findById(projId).lean();
  return serializeProjectMembership(membership, {
    project,
    employee: employee?.toObject?.() || employee,
  });
}

export async function listProjectMembers(models, projectId, { includeEnded = false } = {}) {
  const projId = requireObjectId(projectId, "projectId");
  const project = await models.Project.findById(projId).lean();
  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  const filter = { projectId: projId };
  if (!includeEnded) filter.status = PROJECT_MEMBERSHIP_STATUSES.ACTIVE;

  const memberships = await models.ProjectMembership.find(filter).sort({ createdAt: -1 }).lean();
  const employeeIds = memberships.map((m) => m.employeeId);
  const employees = await models.Employee.find({ _id: { $in: employeeIds } })
    .select("_id fullName employeeCode status")
    .lean();
  const byId = new Map(employees.map((e) => [String(e._id), e]));

  return memberships.map((m) =>
    serializeProjectMembership(m, { project, employee: byId.get(String(m.employeeId)) })
  );
}

export async function listEmployeeProjectMemberships(models, employeeId, { includeEnded = false } = {}) {
  const empId = requireObjectId(employeeId, "employeeId");
  const employee = await models.Employee.findById(empId).select("_id fullName employeeCode").lean();
  if (!employee) {
    throw new HttpError(404, "Employee not found");
  }

  const filter = { employeeId: empId };
  if (!includeEnded) filter.status = PROJECT_MEMBERSHIP_STATUSES.ACTIVE;

  const memberships = await models.ProjectMembership.find(filter).sort({ createdAt: -1 }).lean();
  const projectIds = memberships.map((m) => m.projectId);
  const projects = await models.Project.find({ _id: { $in: projectIds } }).lean();
  const byId = new Map(projects.map((p) => [String(p._id), p]));

  return memberships.map((m) =>
    serializeProjectMembership(m, { project: byId.get(String(m.projectId)), employee })
  );
}

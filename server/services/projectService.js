import mongoose from "mongoose";
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  serializeProject,
} from "../models/Project.js";
import { isHrPortalOperator } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

/** Matches project routes: Company Admin and HR Admin. Permission and scope stay on the route. */
function requireHrPortalOperator(actorUser) {
  if (!isHrPortalOperator(actorUser?.role)) {
    throw new HttpError(403, "You do not have access to this resource");
  }
}

function parseOptionalDate(value, field) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Invalid ${field}`, { field });
  }
  return date;
}

export async function listProjects(models, { includeInactive = false, status } = {}) {
  const filter = {};
  if (!includeInactive) filter.isActive = true;
  if (status) filter.status = status;
  const rows = await models.Project.find(filter).sort({ name: 1 }).lean();
  return rows.map(serializeProject);
}

export async function getProjectById(models, projectId) {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new HttpError(404, "Project not found");
  }
  const project = await models.Project.findById(projectId).lean();
  if (!project) {
    throw new HttpError(404, "Project not found");
  }
  return serializeProject(project);
}

export async function createProject(models, actorUser, payload = {}) {
  requireHrPortalOperator(actorUser);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw new HttpError(400, "Project name is required", { field: "name" });
  }

  const normalizedName = name.toLowerCase();
  const existing = await models.Project.findOne({ normalizedName }).select("_id").lean();
  if (existing) {
    throw new HttpError(409, "A project with this name already exists", {
      field: "name",
      code: "CONFLICT",
    });
  }

  let projectType = "";
  if (payload.projectType !== undefined && payload.projectType !== null && payload.projectType !== "") {
    if (!Object.values(PROJECT_TYPES).includes(payload.projectType)) {
      throw new HttpError(400, "Invalid projectType", { field: "projectType" });
    }
    projectType = payload.projectType;
  }

  const status = payload.status || PROJECT_STATUSES.ACTIVE;
  if (!Object.values(PROJECT_STATUSES).includes(status)) {
    throw new HttpError(400, "Invalid project status", { field: "status" });
  }

  const startDate = parseOptionalDate(payload.startDate, "startDate");
  const endDate = parseOptionalDate(payload.endDate, "endDate");
  if (startDate && endDate && endDate < startDate) {
    throw new HttpError(400, "endDate must be on or after startDate", { field: "endDate" });
  }

  const project = await models.Project.create({
    name,
    description: typeof payload.description === "string" ? payload.description.trim() : "",
    projectCode: typeof payload.projectCode === "string" ? payload.projectCode.trim() : "",
    projectType,
    status,
    startDate,
    endDate,
    isActive: status === PROJECT_STATUSES.ACTIVE || status === PROJECT_STATUSES.ON_HOLD,
    createdBy: actorUser._id,
    updatedBy: actorUser._id,
  });
  return serializeProject(project);
}

export async function updateProject(models, actorUser, projectId, payload = {}) {
  requireHrPortalOperator(actorUser);
  const project = await models.Project.findById(projectId);
  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  if (payload.name !== undefined) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) {
      throw new HttpError(400, "Project name is required", { field: "name" });
    }
    const normalizedName = name.toLowerCase();
    const clash = await models.Project.findOne({
      normalizedName,
      _id: { $ne: project._id },
    })
      .select("_id")
      .lean();
    if (clash) {
      throw new HttpError(409, "A project with this name already exists", {
        field: "name",
        code: "CONFLICT",
      });
    }
    project.name = name;
  }

  if (payload.description !== undefined) {
    project.description =
      typeof payload.description === "string" ? payload.description.trim() : "";
  }
  if (payload.projectCode !== undefined) {
    project.projectCode =
      typeof payload.projectCode === "string" ? payload.projectCode.trim() : "";
  }
  if (payload.projectType !== undefined) {
    if (payload.projectType === "" || payload.projectType == null) {
      project.projectType = "";
    } else if (!Object.values(PROJECT_TYPES).includes(payload.projectType)) {
      throw new HttpError(400, "Invalid projectType", { field: "projectType" });
    } else {
      project.projectType = payload.projectType;
    }
  }
  if (payload.status !== undefined) {
    if (!Object.values(PROJECT_STATUSES).includes(payload.status)) {
      throw new HttpError(400, "Invalid project status", { field: "status" });
    }
    project.status = payload.status;
  }
  if (payload.startDate !== undefined) {
    project.startDate = parseOptionalDate(payload.startDate, "startDate");
  }
  if (payload.endDate !== undefined) {
    project.endDate = parseOptionalDate(payload.endDate, "endDate");
  }
  if (project.startDate && project.endDate && project.endDate < project.startDate) {
    throw new HttpError(400, "endDate must be on or after startDate", { field: "endDate" });
  }

  project.updatedBy = actorUser._id;
  await project.save();
  return serializeProject(project);
}

export async function deactivateProject(models, actorUser, projectId) {
  requireHrPortalOperator(actorUser);
  const project = await models.Project.findById(projectId);
  if (!project) {
    throw new HttpError(404, "Project not found");
  }
  project.isActive = false;
  if (project.status === PROJECT_STATUSES.ACTIVE || project.status === PROJECT_STATUSES.ON_HOLD) {
    project.status = PROJECT_STATUSES.ARCHIVED;
  }
  project.updatedBy = actorUser._id;
  await project.save();
  return serializeProject(project);
}

export function requireObjectId(value, field) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new HttpError(400, `Invalid ${field}`, { field });
  }
  return new mongoose.Types.ObjectId(value);
}

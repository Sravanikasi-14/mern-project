import {
  createProject,
  deactivateProject,
  getProjectById,
  listProjects,
  updateProject,
} from "../services/projectService.js";
import {
  addEmployeeToProject,
  listEmployeeProjectMemberships,
  listProjectMembers,
  removeEmployeeFromProject,
} from "../services/projectMembershipService.js";
import { isEmployeeIdInScope } from "../services/hrAccessEnforcementService.js";

export async function listProjectsHandler(req, res, next) {
  try {
    const projects = await listProjects(req.auth.models, {
      includeInactive: req.query.includeInactive === "true",
      status: req.query.status,
    });
    res.json({ projects });
  } catch (error) {
    next(error);
  }
}

export async function getProjectHandler(req, res, next) {
  try {
    const project = await getProjectById(req.auth.models, req.params.projectId);
    res.json({ project });
  } catch (error) {
    next(error);
  }
}

export async function createProjectHandler(req, res, next) {
  try {
    const project = await createProject(req.auth.models, req.auth.user, req.body || {});
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
}

export async function updateProjectHandler(req, res, next) {
  try {
    const project = await updateProject(
      req.auth.models,
      req.auth.user,
      req.params.projectId,
      req.body || {}
    );
    res.json({ project });
  } catch (error) {
    next(error);
  }
}

export async function deactivateProjectHandler(req, res, next) {
  try {
    const project = await deactivateProject(
      req.auth.models,
      req.auth.user,
      req.params.projectId
    );
    res.json({ project });
  } catch (error) {
    next(error);
  }
}

export async function addProjectMemberHandler(req, res, next) {
  try {
    const membership = await addEmployeeToProject(req.auth.models, req.auth.user, {
      projectId: req.params.projectId,
      employeeId: req.body?.employeeId,
      isPrimary: Boolean(req.body?.isPrimary),
    });
    res.status(201).json({ membership });
  } catch (error) {
    next(error);
  }
}

export async function removeProjectMemberHandler(req, res, next) {
  try {
    const membership = await removeEmployeeFromProject(req.auth.models, req.auth.user, {
      projectId: req.params.projectId,
      employeeId: req.params.employeeId,
      reason: req.body?.reason,
    });
    res.json({ membership });
  } catch (error) {
    next(error);
  }
}

export async function listProjectMembersHandler(req, res, next) {
  try {
    let memberships = await listProjectMembers(req.auth.models, req.params.projectId, {
      includeEnded: req.query.includeEnded === "true",
    });
    if (req.hrAccess) {
      memberships = (memberships || []).filter((m) =>
        isEmployeeIdInScope(req.hrAccess, m.employeeId?._id || m.employeeId)
      );
    }
    res.json({ memberships });
  } catch (error) {
    next(error);
  }
}

export async function listEmployeeProjectsHandler(req, res, next) {
  try {
    const memberships = await listEmployeeProjectMemberships(
      req.auth.models,
      req.params.employeeId,
      { includeEnded: req.query.includeEnded === "true" }
    );
    res.json({ memberships });
  } catch (error) {
    next(error);
  }
}

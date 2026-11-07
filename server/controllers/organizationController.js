import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { buildOrganizationHierarchy } from "../services/organizationHierarchyService.js";
import { buildEmployeeOrganizationView } from "../services/employeeOrganizationViewService.js";
import {
  assertDepartmentsViewEnabled,
  listOrganizationExplorerDepartmentEmployees,
  listOrganizationExplorerDepartments,
} from "../services/organizationExplorerDepartmentsService.js";
import {
  assertProjectsViewEnabled,
  listOrganizationExplorerProjectEmployees,
  listOrganizationExplorerProjects,
} from "../services/organizationExplorerProjectsService.js";
import {
  assertTeamsViewEnabled,
  createOrganizationExplorerTeam,
  deactivateOrganizationExplorerTeam,
  getOrganizationExplorerTeam,
  listOrganizationExplorerTeams,
  updateOrganizationExplorerTeam,
} from "../services/organizationExplorerTeamsService.js";
import { USER_ROLES } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { filterEmployeeListByScope } from "../services/hrAccessEnforcementService.js";

function scopeExplorerEmployees(req, payload) {
  if (!payload?.employees || req.auth?.user?.role !== USER_ROLES.HR_ADMIN) {
    return payload;
  }
  const scoped = filterEmployeeListByScope(req.hrAccess, payload.employees);
  return {
    ...payload,
    employees: scoped,
    meta: {
      ...(payload.meta || {}),
      total: scoped.length,
    },
  };
}

/**
 * GET /api/employees/organization
 * HR-only company org chart (light fields, cycle-safe tree edges).
 */
export async function getOrganizationHierarchy(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const raw = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "ACTIVE";
    const status =
      raw === "ALL"
        ? "ALL"
        : raw === EMPLOYEE_STATUSES.INACTIVE
          ? EMPLOYEE_STATUSES.INACTIVE
          : EMPLOYEE_STATUSES.ACTIVE;

    const payload = await buildOrganizationHierarchy(Employee, {
      status,
      hrAccess: req.hrAccess,
    });
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-view
 * Authenticated EMPLOYEE + HR_ADMIN company-wide hierarchy (minimal chart nodes).
 * Does not replace HR-only GET /employees/organization.
 */
export async function getEmployeeOrganizationView(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const payload = await buildEmployeeOrganizationView(Employee, req.auth.user, {
      hrAccess: req.hrAccess,
    });
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/departments
 * Authenticated EMPLOYEE + HR_ADMIN — department overview when view is enabled.
 */
export async function getOrganizationExplorerDepartments(req, res, next) {
  try {
    await assertDepartmentsViewEnabled(req.auth.company);
    const { Employee, Department } = req.auth.models;
    const payload = await listOrganizationExplorerDepartments(
      Employee,
      req.auth.user,
      req.hrAccess,
      Department
    );
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/departments/:department
 * Authenticated EMPLOYEE + HR_ADMIN — employees in one department (or Unassigned).
 */
export async function getOrganizationExplorerDepartmentEmployees(req, res, next) {
  try {
    await assertDepartmentsViewEnabled(req.auth.company);
    const { Employee, Department } = req.auth.models;
    const payload = scopeExplorerEmployees(
      req,
      await listOrganizationExplorerDepartmentEmployees(
        Employee,
        req.params.department,
        req.auth.user,
        req.hrAccess,
        Department
      )
    );
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/projects
 * Authenticated EMPLOYEE + HR_ADMIN — project overview when view is enabled.
 */
export async function getOrganizationExplorerProjects(req, res, next) {
  try {
    await assertProjectsViewEnabled(req.auth.company);
    const { Employee } = req.auth.models;
    const payload = await listOrganizationExplorerProjects(
      Employee,
      req.auth.user,
      req.hrAccess
    );
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/projects/:project
 * Authenticated EMPLOYEE + HR_ADMIN — employees on one primary project.
 */
export async function getOrganizationExplorerProjectEmployees(req, res, next) {
  try {
    await assertProjectsViewEnabled(req.auth.company);
    const { Employee } = req.auth.models;
    const payload = scopeExplorerEmployees(
      req,
      await listOrganizationExplorerProjectEmployees(
        Employee,
        req.params.project,
        req.auth.user,
        req.hrAccess
      )
    );
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/teams
 */
export async function listOrganizationExplorerTeamsHandler(req, res, next) {
  try {
    await assertTeamsViewEnabled(req.auth.company);
    const { Team, Employee } = req.auth.models;
    const includeInactive =
      req.query.includeInactive === "true" || req.query.includeInactive === "1";
    const payload = await listOrganizationExplorerTeams(Team, Employee, req.auth.user, {
      includeInactive,
      hrAccess: req.hrAccess,
    });
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/employees/organization-explorer/teams/:teamId
 */
export async function getOrganizationExplorerTeamHandler(req, res, next) {
  try {
    await assertTeamsViewEnabled(req.auth.company);
    const { Team, Employee } = req.auth.models;
    const payload = await getOrganizationExplorerTeam(
      Team,
      Employee,
      req.auth.user,
      req.params.teamId,
      { hrAccess: req.hrAccess }
    );
    res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/employees/organization-explorer/teams — HR_ADMIN only
 */
export async function createOrganizationExplorerTeamHandler(req, res, next) {
  try {
    await assertTeamsViewEnabled(req.auth.company);
    if (req.auth.user.role !== USER_ROLES.HR_ADMIN && req.auth.user.role !== USER_ROLES.COMPANY_ADMIN) {
      throw new HttpError(403, "You do not have access to this resource");
    }
    const { Team, Employee } = req.auth.models;
    const payload = await createOrganizationExplorerTeam(Team, Employee, req.body || {}, {
      hrAccess: req.hrAccess,
    });
    res.status(201).json({
      success: true,
      message: "Team created successfully.",
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/employees/organization-explorer/teams/:teamId — HR_ADMIN only
 */
export async function updateOrganizationExplorerTeamHandler(req, res, next) {
  try {
    await assertTeamsViewEnabled(req.auth.company);
    if (req.auth.user.role !== USER_ROLES.HR_ADMIN && req.auth.user.role !== USER_ROLES.COMPANY_ADMIN) {
      throw new HttpError(403, "You do not have access to this resource");
    }
    const { Team, Employee } = req.auth.models;
    const payload = await updateOrganizationExplorerTeam(
      Team,
      Employee,
      req.params.teamId,
      req.body || {},
      { hrAccess: req.hrAccess }
    );
    res.json({
      success: true,
      message: "Team updated successfully.",
      ...payload,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/employees/organization-explorer/teams/:teamId/deactivate — HR_ADMIN only
 */
export async function deactivateOrganizationExplorerTeamHandler(req, res, next) {
  try {
    await assertTeamsViewEnabled(req.auth.company);
    if (req.auth.user.role !== USER_ROLES.HR_ADMIN && req.auth.user.role !== USER_ROLES.COMPANY_ADMIN) {
      throw new HttpError(403, "You do not have access to this resource");
    }
    const { Team, Employee } = req.auth.models;
    const payload = await deactivateOrganizationExplorerTeam(
      Team,
      Employee,
      req.params.teamId,
      { hrAccess: req.hrAccess }
    );
    res.json({
      success: true,
      message: payload.alreadyInactive
        ? "Team was already inactive."
        : "Team deactivated successfully.",
      team: payload.team,
    });
  } catch (error) {
    next(error);
  }
}

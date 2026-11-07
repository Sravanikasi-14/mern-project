import {
  createDepartment,
  deactivateDepartment,
  getDepartmentById,
  listDepartments,
  setEmployeeDepartment,
  updateDepartment,
} from "../services/departmentService.js";
import { backfillDepartmentLinks } from "../services/departmentLinkService.js";
import { backfillOrgEntitiesFromEmployees } from "../services/orgEntityBackfillService.js";

export async function listDepartmentsHandler(req, res, next) {
  try {
    const departments = await listDepartments(req.auth.models, {
      includeInactive: req.query.includeInactive === "true",
    });
    res.json({ departments });
  } catch (error) {
    next(error);
  }
}

export async function getDepartmentHandler(req, res, next) {
  try {
    const department = await getDepartmentById(req.auth.models, req.params.departmentId);
    res.json({ department });
  } catch (error) {
    next(error);
  }
}

export async function createDepartmentHandler(req, res, next) {
  try {
    const department = await createDepartment(req.auth.models, req.auth.user, req.body || {});
    res.status(201).json({ department });
  } catch (error) {
    next(error);
  }
}

export async function updateDepartmentHandler(req, res, next) {
  try {
    const department = await updateDepartment(
      req.auth.models,
      req.auth.user,
      req.params.departmentId,
      req.body || {}
    );
    res.json({ department });
  } catch (error) {
    next(error);
  }
}

export async function deactivateDepartmentHandler(req, res, next) {
  try {
    const department = await deactivateDepartment(
      req.auth.models,
      req.auth.user,
      req.params.departmentId
    );
    res.json({ department });
  } catch (error) {
    next(error);
  }
}

export async function setEmployeeDepartmentHandler(req, res, next) {
  try {
    const result = await setEmployeeDepartment(
      req.auth.models,
      req.auth.user,
      req.params.employeeId,
      req.body?.departmentId
    );
    res.json({ membership: result });
  } catch (error) {
    next(error);
  }
}

/** Department-only legacy link backfill. Does not modify projects, roles, or enforcement. */
export async function backfillDepartmentLinksHandler(req, res, next) {
  try {
    const report = await backfillDepartmentLinks(req.auth.models, {
      actorUserId: req.auth.user._id,
    });
    res.json({ success: true, report });
  } catch (error) {
    next(error);
  }
}

/** Idempotent HR-triggered backfill for departments + projects from legacy strings. */
export async function backfillOrgEntitiesHandler(req, res, next) {
  try {
    const report = await backfillOrgEntitiesFromEmployees(req.auth.models, {
      actorUserId: req.auth.user._id,
    });
    res.json({ report });
  } catch (error) {
    next(error);
  }
}

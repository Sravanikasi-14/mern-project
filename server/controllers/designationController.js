import {
  createDesignation,
  deactivateDesignation,
  listDesignations,
  updateDesignation,
} from "../services/designationService.js";

export async function listDesignationsHandler(req, res, next) {
  try {
    const designations = await listDesignations(req.auth.models, {
      status: req.query.status,
      includeInactive: req.query.includeInactive === "true",
      search: req.query.q || req.query.search || "",
    });
    res.json({ designations });
  } catch (error) {
    next(error);
  }
}

export async function createDesignationHandler(req, res, next) {
  try {
    const designation = await createDesignation(req.auth.models, req.auth.user, req.body || {});
    res.status(201).json({ designation });
  } catch (error) {
    next(error);
  }
}

export async function updateDesignationHandler(req, res, next) {
  try {
    const designation = await updateDesignation(
      req.auth.models,
      req.auth.user,
      req.params.designationId,
      req.body || {}
    );
    res.json({ designation });
  } catch (error) {
    next(error);
  }
}

export async function deactivateDesignationHandler(req, res, next) {
  try {
    const designation = await deactivateDesignation(
      req.auth.models,
      req.auth.user,
      req.params.designationId
    );
    res.json({ designation });
  } catch (error) {
    next(error);
  }
}

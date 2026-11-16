import {
  getCompanyFeatureAccess,
  getGlobalFeaturesView,
  listFeatureChangeHistory,
  previewGlobalModuleChange,
  updateCompanyFeatureAccess,
  updateGlobalFeatures,
} from "../services/platformFeatureService.js";

export async function getModules(req, res, next) {
  try {
    const data = await getGlobalFeaturesView();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function previewModuleImpact(req, res, next) {
  try {
    const enabled = String(req.query.enabled || "").toLowerCase() === "true";
    const data = await previewGlobalModuleChange({
      moduleKey: req.params.moduleKey,
      enabled,
    });
    res.status(200).json({
      moduleKey: req.params.moduleKey,
      enabled,
      ...data,
    });
  } catch (err) {
    next(err);
  }
}

export async function patchGlobalModules(req, res, next) {
  try {
    const data = await updateGlobalFeatures({
      modules: req.body?.modules,
      capabilities: req.body?.capabilities,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getFeatureHistory(req, res, next) {
  try {
    const rows = await listFeatureChangeHistory({ limit: req.query.limit });
    res.status(200).json({
      history: rows.map((row) => ({
        id: String(row._id),
        action: row.action,
        outcome: row.outcome,
        actorEmail: row.actorEmail,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata || {},
        timestamp: row.timestamp,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function getCompanyFeatures(req, res, next) {
  try {
    const data = await getCompanyFeatureAccess(req.params.companyId);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function patchCompanyFeatures(req, res, next) {
  try {
    const data = await updateCompanyFeatureAccess({
      companyId: req.params.companyId,
      modules: req.body?.modules,
      capabilities: req.body?.capabilities,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

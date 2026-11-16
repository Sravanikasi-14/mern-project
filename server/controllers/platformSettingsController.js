import {
  getPlatformSettingsView,
  listPlatformAuditEntries,
  updatePlatformSettings,
} from "../services/platformSettingsService.js";

export async function getSettings(req, res, next) {
  try {
    const data = await getPlatformSettingsView();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function patchSettings(req, res, next) {
  try {
    const data = await updatePlatformSettings({
      payload: req.body,
      confirm: Boolean(req.body?.confirm),
      admin: req.platformAuth.admin,
      req,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

export async function listAudit(req, res, next) {
  try {
    const data = await listPlatformAuditEntries({
      action: req.query.action,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

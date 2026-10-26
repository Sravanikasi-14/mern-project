import { getHrIntelligenceReport } from "../services/hrIntelligenceService.js";

/**
 * GET /api/admin/intelligence
 * Retrieves actionable HR intelligence insights for the authenticated company tenant.
 * Strictly restricted to HR_ADMIN role.
 *
 * Query params:
 *   ?refresh=true : Forces recalculation and invalidates explanation cache.
 */
export async function getHrIntelligenceHandler(req, res, next) {
  try {
    if (!req.auth || !req.auth.models || !req.auth.company) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication is required to access HR intelligence.",
      });
    }

    const forceRefresh = req.query?.refresh === "true";

    // Enforce no-cache on the HTTP response so browsers and proxies never serve stale data
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const report = await getHrIntelligenceReport({
      models: req.auth.models,
      company: req.auth.company,
      forceRefresh,
    });

    return res.status(200).json(report);
  } catch (error) {
    next(error);
  }
}

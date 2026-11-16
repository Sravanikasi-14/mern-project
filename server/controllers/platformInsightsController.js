import { getPlatformInsights } from "../services/platformInsightsService.js";

export async function getInsights(req, res, next) {
  try {
    const data = await getPlatformInsights();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}

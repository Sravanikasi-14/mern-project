import express from "express";
import { requireCronSecret } from "../utils/cronAuth.js";
import { runSchedulerDispatchCron } from "../controllers/schedulerDispatchController.js";

const router = express.Router();

/**
 * Central HRMS cron dispatcher.
 * Intended external trigger: cron-job.org every 15 minutes.
 * Individual jobs keep independent daily nextRunAt schedules.
 */
router.get("/dispatch", requireCronSecret, runSchedulerDispatchCron);
router.post("/dispatch", requireCronSecret, runSchedulerDispatchCron);

export default router;

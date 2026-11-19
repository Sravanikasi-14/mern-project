import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import {
  loadHrAccessContext,
  requireEntitledModule,
  requireHrPermission,
} from "../middleware/hrAccessEnforcement.js";
import { requireCronSecret } from "../utils/cronAuth.js";
import {
  runWorkforceSchedulerCron,
  runWorkforceSchedulerForCompany,
  approveWorkforceSchedulerAssignment,
} from "../controllers/workforceSchedulerController.js";

const router = express.Router();

/**
 * Cron / automation — Authorization: Bearer <CRON_SECRET> only (no user JWT).
 * GET retained for Vercel Cron; POST preferred for cron-job.org / manual ops.
 * requireCronSecret runs first; the handler also re-checks for defense in depth.
 */
router.get("/run", requireCronSecret, runWorkforceSchedulerCron);
router.post("/run", requireCronSecret, runWorkforceSchedulerCron);

/** Authenticated HR: dry-run (default) or apply for current tenant. */
router.post(
  "/company/run",
  authenticate,
  loadHrAccessContext,
  requireEntitledModule("work"),
  requireHrPermission("people.edit"),
  runWorkforceSchedulerForCompany
);

/** Approve pending scheduler proposal on a task. */
router.post(
  "/tasks/:id/approve",
  authenticate,
  loadHrAccessContext,
  requireEntitledModule("work"),
  requireHrPermission("people.edit"),
  approveWorkforceSchedulerAssignment
);

export default router;

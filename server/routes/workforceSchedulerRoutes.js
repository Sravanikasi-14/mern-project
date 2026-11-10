import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import {
  runWorkforceSchedulerCron,
  runWorkforceSchedulerForCompany,
  approveWorkforceSchedulerAssignment,
} from "../controllers/workforceSchedulerController.js";

const router = express.Router();

/** Cron / automation — Bearer CRON_SECRET (no user session). */
router.get("/run", runWorkforceSchedulerCron);
router.post("/run", runWorkforceSchedulerCron);

/** Authenticated HR: dry-run (default) or apply for current tenant. */
router.post(
  "/company/run",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.edit"),
  runWorkforceSchedulerForCompany
);

/** Approve pending scheduler proposal on a task. */
router.post(
  "/tasks/:id/approve",
  authenticate,
  loadHrAccessContext,
  requireHrPermission("people.edit"),
  approveWorkforceSchedulerAssignment
);

export default router;

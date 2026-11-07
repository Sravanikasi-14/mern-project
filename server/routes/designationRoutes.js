import express from "express";
import {
  createDesignationHandler,
  deactivateDesignationHandler,
  listDesignationsHandler,
  updateDesignationHandler,
} from "../controllers/designationController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import { hasHrPermission } from "../services/hrAccessEnforcementService.js";
import { USER_ROLES } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

const router = express.Router();

const READ_KEYS = ["organization.view", "people.view", "people.create", "people.edit"];

function requireDesignationRead(req, res, next) {
  if (READ_KEYS.some((key) => hasHrPermission(req.hrAccess, key))) {
    return next();
  }
  return next(
    new HttpError(403, "You do not have permission to perform this action.", {
      code: "HR_PERMISSION_DENIED",
    })
  );
}

router.use(
  authenticate,
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext
);

router.get("/", requireDesignationRead, listDesignationsHandler);
router.post("/", requireHrPermission("organization.manage"), createDesignationHandler);
router.patch("/:designationId", requireHrPermission("organization.manage"), updateDesignationHandler);
router.post(
  "/:designationId/deactivate",
  requireHrPermission("organization.manage"),
  deactivateDesignationHandler
);

export default router;

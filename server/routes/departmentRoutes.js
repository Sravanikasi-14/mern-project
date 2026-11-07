import express from "express";
import {
  backfillDepartmentLinksHandler,
  backfillOrgEntitiesHandler,
  createDepartmentHandler,
  deactivateDepartmentHandler,
  getDepartmentHandler,
  listDepartmentsHandler,
  setEmployeeDepartmentHandler,
  updateDepartmentHandler,
} from "../controllers/departmentController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireHrPermission,
  requireEmployeeInScope,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext);

router.get("/", requireHrPermission("organization.view"), listDepartmentsHandler);
router.get("/:departmentId", requireHrPermission("organization.view"), getDepartmentHandler);
router.post("/", requireHrPermission("organization.manage"), createDepartmentHandler);
router.post("/backfill-from-employees", requireHrPermission("organization.manage"), backfillOrgEntitiesHandler);
router.post("/backfill-department-links", requireHrPermission("organization.manage"), backfillDepartmentLinksHandler);
router.put(
  "/employees/:employeeId/membership",
  requireHrPermission("organization.manage"),
  requireEmployeeInScope((req) => req.params.employeeId),
  setEmployeeDepartmentHandler
);
router.patch("/:departmentId", requireHrPermission("organization.manage"), updateDepartmentHandler);
router.post("/:departmentId/deactivate", requireHrPermission("organization.manage"), deactivateDepartmentHandler);

export default router;

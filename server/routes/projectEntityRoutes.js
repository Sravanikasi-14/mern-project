import express from "express";
import {
  addProjectMemberHandler,
  createProjectHandler,
  deactivateProjectHandler,
  getProjectHandler,
  listEmployeeProjectsHandler,
  listProjectMembersHandler,
  listProjectsHandler,
  removeProjectMemberHandler,
  updateProjectHandler,
} from "../controllers/projectController.js";
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

router.get("/", requireHrPermission("organization.view"), listProjectsHandler);
router.get(
  "/employees/:employeeId/memberships",
  requireHrPermission("organization.view"),
  requireEmployeeInScope((req) => req.params.employeeId),
  listEmployeeProjectsHandler
);
router.get("/:projectId/members", requireHrPermission("organization.view"), listProjectMembersHandler);
router.get("/:projectId", requireHrPermission("organization.view"), getProjectHandler);
router.post("/", requireHrPermission("organization.manage"), createProjectHandler);
router.patch("/:projectId", requireHrPermission("organization.manage"), updateProjectHandler);
router.post("/:projectId/deactivate", requireHrPermission("organization.manage"), deactivateProjectHandler);
router.post(
  "/:projectId/members",
  requireHrPermission("organization.manage"),
  requireEmployeeInScope((req) => req.body?.employeeId),
  addProjectMemberHandler
);
router.post(
  "/:projectId/members/:employeeId/remove",
  requireHrPermission("organization.manage"),
  requireEmployeeInScope((req) => req.params.employeeId),
  removeProjectMemberHandler
);

export default router;

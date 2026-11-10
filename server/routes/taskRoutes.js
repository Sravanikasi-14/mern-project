import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  assignTask,
  startTask,
  submitEvidence,
  reviewTask,
  uploadTaskAttachment,
  getWorkManagementMeta,
} from "../controllers/taskController.js";

const router = express.Router();

// All task routes require authentication
// CA4-C: loadHrAccessContext is a no-op for non-HR; HR company-wide views enforce in controller
router.use(authenticate, loadHrAccessContext);

// Work Management metadata (assignable employees, departments, roles)
router.get("/meta", getWorkManagementMeta);

// Task CRUD and listing
router.post("/", requireHrPermission("people.edit"), createTask);
router.get("/", getTasks);
router.get("/:id", getTaskById);
router.patch("/:id", requireHrPermission("people.edit"), updateTask);
/** Manual assign for UNASSIGNED queue only — reuses assignUnassignedTaskService. */
router.post("/:id/assign", requireHrPermission("people.edit"), assignTask);

// Lifecycle actions. Employees pass through; enforced HR needs people.edit.
router.post("/:id/start", requireHrPermission("people.edit"), startTask);
router.post("/:id/submit", requireHrPermission("people.edit"), submitEvidence);
router.post("/:id/review", requireHrPermission("people.edit"), reviewTask);

// Evidence file upload
router.post("/upload", uploadTaskAttachment);

export default router;

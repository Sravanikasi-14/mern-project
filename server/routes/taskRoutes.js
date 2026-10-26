import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  startTask,
  submitEvidence,
  reviewTask,
  uploadTaskAttachment,
  getWorkManagementMeta,
} from "../controllers/taskController.js";

const router = express.Router();

// All task routes require authentication
router.use(authenticate);

// Work Management metadata (assignable employees, departments, roles)
router.get("/meta", getWorkManagementMeta);

// Task CRUD and listing
router.post("/", createTask);
router.get("/", getTasks);
router.get("/:id", getTaskById);
router.patch("/:id", updateTask);

// Lifecycle actions
router.post("/:id/start", startTask);
router.post("/:id/submit", submitEvidence);
router.post("/:id/review", reviewTask);

// Evidence file upload
router.post("/upload", uploadTaskAttachment);

export default router;

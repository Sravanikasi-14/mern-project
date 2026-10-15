import express from "express";
import {
  createEmployee,
  getEmployeeById,
  getEmployeeSummary,
  getEmployees,
  getMyProfile,
  updateEmployee,
} from "../controllers/employeeController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";

const router = express.Router();

// Authenticated employees can view their own profile
router.get("/me", authenticate, getMyProfile);

// Management routes restricted to HR_ADMIN
router.use(authenticate, requireRole(USER_ROLES.HR_ADMIN));

router.get("/summary", getEmployeeSummary);
router.get("/", getEmployees);
router.post("/", createEmployee);
router.get("/:id", getEmployeeById);
router.patch("/:id", updateEmployee);

export default router;

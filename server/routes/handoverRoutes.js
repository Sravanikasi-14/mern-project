import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { USER_ROLES } from "../models/User.js";
import {
  createHandover,
  getHandover,
  getHandoverByLeaveRequest,
  updateHandover,
  submitHandoverRequest,
  respondHandoverItem,
  reassignHandoverItem,
  decideHandover,
  coordinateHandover,
  cancelHandoverRequest,
  extendHandoverItem,
  myHandovers,
  hrListHandovers,
} from "../controllers/handoverController.js";

const router = Router();

router.use(authenticate);

// Static paths before /:id
router.get("/", requireRole(USER_ROLES.HR_ADMIN), hrListHandovers);
router.get("/mine", myHandovers);
router.post("/leave/:leaveRequestId", createHandover);
router.get("/leave/:leaveRequestId", getHandoverByLeaveRequest);

router.get("/:id", getHandover);
router.put("/:id", updateHandover);
router.post("/:id/submit", submitHandoverRequest);
router.post("/:id/coordinate", coordinateHandover);
router.post("/:id/items/:itemId/respond", respondHandoverItem);
router.post("/:id/items/:itemId/reassign", reassignHandoverItem);
router.post("/:id/items/:itemId/extend", extendHandoverItem);
router.post("/:id/decide", decideHandover);
router.post("/:id/cancel", cancelHandoverRequest);

export default router;

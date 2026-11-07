import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import { loadHrAccessContext, requireHrPermission } from "../middleware/hrAccessEnforcement.js";
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

router.use(authenticate, loadHrAccessContext);

// Static paths before /:id — HR company-wide list maps to leave.view (leave-linked workflow)
router.get(
  "/",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  requireHrPermission("leave.view"),
  hrListHandovers
);
router.get("/mine", myHandovers);
router.post("/leave/:leaveRequestId", createHandover);
router.get("/leave/:leaveRequestId", getHandoverByLeaveRequest);

router.get("/:id", getHandover);
router.put("/:id", updateHandover);
router.post("/:id/submit", submitHandoverRequest);
router.post("/:id/coordinate", requireHrPermission("leave.edit"), coordinateHandover);
router.post("/:id/items/:itemId/respond", respondHandoverItem);
router.post("/:id/items/:itemId/reassign", requireHrPermission("leave.edit"), reassignHandoverItem);
router.post("/:id/items/:itemId/extend", requireHrPermission("leave.edit"), extendHandoverItem);
router.post("/:id/decide", requireHrPermission("leave.approve"), decideHandover);
router.post("/:id/cancel", requireHrPermission("leave.edit"), cancelHandoverRequest);

export default router;

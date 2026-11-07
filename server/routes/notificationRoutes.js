import express from "express";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notificationController.js";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext } from "../middleware/hrAccessEnforcement.js";

const router = express.Router();

router.use(authenticate, loadHrAccessContext);

router.get("/", getNotifications);
router.patch("/:id/read", markNotificationRead);
router.post("/mark-all-read", markAllNotificationsRead);

export default router;

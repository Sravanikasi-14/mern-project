import { Router } from "express";
import {
  getAnnouncementById,
  getAnnouncementReadStatus,
  getAnnouncements,
  patchAnnouncement,
  postAnnouncement,
  postAnnouncementRead,
  postPublishAnnouncement,
  postWithdrawAnnouncement,
  publishDueAnnouncementsNow,
} from "../controllers/announcementController.js";
import { authenticate } from "../middleware/authenticate.js";
import { loadHrAccessContext } from "../middleware/hrAccessEnforcement.js";

const router = Router();

/**
 * Company announcements — intentionally NOT a Platform Admin catalogue module.
 * Gated by tenant HR permissions (`announcements.*`) inside the service layer.
 * See platformFeatureCatalog.js header. Do not add requireEntitledModule here
 * without an explicit product decision to introduce an announcements platform module.
 */
router.get("/publish-due", publishDueAnnouncementsNow);
router.post("/publish-due", publishDueAnnouncementsNow);

router.use(authenticate, loadHrAccessContext);

router.get("/", getAnnouncements);
router.post("/", postAnnouncement);
router.get("/:id/read-status", getAnnouncementReadStatus);
router.post("/:id/read", postAnnouncementRead);
router.post("/:id/publish", postPublishAnnouncement);
router.post("/:id/withdraw", postWithdrawAnnouncement);
router.get("/:id", getAnnouncementById);
router.patch("/:id", patchAnnouncement);

export default router;

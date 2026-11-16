import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
import {
  loadHrAccessContext,
  requireEntitledModule,
  requireHrPermission,
  requireEmployeeInScope,
} from "../middleware/hrAccessEnforcement.js";
import { USER_ROLES } from "../models/User.js";
import {
  listAssets,
  createAsset,
  getAssetDetails,
  updateAsset,
  assignAsset,
  returnAsset,
  deleteAsset,
  getMyAssets,
  acknowledgeAssetReceipt,
} from "../controllers/assetController.js";

const router = express.Router();

// All asset routes require an authenticated tenant context
router.use(authenticate);

// Employee self-service — module gate + controller ownership
router.get("/my-assets", requireEntitledModule("assets"), getMyAssets);
router.post(
  "/my-assets/:id/acknowledge",
  requireEntitledModule("assets"),
  acknowledgeAssetReceipt
);

// HR Admin asset management
router.get("/", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.view"), listAssets);
router.post("/", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.create"), createAsset);
router.get("/:id", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.view"), getAssetDetails);
router.put("/:id", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.edit"), updateAsset);
router.post(
  "/:id/assign",
  requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN),
  loadHrAccessContext,
  requireHrPermission("assets.assign"),
  requireEmployeeInScope((req) => req.body?.employeeId || req.body?.assignedToEmployeeId),
  assignAsset
);
router.post("/:id/return", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.return"), returnAsset);
router.delete("/:id", requireRole(USER_ROLES.HR_ADMIN, USER_ROLES.COMPANY_ADMIN), loadHrAccessContext, requireHrPermission("assets.delete"), deleteAsset);

export default router;

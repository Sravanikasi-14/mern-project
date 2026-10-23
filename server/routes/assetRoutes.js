import express from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/authorize.js";
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

// ==========================================
// Employee Self-Service Asset Endpoints
// Accessible to authenticated employees
// ==========================================
router.get("/my-assets", getMyAssets);
router.post("/my-assets/:id/acknowledge", acknowledgeAssetReceipt);

// ==========================================
// HR Admin Asset Management Endpoints
// Restricted exclusively to HR_ADMIN
// ==========================================
router.get("/", requireRole(USER_ROLES.HR_ADMIN), listAssets);
router.post("/", requireRole(USER_ROLES.HR_ADMIN), createAsset);
router.get("/:id", requireRole(USER_ROLES.HR_ADMIN), getAssetDetails);
router.put("/:id", requireRole(USER_ROLES.HR_ADMIN), updateAsset);
router.post("/:id/assign", requireRole(USER_ROLES.HR_ADMIN), assignAsset);
router.post("/:id/return", requireRole(USER_ROLES.HR_ADMIN), returnAsset);
router.delete("/:id", requireRole(USER_ROLES.HR_ADMIN), deleteAsset);

export default router;

import { Router } from "express";
import { authenticatePlatformAdmin } from "../middleware/authenticatePlatformAdmin.js";
import { platformOriginGuard } from "../middleware/platformOriginGuard.js";
import {
  platformLoginLimiter,
  platformMfaLimiter,
} from "../middleware/platformLoginLimiter.js";
import * as authController from "../controllers/platformAuthController.js";
import * as companyController from "../controllers/platformCompanyController.js";
import * as featureController from "../controllers/platformFeatureController.js";
import * as planController from "../controllers/platformPlanController.js";
import * as insightsController from "../controllers/platformInsightsController.js";
import * as settingsController from "../controllers/platformSettingsController.js";

const router = Router();

// —— Auth (public) ——
router.post("/auth/login", platformLoginLimiter, authController.login);
router.post("/auth/mfa/setup/start", platformMfaLimiter, authController.mfaSetupStart);
router.post("/auth/mfa/setup/confirm", platformMfaLimiter, authController.mfaSetupConfirm);
router.post("/auth/mfa/verify", platformMfaLimiter, authController.mfaVerify);

// —— Authenticated platform surface ——
router.use(platformOriginGuard);
router.use(authenticatePlatformAdmin);

router.post("/auth/logout", authController.logout);
router.get("/auth/me", authController.me);

router.get("/overview", companyController.overview);

router.get("/companies", companyController.listCompanies);
router.post("/companies", companyController.createCompany);
router.get("/companies/:companyId", companyController.getCompany);
router.patch("/companies/:companyId", companyController.updateCompany);
router.post("/companies/:companyId/status", companyController.setCompanyStatus);
router.post("/companies/:companyId/reprovision", companyController.reprovisionCompany);

// Modules & Features (Batch 2)
router.get("/modules", featureController.getModules);
router.patch("/modules", featureController.patchGlobalModules);
router.get("/modules/history", featureController.getFeatureHistory);
router.get("/modules/:moduleKey/impact", featureController.previewModuleImpact);
router.get("/companies/:companyId/features", featureController.getCompanyFeatures);
router.patch("/companies/:companyId/features", featureController.patchCompanyFeatures);

// Plans, subscriptions & billing (Batch 3)
router.get("/plans", planController.list);
router.get("/plans/comparison", planController.comparison);
router.post("/plans", planController.create);
router.get("/plans/:planId", planController.getOne);
router.patch("/plans/:planId", planController.patch);

router.get("/companies/:companyId/subscription", planController.getSubscription);
router.patch("/companies/:companyId/subscription", planController.patchSubscription);
router.post("/companies/:companyId/invoices", planController.postInvoice);
router.post("/invoices/:invoiceId/payments", planController.postInvoicePayment);
router.post("/invoices/:invoiceId/void", planController.postInvoiceVoid);

// Insights & Settings (Batch 4)
router.get("/insights", insightsController.getInsights);
router.get("/settings", settingsController.getSettings);
router.patch("/settings", settingsController.patchSettings);
router.get("/audit", settingsController.listAudit);

export default router;

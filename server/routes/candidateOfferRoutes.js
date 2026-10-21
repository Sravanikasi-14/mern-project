import express from "express";
import {
  acceptAndSignOffer,
  declineOffer,
  downloadOfferReviewPdf,
  getOfferForReview,
} from "../controllers/candidateOfferController.js";

const router = express.Router();

// Candidate token-secured endpoints (no session login required, validated via cryptographically signed token)
router.get("/review/:token", getOfferForReview);
router.post("/review/:token/accept", acceptAndSignOffer);
router.post("/review/:token/decline", declineOffer);
router.get("/review/:token/pdf", downloadOfferReviewPdf);

export default router;

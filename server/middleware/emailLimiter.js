import rateLimit from "express-rate-limit";
import { createMongoRateLimitStore } from "./mongoRateLimitStore.js";

/**
 * Rate limit for outbound email actions (offer send, test email, invites).
 * Protects Gmail / SMTP providers from burst sends that trigger lockouts.
 * F65 — shared Mongo store for multi-instance consistency.
 */
export const emailSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.EMAIL_HTTP_RATE_LIMIT_PER_MINUTE, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: false,
  store: createMongoRateLimitStore({ prefix: "rl:email:" }),
  skip: () => process.env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message:
        "Too many email requests. Please wait a minute before sending again.",
    });
  },
});

import rateLimit from "express-rate-limit";
import { createMongoRateLimitStore } from "./mongoRateLimitStore.js";

export const platformLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: false,
  store: createMongoRateLimitStore({ prefix: "rl:platform-login:" }),
  skip: () => process.env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many platform login attempts. Please try again later.",
    });
  },
});

export const platformMfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "production" ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: false,
  store: createMongoRateLimitStore({ prefix: "rl:platform-mfa:" }),
  skip: () => process.env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many MFA attempts. Please try again later.",
    });
  },
});

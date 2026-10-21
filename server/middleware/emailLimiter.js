import rateLimit from "express-rate-limit";

/**
 * Rate limit for outbound email actions (offer send, test email, invites).
 * Protects Gmail / SMTP providers from burst sends that trigger lockouts.
 */
export const emailSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.EMAIL_HTTP_RATE_LIMIT_PER_MINUTE, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message:
        "Too many email requests. Please wait a minute before sending again.",
    });
  },
});

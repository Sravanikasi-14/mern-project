import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import offerLetterRoutes from "./routes/offerLetterRoutes.js";
import settlementRoutes from "./routes/settlementRoutes.js";
import candidateOfferRoutes from "./routes/candidateOfferRoutes.js";
import candidateOnboardingRoutes from "./routes/candidateOnboardingRoutes.js";
import onboardingReviewRoutes from "./routes/onboardingReviewRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();
  const clientUrl = process.env.CLIENT_URL;

  // Trust first proxy (Render, Heroku, Nginx) for secure cookies & req.protocol
  app.set("trust proxy", 1);

  const explicitOrigins = [
    "https://mern-project-nu-nine.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
  ];

  if (process.env.CLIENT_URL) {
    explicitOrigins.push(process.env.CLIENT_URL.trim().replace(/\/+$/, ""));
  }
  if (process.env.FRONTEND_URL) {
    explicitOrigins.push(process.env.FRONTEND_URL.trim().replace(/\/+$/, ""));
  }

  const corsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, same-origin, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      const cleanOrigin = origin.trim().replace(/\/+$/, "");
      if (explicitOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }
      try {
        const url = new URL(cleanOrigin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return callback(null, true);
        }
        if (url.hostname.endsWith(".vercel.app")) {
          return callback(null, true);
        }
        if (url.hostname.endsWith(".onrender.com")) {
          return callback(null, true);
        }
      } catch {
        // ignore parsing error
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    exposedHeaders: ["Set-Cookie"],
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));

  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());

  // Health check endpoint for service health monitoring and serverless deployment verification
  const healthHandler = (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "hrms-api",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    });
  };
  app.get("/api/health", healthHandler);
  app.get("/health", healthHandler);

  // API Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/employees", employeeRoutes);
  app.use("/api/leave-requests", leaveRoutes);
  app.use("/api/offer-letters", offerLetterRoutes);
  app.use("/api/settlements", settlementRoutes);

  // Hiring pipeline: Candidate offer review & signing, onboarding form, and HR review
  app.use("/api/candidate/offers", candidateOfferRoutes);
  app.use("/api/offers", candidateOfferRoutes);
  app.use("/api/candidate/onboarding", candidateOnboardingRoutes);
  app.use("/api/onboarding", onboardingReviewRoutes);
  app.use("/api/settings", settingsRoutes);

  // Serve static assets from production client build (Single-Service Architecture)
  const distPath = path.resolve(__dirname, "../client/dist");
  app.use(express.static(distPath));

  // SPA fallback for React Router client-side routes (e.g. /login, /admin, /app, /onboard)
  app.use((req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ code: "NOT_FOUND", message: "API endpoint not found" });
    }
    const indexPath = path.join(distPath, "index.html");
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(200).json({ message: "HRMS API is running. Client build not found." });
      }
    });
  });

  app.use(errorHandler);

  return app;
}

import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  const clientUrl = process.env.CLIENT_URL;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        if (clientUrl && origin === clientUrl) {
          return callback(null, true);
        }
        try {
          const url = new URL(origin);
          if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
            return callback(null, true);
          }
        } catch {
          // ignore parsing error
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());

  app.get("/", (_req, res) => {
    res.json({ message: "MERN API is running" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/employees", employeeRoutes);

  app.use(errorHandler);

  return app;
}

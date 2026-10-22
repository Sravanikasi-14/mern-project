
import dotenv from "dotenv";

dotenv.config();

import { createApp } from "../app.js";
import { connectCentralDB } from "../config/db.js";

// Cache the Express app and initialization promise across warm invocations.
let cachedApp = null;
let initializationPromise = null;

async function ensureReady() {
  if (cachedApp && initializationPromise) {
    await initializationPromise;
    return cachedApp;
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (!process.env.MONGO_URI) {
        const error = new Error("MONGO_URI is not configured.");
        error.statusCode = 500;
        throw error;
      }

      await connectCentralDB();

      // Never run expensive tenant provisioning automatically on Vercel.
      if (
        process.env.VERCEL !== "1" &&
        process.env.SKIP_TENANT_PROVISION !== "true"
      ) {
        const { provisionAllTenantDatabases } = await import(
          "../services/tenantProvisioningService.js"
        );

        await provisionAllTenantDatabases();
      }

      cachedApp = createApp();
      return cachedApp;
    })().catch((error) => {
      initializationPromise = null;
      cachedApp = null;
      throw error;
    });
  }

  await initializationPromise;
  return cachedApp;
}

function getRequestPath(req) {
  const rawPath = req.url || "/";
  const queryIndex = rawPath.indexOf("?");
  const pathname =
    queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);

  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export default async function handler(req, res) {
  // Let Express/CORS answer browser preflight requests without connecting to MongoDB.
  if (req.method === "OPTIONS") {
    try {
      const app = cachedApp || createApp();
      return app(req, res);
    } catch (error) {
      console.error("[Vercel API] Preflight failed:", error.message);
      res.statusCode = 500;
      return res.end();
    }
  }

  // Root endpoint and health checks use existing Express endpoints without blocking on DB initialization
  const requestPath = getRequestPath(req);
  if (requestPath === "/" || requestPath === "/api/health" || requestPath === "/health") {
    try {
      const app = cachedApp || createApp();
      return app(req, res);
    } catch (error) {
      console.error("[Vercel API] Root/health request failed:", error.message);
      res.statusCode = 500;
      return res.end();
    }
  }

  try {
    const app = await ensureReady();
    return app(req, res);
  } catch (error) {
    console.error("[Vercel API] Initialization failed:", error.message);

    if (res.headersSent) {
      return res.end();
    }

    res.statusCode = error.statusCode || 503;
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        status: "error",
        code: "DATABASE_UNAVAILABLE",
        message:
          error.statusCode === 500
            ? "Backend configuration is incomplete."
            : "Backend is temporarily unavailable.",
      })
    );
  }
}

export { createApp, handler };

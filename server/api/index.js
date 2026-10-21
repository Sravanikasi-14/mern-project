import dotenv from "dotenv";

dotenv.config();

let app;
let ready;

async function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const { connectCentralDB } = await import("../config/db.js");
      const { createApp } = await import("../app.js");

      if (!process.env.MONGO_URI) {
        const err = new Error(
          "MONGO_URI is not set. Add it in Vercel → Project → Settings → Environment Variables."
        );
        err.statusCode = 500;
        throw err;
      }

      await connectCentralDB();

      // Skip heavy multi-tenant provisioning on serverless cold starts.
      // Per-tenant indexes are ensured lazily when a company is accessed (non-Vercel),
      // or already exist from prior Render / local runs.
      if (process.env.VERCEL !== "1" && process.env.SKIP_TENANT_PROVISION !== "true") {
        try {
          const { provisionAllTenantDatabases } = await import(
            "../services/tenantProvisioningService.js"
          );
          await provisionAllTenantDatabases();
        } catch (provErr) {
          console.warn(
            "[api] Tenant provisioning warning on cold start:",
            provErr.message
          );
        }
      }

      app = createApp();
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}

/** Path only — Vercel rewrites can bring a query string along. */
function pathOf(req) {
  const raw = req.url || "/";
  const i = raw.indexOf("?");
  const path = i === -1 ? raw : raw.slice(0, i);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

const STATUS_PATHS = new Set(["/", "/api", "/health", "/api/health", "/index"]);

export default async function handler(req, res) {
  if (STATUS_PATHS.has(pathOf(req))) {
    try {
      await ensureReady();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          service: "hrms-api",
          runtime: "vercel",
          environment: process.env.NODE_ENV || "production",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "error",
          service: "hrms-api",
          runtime: "vercel",
          error: err.message || "Startup failed",
          hint: "Check Vercel env vars: MONGO_URI, JWT_SECRET, CLIENT_URL, SMTP_USER, SMTP_APP_PASSWORD",
        })
      );
      return;
    }
  }

  try {
    await ensureReady();
    return app(req, res);
  } catch (err) {
    console.error("[api] request failed before Express could answer", err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = err.statusCode || 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "error",
        error: err.message || "Internal Server Error",
      })
    );
  }
}

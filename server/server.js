import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { connectCentralDB } from "./config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const startServer = async () => {
  try {
    await connectCentralDB();

    // Skip heavy multi-tenant provisioning on Vercel serverless cold starts.
    if (process.env.VERCEL !== "1" && process.env.SKIP_TENANT_PROVISION !== "true") {
      try {
        const { provisionAllTenantDatabases } = await import("./services/tenantProvisioningService.js");
        const provReport = await provisionAllTenantDatabases();
        if (provReport.repaired.length > 0) {
          console.log(`[Provisioning] Repaired/provisioned ${provReport.repaired.length} tenant database(s):`, provReport.repaired.map(r => r.databaseName));
        }
      } catch (provErr) {
        console.warn("[Provisioning] Tenant provisioning warning on startup:", provErr.message);
      }
    }

    const app = createApp();

    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error("Unable to start the server:", err.message || err);
    process.exit(1);
  }
};

startServer();

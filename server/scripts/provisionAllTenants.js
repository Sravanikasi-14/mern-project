import dotenv from "dotenv";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import {
  provisionAllTenantDatabases,
  TENANT_INDEX_SCHEMA_VERSION,
} from "../services/tenantProvisioningService.js";

dotenv.config();

async function run() {
  console.log("================================================================");
  console.log("Starting Tenant Database Provisioning / Index Ensure (F43/F44)");
  console.log(`Target index schema version: ${TENANT_INDEX_SCHEMA_VERSION}`);
  console.log("================================================================");

  await connectCentralDB();

  const report = await provisionAllTenantDatabases();

  console.log(`\nChecked ${report.checked.length} of ${report.totalCompanies} tenant database(s):`);
  for (const c of report.checked) {
    console.log(`  • Company: ${c.slug.padEnd(16)} Database: ${c.databaseName}`);
  }

  if (report.repaired.length > 0) {
    console.log(`\nRepaired / Newly Provisioned (${report.repaired.length}):`);
    for (const r of report.repaired) {
      console.log(`  • [${r.slug}] DB: ${r.databaseName}`);
      if (r.collectionsCreated.length > 0) {
        console.log(`      Collections created: ${r.collectionsCreated.join(", ")}`);
      }
      if (r.policyProvisioned) {
        console.log(`      Initial company HR policy seeded: Yes`);
      }
      if (r.policyUpdated) {
        console.log(`      Policy attendanceRules updated: Yes`);
      }
      if (r.tenantIndexSchemaVersionStamped != null) {
        console.log(`      Index schema stamped: v${r.tenantIndexSchemaVersionStamped}`);
      }
    }
  } else if (!(report.indexIncomplete || []).length) {
    console.log("\nAll tenant databases already have leave collections and valid policies.");
  }

  if ((report.indexIncomplete || []).length > 0) {
    console.log(`\nIndex provisioning incomplete (${report.indexIncomplete.length}):`);
    for (const row of report.indexIncomplete) {
      console.log(`  • [${row.slug}] DB: ${row.databaseName}`);
      for (const f of row.indexFailures || []) {
        console.log(`      - ${f.collection} [${f.phase}]: ${f.message}`);
      }
    }
  }

  if (report.needsManualConfiguration.length > 0) {
    console.log(`\nCompanies needing manual configuration (${report.needsManualConfiguration.length}):`);
    for (const n of report.needsManualConfiguration) {
      console.log(`  • [${n.slug}] DB: ${n.databaseName}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`\nErrors encountered (${report.errors.length}):`);
    for (const e of report.errors) {
      console.log(`  • [${e.slug || "UNKNOWN"}] ${e.error}`);
    }
    process.exitCode = 1;
  }

  console.log("\n================================================================");
  console.log(
    report.errors.length
      ? "Tenant Database Provisioning Completed With Errors"
      : "Tenant Database Provisioning Completed Successfully"
  );
  console.log("================================================================");
}

run()
  .catch((err) => {
    console.error("Fatal error during tenant provisioning:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
  });

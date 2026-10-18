import dotenv from "dotenv";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import { provisionAllTenantDatabases } from "../services/tenantProvisioningService.js";

dotenv.config();

async function run() {
  console.log("================================================================");
  console.log("🚀 Starting Tenant Database Leave & Policy Provisioning / Migration");
  console.log("================================================================");

  await connectCentralDB();

  const report = await provisionAllTenantDatabases();

  console.log(`\nChecked ${report.checked.length} of ${report.totalCompanies} tenant database(s):`);
  for (const c of report.checked) {
    console.log(`  • Company: ${c.slug.padEnd(16)} Database: ${c.databaseName}`);
  }

  if (report.repaired.length > 0) {
    console.log(`\n🛠️  Repaired / Newly Provisioned (${report.repaired.length}):`);
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
    }
  } else {
    console.log("\n✅ All tenant databases already have leave collections and valid policies.");
  }

  if (report.needsManualConfiguration.length > 0) {
    console.log(`\n⚠️  Companies needing manual policy configuration (${report.needsManualConfiguration.length}):`);
    for (const n of report.needsManualConfiguration) {
      console.log(`  • [${n.slug}] DB: ${n.databaseName}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`\n❌ Errors encountered (${report.errors.length}):`);
    for (const e of report.errors) {
      console.log(`  • [${e.slug || "UNKNOWN"}] ${e.error}`);
    }
  }

  console.log("\n================================================================");
  console.log("🏁 Tenant Database Provisioning Completed Successfully");
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

/**
 * Explicit migration for offer_letters employeeId uniqueness index.
 *
 * Dry-run (default):
 *   node server/scripts/migrateOfferLetterEmployeeIdIndex.js
 *
 * Apply (drops known-safe legacy employeeId_1, creates uniq_offer_letter_employeeId_objectId):
 *   node server/scripts/migrateOfferLetterEmployeeIdIndex.js --apply
 *
 * Does not delete offer or employee documents. Aborts if duplicate ObjectId employeeIds exist.
 */
import dotenv from "dotenv";
dotenv.config();

import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { connectCentralDB, disconnectAll, getTenantConnection } from "../config/db.js";
import { ensureOfferLetterEmployeeIdIndex } from "../services/offerLetterEmployeeIdIndex.js";

const apply = process.argv.includes("--apply");

async function main() {
  await connectCentralDB();
  const companies = await Company.find({
    status: { $in: [COMPANY_STATUSES.ACTIVE, COMPANY_STATUSES.SUSPENDED] },
  }).lean();

  console.log(
    apply
      ? "APPLY mode: will drop legacy employeeId_1 when safe and create named unique partial index."
      : "DRY-RUN mode: no indexes will be dropped. Pass --apply to migrate."
  );

  const results = [];
  for (const company of companies) {
    if (!company.databaseName) continue;
    const conn = await getTenantConnection(company.databaseName);
    const result = await ensureOfferLetterEmployeeIdIndex(conn.db, { applyMigration: apply });
    results.push({ slug: company.slug, databaseName: company.databaseName, ...result });
    console.log(`\n[${company.slug} / ${company.databaseName}] status=${result.status}`);
    console.log(`  ${result.message}`);
    if (result.duplicates?.length) {
      console.log(`  duplicates: ${JSON.stringify(result.duplicates)}`);
    }
  }

  const errors = results.filter((r) => r.status === "error");
  const needed = results.filter((r) => r.status === "migration_required");
  console.log(`\nSummary: ${results.length} tenants, ${needed.length} need migration, ${errors.length} errors.`);
  await disconnectAll();
  if (errors.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectAll();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

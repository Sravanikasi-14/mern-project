/**
 * F43 — Read-only tenant index inventory.
 *
 * Compares actual MongoDB indexes to Mongoose schema expectations.
 * Does NOT create, drop, prune, or sync indexes. Does NOT stamp companies.
 *
 * Usage:
 *   node scripts/inventoryTenantIndexes.js
 *   node scripts/inventoryTenantIndexes.js --company=acme
 */
import dotenv from "dotenv";
import Company from "../models/Company.js";
import {
  connectCentralDB,
  disconnectAll,
  getCentralDbName,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import {
  TENANT_INDEX_SCHEMA_VERSION,
  inventoryTenantConnection,
} from "../services/tenantIndexInventory.js";

dotenv.config();

function parseArgs(argv) {
  const out = { company: "" };
  for (const arg of argv) {
    if (arg.startsWith("--company=")) out.company = arg.slice("--company=".length).trim();
  }
  return out;
}

async function inventoryOne(company) {
  return runWithTenantConnectionScope(async () => {
    const conn = await getTenantConnection(company.databaseName);
    const inventory = await inventoryTenantConnection(conn);
    return {
      slug: company.slug,
      databaseName: company.databaseName,
      stampedVersion: company.tenantIndexSchemaVersion ?? null,
      stampedAt: company.tenantIndexProvisionedAt ?? null,
      requiredVersion: TENANT_INDEX_SCHEMA_VERSION,
      ...inventory,
    };
  });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  console.log("================================================================");
  console.log("F43 read-only tenant index inventory");
  console.log(`Required index schema version: ${TENANT_INDEX_SCHEMA_VERSION}`);
  console.log("================================================================");

  await connectCentralDB();
  const centralDb = getCentralDbName();

  const filter = args.company
    ? { slug: String(args.company).toLowerCase() }
    : {};
  const companies = await Company.find(filter)
    .select("slug databaseName tenantIndexSchemaVersion tenantIndexProvisionedAt")
    .lean();

  if (args.company && companies.length === 0) {
    console.error(`No company found for slug=${args.company}`);
    process.exitCode = 1;
    return;
  }

  const report = {
    requiredVersion: TENANT_INDEX_SCHEMA_VERSION,
    checked: 0,
    ok: [],
    incomplete: [],
    errors: [],
  };

  for (const company of companies) {
    if (company.databaseName === centralDb) {
      report.errors.push({
        slug: company.slug,
        error: "Skipped central platform database",
      });
      continue;
    }

    report.checked += 1;
    try {
      const row = await inventoryOne(company);
      const versionDrift =
        row.stampedVersion !== TENANT_INDEX_SCHEMA_VERSION
          ? `stamped=${row.stampedVersion ?? "null"} required=${TENANT_INDEX_SCHEMA_VERSION}`
          : null;

      if (!row.ok || versionDrift) {
        report.incomplete.push({
          slug: row.slug,
          databaseName: row.databaseName,
          missingCount: row.missingCount,
          versionDrift,
          models: row.models.filter((m) => !m.ok),
        });
        console.log(
          `✗ ${row.slug} (${row.databaseName}) missing=${row.missingCount}` +
            (versionDrift ? ` ${versionDrift}` : "")
        );
        for (const m of row.models.filter((x) => !x.ok)) {
          console.log(
            `    - ${m.label}/${m.collection}: ${
              m.error || JSON.stringify(m.missing)
            }`
          );
        }
      } else {
        report.ok.push({
          slug: row.slug,
          databaseName: row.databaseName,
          stampedVersion: row.stampedVersion,
        });
        console.log(
          `✓ ${row.slug} (${row.databaseName}) indexes ok, stamped v${row.stampedVersion}`
        );
      }
    } catch (err) {
      report.errors.push({ slug: company.slug, error: err.message });
      console.error(`✗ ${company.slug}: ${err.message}`);
    }
  }

  console.log("\n----------------------------------------------------------------");
  console.log(
    `Checked ${report.checked} | ok ${report.ok.length} | incomplete ${report.incomplete.length} | errors ${report.errors.length}`
  );
  console.log("----------------------------------------------------------------");

  if (report.incomplete.length || report.errors.length) {
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error("Fatal inventory error:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
  });

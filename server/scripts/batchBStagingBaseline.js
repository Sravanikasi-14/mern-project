/**
 * Batch B Phase 1 — staging-only baseline for F43/F45/F73.
 * Read-mostly: inventories TTL indexes, AuthSession purgeAt gaps, duplicate ACTIVE tracking.
 * Does not mutate data except via explicit later provision/cleanup scripts.
 */
import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import Company from "../models/Company.js";
import {
  connectCentralDB,
  disconnectAll,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import {
  getTenantEphemeralTtlSpecs,
  inventoryTtlIndexes,
} from "../services/ephemeralTtlIndexes.js";
import { inventoryTenantConnection } from "../services/tenantIndexInventory.js";

async function baselineOne(company) {
  return runWithTenantConnectionScope(async () => {
    const conn = await getTenantConnection(company.databaseName);
    const inventory = await inventoryTenantConnection(conn);
    const ttl = await inventoryTtlIndexes(conn.db);
    const expectedTtl = getTenantEphemeralTtlSpecs();
    const sessions = conn.db.collection("authSessions");
    const total = await sessions.countDocuments({});
    const missingPurge = await sessions.countDocuments({
      purgeAt: { $exists: false },
      expiresAt: { $exists: true },
    });
    const withPurge = await sessions.countDocuments({
      purgeAt: { $exists: true },
    });
    const dupActive = await conn.db
      .collection("live_tracking_sessions")
      .aggregate([
        { $match: { status: "ACTIVE" } },
        {
          $group: {
            _id: "$employeeId",
            n: { $sum: 1 },
            newest: { $max: "$startedAt" },
            ids: { $push: "$_id" },
          },
        },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();

    const ttlPresent = expectedTtl.map((spec) => {
      const hit = ttl.find(
        (t) => t.collection === spec.collectionName && t.name === spec.name
      );
      return {
        collection: spec.collectionName,
        name: spec.name,
        present: Boolean(hit),
        expireAfterSeconds: hit?.expireAfterSeconds ?? null,
      };
    });

    return {
      slug: company.slug,
      databaseName: company.databaseName,
      stampedVersion: company.tenantIndexSchemaVersion ?? null,
      inventoryOk: inventory.ok,
      missingCount: inventory.missingCount,
      missing: (inventory.models || [])
        .filter((m) => !m.ok)
        .map((m) => ({
          label: m.label,
          collection: m.collection,
          missing: m.missing,
        })),
      ttlPresent,
      authSessions: { total, withPurge, missingPurgeAt: missingPurge },
      duplicateActiveTrackingGroups: dupActive.length,
      duplicateActiveDetails: dupActive.slice(0, 50).map((d) => ({
        employeeId: String(d._id),
        count: d.n,
        newest: d.newest,
      })),
    };
  });
}

async function main() {
  await connectCentralDB();
  const companies = await Company.find({})
    .select("slug databaseName tenantIndexSchemaVersion")
    .lean();
  const rows = [];
  for (const company of companies) {
    if (!company.databaseName) continue;
    rows.push(await baselineOne(company));
  }

  const outDir = path.resolve(process.cwd(), "../tmp-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "batch-b-staging-baseline.json");
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(`\nWrote ${outPath}`);
  await disconnectAll();
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

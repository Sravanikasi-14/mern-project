/**
 * Prepare / verify isolated central DB `platform_staging` on the shared Atlas cluster.
 *
 * Modes (choose one):
 *   node scripts/preparePlatformStagingDb.js --verify
 *   node scripts/preparePlatformStagingDb.js --init --i-confirm-staging
 *   node scripts/preparePlatformStagingDb.js --provision-demo-company --i-confirm-staging
 *
 * Required env for any mode:
 *   MONGO_URI                      Atlas URI (same cluster OK; never logged in full)
 *   CENTRAL_DB_NAME=platform_staging
 *   ALLOW_STAGING_DB_SETUP=true
 *   STAGING_DB_CONFIRM=platform_staging
 *
 * Write modes additionally require:
 *   --i-confirm-staging
 *
 * Safety:
 * - Refuses CENTRAL_DB_NAME=platform (production central name).
 * - Never copies production data.
 * - Never prints credentials.
 * - Demo company tenant DB names must use the staging prefix.
 *
 * This script does NOT run automatically and does NOT deploy anything.
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectCentralDB, disconnectAll, getCentralDbName } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { ensureCentralEphemeralTtlIndexes } from "../services/ephemeralTtlIndexes.js";
import { ensureDefaultPlansSeeded } from "../services/platformPlanService.js";
import {
  DISPATCH_HISTORY_COLLECTION,
  DISPATCH_JOB_COLLECTION,
  DISPATCH_LOCK_COLLECTION,
  JOB_KEYS,
  ensureDispatchJobRegistry,
  getDispatchHistoryModel,
  getDispatchJobModel,
  getDispatchLockModel,
} from "../services/schedulerDispatch/index.js";
import { FLEET_COLLECTION } from "../services/workforceScheduler/fleetProgress.js";

const STAGING_CENTRAL_NAME = "platform_staging";
const STAGING_TENANT_PREFIX = "company_staging_";

const mode = process.argv.includes("--init")
  ? "init"
  : process.argv.includes("--provision-demo-company")
    ? "provision-demo-company"
    : "verify";

function redactMongoUri(uri) {
  if (!uri || typeof uri !== "string") return "(missing)";
  try {
    const u = new URL(uri);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable-uri)";
  }
}

function assertStagingGuards() {
  const central = String(process.env.CENTRAL_DB_NAME || "").trim();
  const allow = String(process.env.ALLOW_STAGING_DB_SETUP || "").toLowerCase() === "true";
  const confirm = String(process.env.STAGING_DB_CONFIRM || "").trim();

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required (staging-capable Atlas URI). Value is never printed.");
  }
  if (!allow) {
    throw new Error("Refusing: set ALLOW_STAGING_DB_SETUP=true to acknowledge staging setup.");
  }
  if (central !== STAGING_CENTRAL_NAME) {
    throw new Error(
      `Refusing: CENTRAL_DB_NAME must be exactly "${STAGING_CENTRAL_NAME}" (got "${central || "(empty)"}").`
    );
  }
  if (confirm !== STAGING_CENTRAL_NAME) {
    throw new Error(
      `Refusing: STAGING_DB_CONFIRM must equal "${STAGING_CENTRAL_NAME}" (explicit operator confirmation).`
    );
  }
  if (getCentralDbName() === "platform") {
    throw new Error("Refusing: resolved central DB name is production name \"platform\".");
  }
  if (mode !== "verify" && !process.argv.includes("--i-confirm-staging")) {
    throw new Error(`Write mode "${mode}" requires --i-confirm-staging`);
  }
}

function isStagingTenantDbName(databaseName) {
  return typeof databaseName === "string" && databaseName.startsWith(STAGING_TENANT_PREFIX);
}

async function listCentralCollections(db) {
  const cols = await db.listCollections({}, { nameOnly: true }).toArray();
  return cols.map((c) => c.name).sort();
}

async function inventoryDispatcher(db) {
  const Job = getDispatchJobModel();
  const Lock = getDispatchLockModel();
  const History = getDispatchHistoryModel();
  const [jobs, locks, historyCount, jobIndexes, historyIndexes] = await Promise.all([
    Job.find({}).select("_id enabled nextRunAt executionMode").lean(),
    Lock.find({}).select("_id lockUntil holder").lean(),
    History.countDocuments({}),
    db.collection(DISPATCH_JOB_COLLECTION).indexes().catch(() => []),
    db.collection(DISPATCH_HISTORY_COLLECTION).indexes().catch(() => []),
  ]);
  return {
    jobs: jobs.map((j) => ({
      id: j._id,
      enabled: j.enabled,
      nextRunAt: j.nextRunAt || null,
      executionMode: j.executionMode,
    })),
    locks: locks.map((l) => ({
      id: l._id,
      lockUntil: l.lockUntil || null,
      holder: l.holder || "",
    })),
    historyCount,
    jobIndexNames: jobIndexes.map((i) => i.name),
    historyIndexNames: historyIndexes.map((i) => i.name),
  };
}

async function verifyIsolation(db) {
  const connectedName = db.databaseName;
  const companies = await Company.find({})
    .select("slug databaseName status")
    .lean();

  const badTenants = companies.filter((c) => !isStagingTenantDbName(c.databaseName));
  const report = {
    connectedCentralDb: connectedName,
    expectedCentralDb: STAGING_CENTRAL_NAME,
    centralIsolated: connectedName === STAGING_CENTRAL_NAME,
    companyCount: companies.length,
    companies: companies.map((c) => ({
      slug: c.slug,
      databaseName: c.databaseName,
      status: c.status,
      stagingPrefixed: isStagingTenantDbName(c.databaseName),
    })),
    tenantIsolationOk: badTenants.length === 0,
    unsafeTenantDatabaseNames: badTenants.map((c) => c.databaseName),
    stagingTenantPrefix: STAGING_TENANT_PREFIX,
    notes: [
      "Same Atlas cluster is expected; isolation is by dbName, not by cluster.",
      "Production central DB name \"platform\" must remain untouched.",
      `Staging tenant databaseName values must start with \"${STAGING_TENANT_PREFIX}\".`,
      "Do not reuse production Company.databaseName values from central \"platform\".",
    ],
  };

  if (!report.centralIsolated) {
    throw new Error(
      `Isolation failure: connected to "${connectedName}", expected "${STAGING_CENTRAL_NAME}".`
    );
  }
  return report;
}

async function runVerify() {
  await connectCentralDB();
  const db = mongoose.connection.db;
  const isolation = await verifyIsolation(db);
  const collections = await listCentralCollections(db);
  const dispatcher = await inventoryDispatcher(db);

  console.log(
    JSON.stringify(
      {
        mode: "verify",
        mongoUriRedacted: redactMongoUri(process.env.MONGO_URI),
        isolation,
        centralCollections: collections,
        dispatcher,
        expectedDispatcherCollections: [
          DISPATCH_JOB_COLLECTION,
          DISPATCH_LOCK_COLLECTION,
          DISPATCH_HISTORY_COLLECTION,
        ],
        relatedCentralCollections: [
          "companies",
          "platform_plans",
          "platform_admins",
          "platform_admin_sessions",
          "rate_limit_hits",
          "offer_template_masters",
          FLEET_COLLECTION,
        ],
        ok: isolation.centralIsolated && isolation.tenantIsolationOk,
      },
      null,
      2
    )
  );

  if (!isolation.tenantIsolationOk) {
    process.exitCode = 2;
    console.error(
      `[staging-db] FAIL: one or more Company.databaseName values lack prefix "${STAGING_TENANT_PREFIX}".`
    );
  } else {
    console.error("[staging-db] VERIFY OK — central DB isolated; tenant names staging-prefixed (or none yet).");
  }
}

async function runInit() {
  await connectCentralDB();
  const db = mongoose.connection.db;

  if (db.databaseName !== STAGING_CENTRAL_NAME) {
    throw new Error(`Init refused: connected db is "${db.databaseName}"`);
  }

  // Ephemeral TTL + plans are safe empty-DB seeds (not production copies).
  await ensureCentralEphemeralTtlIndexes(mongoose.connection);
  await ensureDefaultPlansSeeded();
  await ensureDispatchJobRegistry(new Date(), { updateMetadata: true });

  // Touch models so indexes are registered on first use.
  getDispatchJobModel();
  getDispatchLockModel();
  getDispatchHistoryModel();
  await getDispatchJobModel().createIndexes();
  await getDispatchHistoryModel().createIndexes();

  const isolation = await verifyIsolation(db);
  const dispatcher = await inventoryDispatcher(db);
  const collections = await listCentralCollections(db);

  console.log(
    JSON.stringify(
      {
        mode: "init",
        mongoUriRedacted: redactMongoUri(process.env.MONGO_URI),
        isolation,
        centralCollections: collections,
        dispatcher,
        seededJobKeys: Object.values(JOB_KEYS),
        ok: isolation.centralIsolated,
      },
      null,
      2
    )
  );
  console.error("[staging-db] INIT OK — platform_staging ready (no production data copied).");
}

async function runProvisionDemoCompany() {
  await connectCentralDB();
  const db = mongoose.connection.db;
  if (db.databaseName !== STAGING_CENTRAL_NAME) {
    throw new Error(`Provision refused: connected db is "${db.databaseName}"`);
  }

  const slug = "staging-dispatch-co";
  const databaseName = `${STAGING_TENANT_PREFIX}dispatch_co`;
  if (!isStagingTenantDbName(databaseName)) {
    throw new Error("Internal error: demo databaseName missing staging prefix");
  }

  const company = await Company.findOneAndUpdate(
    { slug },
    {
      companyName: "Staging Dispatch Co",
      slug,
      databaseName,
      migrationVersion: 0,
      status: COMPANY_STATUSES.ACTIVE,
      branding: {
        displayName: "Staging Dispatch Co",
        logoUrl: "",
        primaryColor: "#0f766e",
      },
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
        enabledModules: [],
      },
      primaryContact: {
        fullName: "Staging HR",
        email: "hr@staging-dispatch.test",
        phoneNumber: "",
      },
      schemaVersion: 1,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const { provisionTenantDatabase } = await import("../services/tenantProvisioningService.js");
  const prov = await provisionTenantDatabase(company);

  const isolation = await verifyIsolation(db);
  console.log(
    JSON.stringify(
      {
        mode: "provision-demo-company",
        company: {
          id: String(company._id),
          slug: company.slug,
          databaseName: company.databaseName,
          status: company.status,
        },
        provision: { message: prov?.message || "ok" },
        isolation,
        ok: isolation.centralIsolated && isolation.tenantIsolationOk,
      },
      null,
      2
    )
  );
  console.error(
    "[staging-db] DEMO COMPANY OK — tenant DB is staging-prefixed; run verify after HR user seed if needed."
  );
}

async function main() {
  assertStagingGuards();
  console.error(`[staging-db] mode=${mode} central=${STAGING_CENTRAL_NAME}`);
  console.error(`[staging-db] mongo=${redactMongoUri(process.env.MONGO_URI)}`);

  try {
    if (mode === "init") await runInit();
    else if (mode === "provision-demo-company") await runProvisionDemoCompany();
    else await runVerify();
  } finally {
    await disconnectAll().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[staging-db] ERROR:", err?.message || err);
  process.exit(1);
});

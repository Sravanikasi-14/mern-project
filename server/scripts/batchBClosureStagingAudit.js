/**
 * Batch B closure — staging-only READ audit.
 * Does not create/drop/modify indexes or delete data.
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
import { getEmployeeModel } from "../models/Employee.js";
import { getLiveTrackingSessionModel } from "../models/LiveTrackingSession.js";
import { getAuthSessionModel } from "../models/AuthSession.js";
import { getUserModel } from "../models/User.js";
import { getNotificationReadStateModel } from "../models/NotificationReadState.js";
import {
  getTenantEphemeralTtlSpecs,
  inventoryTtlIndexes,
} from "../services/ephemeralTtlIndexes.js";
import {
  inventoryTenantConnection,
  TENANT_INDEX_SCHEMA_VERSION,
  expectedIndexesFromSchema,
} from "../services/tenantIndexInventory.js";
import { ACTIVE_EMPLOYEE_UNIQUE_INDEX } from "../services/liveTrackingActiveSession.js";
import { loadUserReadNotificationKeys } from "../services/notificationReadStateService.js";

function summarizeIndex(ix) {
  return {
    name: ix.name,
    key: ix.key,
    unique: Boolean(ix.unique),
    sparse: Boolean(ix.sparse),
    partialFilterExpression: ix.partialFilterExpression || null,
    expireAfterSeconds:
      typeof ix.expireAfterSeconds === "number" ? ix.expireAfterSeconds : null,
  };
}

async function auditTenant(company) {
  return runWithTenantConnectionScope(async () => {
    const conn = await getTenantConnection(company.databaseName);
    const inventory = await inventoryTenantConnection(conn);
    const ttl = await inventoryTtlIndexes(conn.db);
    const expectedTtl = getTenantEphemeralTtlSpecs();

    const Employee = getEmployeeModel(conn);
    const LiveTrackingSession = getLiveTrackingSessionModel(conn);
    const AuthSession = getAuthSessionModel(conn);
    const User = getUserModel(conn);
    const NotificationReadState = getNotificationReadStateModel(conn);

    const employeeIndexes = (await Employee.collection.indexes()).map(summarizeIndex);
    const expectedEmployee = expectedIndexesFromSchema(Employee.schema).filter(
      (e) =>
        (e.key && Object.keys(e.key).length === 1 && e.key.email === 1) ||
        (e.key && Object.keys(e.key).length === 1 && e.key.userId === 1)
    );

    const emailDupes = await Employee.aggregate([
      {
        $group: {
          _id: "$email",
          n: { $sum: 1 },
          ids: { $push: "$_id" },
        },
      },
      { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
      { $sort: { n: -1 } },
      { $limit: 25 },
    ]);
    const emailNullOrEmpty = await Employee.countDocuments({
      $or: [
        { email: null },
        { email: "" },
        { email: { $exists: false } },
      ],
    });
    const emailTotal = await Employee.countDocuments({});

    const userIdDupes = await Employee.aggregate([
      {
        $group: {
          _id: "$userId",
          n: { $sum: 1 },
          ids: { $push: "$_id" },
        },
      },
      { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
      { $sort: { n: -1 } },
      { $limit: 25 },
    ]);
    const userIdMissing = await Employee.countDocuments({
      $or: [{ userId: null }, { userId: { $exists: false } }],
    });
    const userIdNonObjectId = await Employee.countDocuments({
      userId: { $exists: true, $ne: null, $not: { $type: "objectId" } },
    });

    const liveIndexes = (await LiveTrackingSession.collection.indexes()).map(
      summarizeIndex
    );
    const f73 = liveIndexes.find(
      (ix) => ix.name === ACTIVE_EMPLOYEE_UNIQUE_INDEX.name
    );
    const f73ByShape = liveIndexes.find(
      (ix) =>
        ix.unique &&
        JSON.stringify(ix.key) === JSON.stringify({ employeeId: 1 }) &&
        JSON.stringify(ix.partialFilterExpression || null) ===
          JSON.stringify({ status: "ACTIVE" })
    );
    const liveTtl = liveIndexes.filter(
      (ix) => typeof ix.expireAfterSeconds === "number"
    );
    const activeDupGroups = await LiveTrackingSession.aggregate([
      { $match: { status: "ACTIVE" } },
      { $group: { _id: "$employeeId", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);

    const authTotal = await AuthSession.countDocuments({});
    const authMissingPurge = await AuthSession.countDocuments({
      purgeAt: { $exists: false },
      expiresAt: { $exists: true },
    });
    const authWithPurge = await AuthSession.countDocuments({
      purgeAt: { $exists: true },
    });

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

    const legacyUsers = await User.find({
      "preferences.readNotificationIds.0": { $exists: true },
    })
      .select("_id email preferences.readNotificationIds")
      .lean();
    const f33Rows = [];
    for (const u of legacyUsers) {
      const legacy = u.preferences?.readNotificationIds || [];
      const stored = await NotificationReadState.countDocuments({
        userId: u._id,
      });
      const dual = await loadUserReadNotificationKeys(
        { NotificationReadState },
        u
      );
      f33Rows.push({
        userId: String(u._id),
        email: u.email,
        legacyCount: legacy.length,
        readStateCount: stored,
        dualReadCount: dual.size,
        dualContainsAllLegacy: legacy.every((k) => dual.has(String(k))),
      });
    }

    return {
      slug: company.slug,
      databaseName: company.databaseName,
      stampedVersion: company.tenantIndexSchemaVersion ?? null,
      requiredVersion: TENANT_INDEX_SCHEMA_VERSION,
      inventoryOk: inventory.ok,
      missingCount: inventory.missingCount,
      missing: (inventory.models || [])
        .filter((m) => !m.ok)
        .map((m) => ({
          label: m.label,
          collection: m.collection,
          missing: m.missing,
        })),
      employee: {
        expected: expectedEmployee,
        actualIndexes: employeeIndexes.filter(
          (ix) =>
            ix.name === "email_1" ||
            ix.name === "userId_1" ||
            JSON.stringify(ix.key) === JSON.stringify({ email: 1 }) ||
            JSON.stringify(ix.key) === JSON.stringify({ userId: 1 })
        ),
        allIndexes: employeeIndexes,
        data: {
          emailTotal,
          emailNullOrEmpty,
          emailDuplicateGroups: emailDupes.length,
          emailDuplicates: emailDupes.slice(0, 10).map((d) => ({
            email: d._id,
            count: d.n,
          })),
          userIdMissing,
          userIdNonObjectId,
          userIdDuplicateGroups: userIdDupes.length,
          userIdDuplicates: userIdDupes.slice(0, 10).map((d) => ({
            userId: d._id == null ? null : String(d._id),
            count: d.n,
          })),
        },
      },
      f73: {
        required: ACTIVE_EMPLOYEE_UNIQUE_INDEX,
        foundByName: f73 || null,
        foundByShape: f73ByShape || null,
        present: Boolean(f73ByShape),
        activeDuplicateGroups: activeDupGroups.length,
        liveTrackingTtlIndexes: liveTtl,
      },
      f45: {
        ttlPresent,
        authSessions: {
          total: authTotal,
          withPurge: authWithPurge,
          missingPurgeAt: authMissingPurge,
        },
        liveTrackingHasTtl: liveTtl.length > 0,
      },
      f33: {
        usersWithLegacyArray: legacyUsers.length,
        legacyKeyTotal: legacyUsers.reduce(
          (n, u) => n + (u.preferences?.readNotificationIds?.length || 0),
          0
        ),
        dualRead: f33Rows,
        pruned: false,
        note: "Legacy arrays still present is expected without --prune",
      },
    };
  });
}

async function main() {
  await connectCentralDB();
  const companies = await Company.find({})
    .select("slug databaseName tenantIndexSchemaVersion")
    .lean();
  const rows = [];
  for (const c of companies) {
    if (!c.databaseName) continue;
    if (!["acme", "globex", "suspended-co"].includes(c.slug)) continue;
    rows.push(await auditTenant(c));
  }

  const outDir = path.resolve(process.cwd(), "../tmp-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    at: new Date().toISOString(),
    mode: "staging-read-only",
    requiredSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
    rows,
  };
  const outPath = path.join(outDir, "batch-b-closure-staging-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
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

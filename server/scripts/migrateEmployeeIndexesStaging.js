/**
 * STAGING ONLY — Employee email/userId index remediation.
 *
 * Modes:
 *   node scripts/migrateEmployeeIndexesStaging.js --validate
 *   node scripts/migrateEmployeeIndexesStaging.js --apply
 *   node scripts/migrateEmployeeIndexesStaging.js --verify
 *
 * Never deletes employee/user documents. Never touches production intentionally —
 * refuse unless NODE_ENV !== production OR ALLOW_STAGING_INDEX_MIGRATE=true with
 * explicit --i-confirm-staging.
 */
import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import Company from "../models/Company.js";
import {
  connectCentralDB,
  disconnectAll,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import { getEmployeeModel } from "../models/Employee.js";

const TENANTS = ["acme", "globex", "suspended-co"];
const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
    ? "verify"
    : "validate";

function assertStagingSafe() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_STAGING_INDEX_MIGRATE !== "true") {
    throw new Error("Refusing: NODE_ENV=production without ALLOW_STAGING_INDEX_MIGRATE");
  }
  if (mode === "apply" && !process.argv.includes("--i-confirm-staging")) {
    throw new Error("Apply requires --i-confirm-staging");
  }
}

function summarizeIndex(ix) {
  return {
    name: ix.name,
    key: ix.key,
    unique: Boolean(ix.unique),
    sparse: Boolean(ix.sparse),
    partialFilterExpression: ix.partialFilterExpression || null,
  };
}

async function inspectTenant(company) {
  const conn = await getTenantConnection(company.databaseName);
  const Employee = getEmployeeModel(conn);
  const indexes = (await Employee.collection.indexes()).map(summarizeIndex);
  const emailIdx = indexes.find((i) => i.name === "email_1");
  const userIdIdx = indexes.find((i) => i.name === "userId_1");

  const emailDupes = await Employee.aggregate([
    { $group: { _id: "$email", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 }, _id: { $nin: [null, ""] } } },
  ]);
  const emailMissing = await Employee.countDocuments({ email: { $exists: false } });
  const emailNull = await Employee.countDocuments({ email: null });
  const emailEmpty = await Employee.countDocuments({ email: "" });

  const userIdDupes = await Employee.aggregate([
    { $match: { userId: { $type: "objectId" } } },
    { $group: { _id: "$userId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const userIdMissingField = await Employee.countDocuments({
    userId: { $exists: false },
  });
  const userIdExplicitNull = await Employee.countDocuments({ userId: null });
  const userIdNonObjectId = await Employee.countDocuments({
    userId: { $exists: true, $ne: null, $not: { $type: "objectId" } },
  });
  const total = await Employee.countDocuments({});

  const blockers = [];
  if (emailDupes.length) blockers.push(`duplicate emails: ${emailDupes.length} groups`);
  if (emailMissing || emailNull || emailEmpty) {
    blockers.push(
      `bad emails missing=${emailMissing} null=${emailNull} empty=${emailEmpty}`
    );
  }
  if (userIdDupes.length) blockers.push(`duplicate ObjectId userIds: ${userIdDupes.length}`);
  if (userIdNonObjectId) blockers.push(`non-ObjectId userId docs: ${userIdNonObjectId}`);

  return {
    slug: company.slug,
    databaseName: company.databaseName,
    totalEmployees: total,
    indexes: { email_1: emailIdx || null, userId_1: userIdIdx || null },
    email: {
      duplicateGroups: emailDupes.length,
      duplicates: emailDupes.slice(0, 10),
      missing: emailMissing,
      explicitNull: emailNull,
      empty: emailEmpty,
    },
    userId: {
      duplicateObjectIdGroups: userIdDupes.length,
      duplicates: userIdDupes.slice(0, 10).map((d) => ({
        userId: String(d._id),
        n: d.n,
      })),
      missingField: userIdMissingField,
      explicitNull: userIdExplicitNull,
      nonObjectId: userIdNonObjectId,
    },
    blockers,
    emailNeedsUnique:
      company.slug !== "suspended-co" && !(emailIdx && emailIdx.unique),
    userIdNeedsPartial:
      !(
        userIdIdx &&
        userIdIdx.unique &&
        userIdIdx.partialFilterExpression &&
        JSON.stringify(userIdIdx.partialFilterExpression) ===
          JSON.stringify({ userId: { $type: "objectId" } })
      ),
  };
}

async function migrateEmail(Employee, report) {
  const before = (await Employee.collection.indexes()).find((i) => i.name === "email_1");
  if (before?.unique) {
    return { skipped: true, reason: "already unique", before: summarizeIndex(before) };
  }
  if (before) {
    await Employee.collection.dropIndex("email_1");
  }
  await Employee.collection.createIndex(
    { email: 1 },
    { unique: true, name: "email_1" }
  );
  const after = (await Employee.collection.indexes()).find((i) => i.name === "email_1");

  // Verify duplicate rejection without leaving orphan data: insert then delete in transaction-ish cleanup
  const probeEmail = `__migrate_probe_${Date.now()}@index-test.local`;
  const base = {
    employeeCode: `__PROBE_EMAIL_${Date.now()}`,
    fullName: "Index Probe",
    email: probeEmail,
    status: "ACTIVE",
  };
  const a = await Employee.collection.insertOne({ ...base });
  let rejected = false;
  try {
    await Employee.collection.insertOne({
      ...base,
      employeeCode: `__PROBE_EMAIL_DUP_${Date.now()}`,
    });
  } catch (err) {
    rejected = err?.code === 11000;
  }
  await Employee.collection.deleteOne({ _id: a.insertedId });
  // ensure dup attempt did not leave a row
  await Employee.collection.deleteMany({ email: probeEmail });

  if (!rejected) {
    throw new Error(`${report.slug}: unique email index did not reject duplicate insert`);
  }

  return {
    skipped: false,
    before: before ? summarizeIndex(before) : null,
    after: summarizeIndex(after),
    duplicateInsertRejected: true,
  };
}

async function migrateUserId(Employee, report) {
  const before = (await Employee.collection.indexes()).find((i) => i.name === "userId_1");
  const desiredPfe = { userId: { $type: "objectId" } };
  const already =
    before &&
    before.unique &&
    JSON.stringify(before.partialFilterExpression || null) ===
      JSON.stringify(desiredPfe);
  if (already) {
    return { skipped: true, reason: "already partial ObjectId unique", before: summarizeIndex(before) };
  }

  if (before) {
    await Employee.collection.dropIndex("userId_1");
  }
  // Schema uses path-level / schema.index without custom name → Mongo names it userId_1
  await Employee.collection.createIndex(
    { userId: 1 },
    {
      unique: true,
      name: "userId_1",
      partialFilterExpression: desiredPfe,
    }
  );
  const after = (await Employee.collection.indexes()).find((i) => i.name === "userId_1");

  const uid = new mongoose.Types.ObjectId();
  const baseCode = `__PROBE_UID_${Date.now()}`;
  const first = await Employee.collection.insertOne({
    employeeCode: baseCode,
    fullName: "UserId Probe",
    email: `__uid_probe_${Date.now()}@index-test.local`,
    userId: uid,
    status: "ACTIVE",
  });
  let dupRejected = false;
  try {
    await Employee.collection.insertOne({
      employeeCode: `${baseCode}_DUP`,
      fullName: "UserId Probe Dup",
      email: `__uid_probe_dup_${Date.now()}@index-test.local`,
      userId: uid,
      status: "ACTIVE",
    });
  } catch (err) {
    dupRejected = err?.code === 11000;
  }

  // Unlinked employees: missing field + explicit null should both be allowed
  const unlinkedMissing = await Employee.collection.insertOne({
    employeeCode: `${baseCode}_MISS`,
    fullName: "Unlinked Missing",
    email: `__uid_miss_${Date.now()}@index-test.local`,
    status: "ACTIVE",
  });
  const unlinkedNull = await Employee.collection.insertOne({
    employeeCode: `${baseCode}_NULL`,
    fullName: "Unlinked Null",
    email: `__uid_null_${Date.now()}@index-test.local`,
    userId: null,
    status: "ACTIVE",
  });

  // Cleanup probes only (not business data)
  await Employee.collection.deleteMany({
    _id: {
      $in: [first.insertedId, unlinkedMissing.insertedId, unlinkedNull.insertedId],
    },
  });
  await Employee.collection.deleteMany({
    email: { $regex: /^__uid_probe|^__uid_miss|^__uid_null/ },
  });

  if (!dupRejected) {
    throw new Error(`${report.slug}: unique partial userId did not reject duplicate ObjectId`);
  }

  return {
    skipped: false,
    before: before ? summarizeIndex(before) : null,
    after: summarizeIndex(after),
    duplicateObjectIdRejected: true,
    unlinkedMissingAllowed: true,
    unlinkedNullAllowed: true,
  };
}

async function main() {
  assertStagingSafe();
  await connectCentralDB();

  const companies = await Company.find({ slug: { $in: TENANTS } })
    .select("slug databaseName tenantIndexSchemaVersion")
    .lean();
  if (companies.length !== TENANTS.length) {
    throw new Error(
      `Expected tenants ${TENANTS.join(",")}, found ${companies.map((c) => c.slug)}`
    );
  }

  const results = { at: new Date().toISOString(), mode, tenants: [] };

  for (const company of companies) {
    await runWithTenantConnectionScope(async () => {
      const pre = await inspectTenant(company);
      const entry = { pre, migrations: {}, post: null };

      if (pre.blockers.length) {
        entry.stopped = true;
        entry.stopReason = pre.blockers;
        results.tenants.push(entry);
        console.error(`[${company.slug}] STOP — blockers:`, pre.blockers);
        return;
      }

      if (mode === "validate") {
        results.tenants.push(entry);
        console.log(`[${company.slug}] validate OK`, JSON.stringify(pre, null, 2));
        return;
      }

      if (mode === "apply") {
        const conn = await getTenantConnection(company.databaseName);
        const Employee = getEmployeeModel(conn);

        if (pre.emailNeedsUnique) {
          entry.migrations.email = await migrateEmail(Employee, pre);
        } else {
          entry.migrations.email = {
            skipped: true,
            reason: company.slug === "suspended-co" ? "already unique (preserve)" : "already unique",
            before: pre.indexes.email_1,
          };
        }

        if (pre.userIdNeedsPartial) {
          entry.migrations.userId = await migrateUserId(Employee, pre);
        } else {
          entry.migrations.userId = {
            skipped: true,
            reason: "already partial ObjectId unique",
            before: pre.indexes.userId_1,
          };
        }
      }

      entry.post = await inspectTenant(company);
      results.tenants.push(entry);
      console.log(`[${company.slug}] ${mode} done`);
    });
  }

  const anyStopped = results.tenants.some((t) => t.stopped);
  const outDir = path.resolve(process.cwd(), "../tmp-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `batch-b-employee-index-${mode}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${outPath}`);

  await disconnectAll();
  if (anyStopped) process.exit(2);
  if (mode === "apply" || mode === "verify") {
    for (const t of results.tenants) {
      const p = t.post || t.pre;
      if (p.email.duplicateGroups || p.userId.duplicateObjectIdGroups) {
        process.exit(2);
      }
      if (t.post) {
        if (!t.post.indexes.email_1?.unique) {
          console.error(`[${t.pre.slug}] email_1 not unique after migrate`);
          process.exit(2);
        }
        const pfe = t.post.indexes.userId_1?.partialFilterExpression;
        if (
          !t.post.indexes.userId_1?.unique ||
          JSON.stringify(pfe) !== JSON.stringify({ userId: { $type: "objectId" } })
        ) {
          console.error(`[${t.pre.slug}] userId_1 not partial ObjectId unique after migrate`);
          process.exit(2);
        }
      }
    }
  }
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

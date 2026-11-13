process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectCentralDB, disconnectAll, getTenantConnection } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { provisionTenantDatabase } from "../services/tenantProvisioningService.js";
import {
  OFFER_LETTER_EMPLOYEE_ID_INDEX,
  LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME,
  ensureOfferLetterEmployeeIdIndex,
  isLegacyEmployeeIdIndex,
  findDuplicateOfferLetterEmployeeIds,
} from "../services/offerLetterEmployeeIdIndex.js";

describe("offer_letters employeeId index migration", () => {
  let mongoServer;
  let companyA;
  let companyB;
  let connA;
  let connB;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();

    companyA = await Company.create({
      name: "Idx Co A",
      companyName: "Idx Co A",
      slug: `idx-a-${Date.now()}`,
      databaseName: `company_idx_a_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    companyB = await Company.create({
      name: "Idx Co B",
      companyName: "Idx Co B",
      slug: `idx-b-${Date.now()}`,
      databaseName: `company_idx_b_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      hrAccessEnforcement: { mode: "OFF" },
    });

    connA = await getTenantConnection(companyA.databaseName);
    connB = await getTenantConnection(companyB.databaseName);
    await connA.db.createCollection("offer_letters");
    await connB.db.createCollection("offer_letters");
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  it("classifies legacy non-unique employeeId_1 correctly", () => {
    assert.equal(
      isLegacyEmployeeIdIndex({
        name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME,
        key: { employeeId: 1 },
      }),
      true
    );
    assert.equal(
      isLegacyEmployeeIdIndex({
        name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME,
        key: { employeeId: 1 },
        unique: true,
        partialFilterExpression: { employeeId: { $type: "objectId" } },
      }),
      false
    );
  });

  it("reports migration_required for existing legacy index without applying", async () => {
    const col = connA.db.collection("offer_letters");
    await col.dropIndexes().catch(() => {});
    // Recreate _id_ by ensuring collection exists
    await col.insertOne({ _tmp: true });
    await col.deleteMany({ _tmp: true });
    await col.createIndex({ employeeId: 1 }, { name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME });

    const dry = await ensureOfferLetterEmployeeIdIndex(connA.db, { applyMigration: false });
    assert.equal(dry.status, "migration_required");
    assert.equal(dry.applied, false);
    assert.equal(dry.droppedLegacy, false);

    const indexes = await col.indexes();
    assert.ok(indexes.some((i) => i.name === LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME));
    assert.equal(
      indexes.some((i) => i.name === OFFER_LETTER_EMPLOYEE_ID_INDEX.name),
      false
    );
  });

  it("creates the correct unique partial index on a clean tenant", async () => {
    const col = connB.db.collection("offer_letters");
    await col.dropIndexes().catch(() => {});
    await col.insertOne({ _tmp: true });
    await col.deleteMany({});

    const result = await ensureOfferLetterEmployeeIdIndex(connB.db, { applyMigration: false });
    assert.equal(result.status, "ok");
    assert.equal(result.createdDesired, true);

    const indexes = await col.indexes();
    const desired = indexes.find((i) => i.name === OFFER_LETTER_EMPLOYEE_ID_INDEX.name);
    assert.ok(desired);
    assert.equal(desired.unique, true);
    assert.equal(desired.partialFilterExpression?.employeeId?.$type, "objectId");
  });

  it("detects duplicate employeeId values and refuses migration", async () => {
    const col = connA.db.collection("offer_letters");
    await col.deleteMany({});
    const empId = new mongoose.Types.ObjectId();
    await col.insertMany([
      { employeeId: empId, candidate: { email: "a@test.com" } },
      { employeeId: empId, candidate: { email: "b@test.com" } },
      { employeeId: null, candidate: { email: "c@test.com" } },
    ]);
    // Ensure legacy index present
    const names = (await col.indexes()).map((i) => i.name);
    if (!names.includes(LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME)) {
      await col.createIndex({ employeeId: 1 }, { name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME });
    }

    const dupes = await findDuplicateOfferLetterEmployeeIds(col);
    assert.equal(dupes.length, 1);

    const result = await ensureOfferLetterEmployeeIdIndex(connA.db, { applyMigration: true });
    assert.equal(result.status, "error");
    assert.match(result.message || "", /duplicate/i);
    assert.equal(result.applied, false);
  });

  it("applies migration when legacy exists and no duplicates", async () => {
    const col = connA.db.collection("offer_letters");
    await col.deleteMany({});
    await col.insertMany([
      { employeeId: new mongoose.Types.ObjectId(), candidate: { email: "one@test.com" } },
      { employeeId: null, candidate: { email: "two@test.com" } },
      { candidate: { email: "three@test.com" } },
    ]);

    // Reset to legacy-only index
    for (const idx of await col.indexes()) {
      if (idx.name !== "_id_") await col.dropIndex(idx.name);
    }
    await col.createIndex({ employeeId: 1 }, { name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME });

    const result = await ensureOfferLetterEmployeeIdIndex(connA.db, { applyMigration: true });
    assert.equal(result.status, "ok", result.message);
    assert.equal(result.droppedLegacy, true);
    assert.equal(result.createdDesired, true);

    const indexes = await col.indexes();
    assert.equal(
      indexes.some((i) => i.name === LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME),
      false
    );
    const desired = indexes.find((i) => i.name === OFFER_LETTER_EMPLOYEE_ID_INDEX.name);
    assert.ok(desired);
    assert.equal(desired.unique, true);
  });

  it("repeated ensure is idempotent after migration", async () => {
    const first = await ensureOfferLetterEmployeeIdIndex(connA.db, { applyMigration: false });
    const second = await ensureOfferLetterEmployeeIdIndex(connA.db, { applyMigration: true });
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    assert.equal(second.droppedLegacy, false);
  });

  it("provisioning is idempotent across two tenant databases and surfaces migration_required", async () => {
    delete process.env.APPLY_OFFER_LETTER_EMPLOYEEID_INDEX_MIGRATION;

    // Fresh tenant C with legacy index only
    const companyC = await Company.create({
      name: "Idx Co C",
      companyName: "Idx Co C",
      slug: `idx-c-${Date.now()}`,
      databaseName: `company_idx_c_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
      config: { timezone: "Asia/Kolkata" },
      hrAccessEnforcement: { mode: "OFF" },
    });
    const connC = await getTenantConnection(companyC.databaseName);
    await connC.db.createCollection("offer_letters");
    await connC.db
      .collection("offer_letters")
      .createIndex({ employeeId: 1 }, { name: LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME });

    const outcome1 = await provisionTenantDatabase(companyC, connC);
    assert.equal(outcome1.offerLetterEmployeeIdIndex?.status, "migration_required");
    assert.equal(outcome1.needsManualConfiguration, true);

    const outcome2 = await provisionTenantDatabase(companyC, connC);
    assert.equal(outcome2.offerLetterEmployeeIdIndex?.status, "migration_required");

    // Tenant B already has desired index from earlier test — provisioning should stay ok
    const outcomeB = await provisionTenantDatabase(companyB, connB);
    assert.equal(outcomeB.offerLetterEmployeeIdIndex?.status, "ok");

    // Explicit apply via env during provision
    process.env.APPLY_OFFER_LETTER_EMPLOYEEID_INDEX_MIGRATION = "true";
    const outcomeApply = await provisionTenantDatabase(companyC, connC);
    assert.equal(outcomeApply.offerLetterEmployeeIdIndex?.status, "ok", outcomeApply.offerLetterEmployeeIdIndex?.message);
    delete process.env.APPLY_OFFER_LETTER_EMPLOYEEID_INDEX_MIGRATION;

    const indexes = await connC.db.collection("offer_letters").indexes();
    assert.ok(indexes.some((i) => i.name === OFFER_LETTER_EMPLOYEE_ID_INDEX.name && i.unique));
    assert.equal(
      indexes.some((i) => i.name === LEGACY_OFFER_LETTER_EMPLOYEE_ID_INDEX_NAME),
      false
    );
  });
});
